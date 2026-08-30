/**
 * Seeds a demo dataset into Firestore: one organization, three users (an
 * officer, a second officer, and a fleet manager — keyed by their real
 * Firebase Auth UIDs, so auth and Firestore data always match), a
 * ten-vehicle fleet with a realistic spread of statuses/inspections/
 * issues, and one inspection template.
 *
 * Idempotent: every write is `set(..., { merge: true })`, never `add()`,
 * so re-running this script updates the same demo docs in place instead
 * of duplicating them. One important refinement for idempotency: a
 * vehicle's `status` and an issue's `status` are also mutated by the live
 * app/Cloud Functions (see `recalculateVehicleStatus` in
 * functions/src/index.ts) once real testing starts against these docs —
 * so this script only ever sets an *initial* value for those two fields,
 * the first time a given document is created. On every later run, merge
 * leaves whatever the live system has since computed completely
 * untouched (see `onlyOnFirstCreate` below). This is specifically why
 * unit-312's setup stays intact across reseeds even though its status
 * write is still "in" the script.
 *
 * Usage:
 *   npm run seed -- <officerUid> [fleetManagerUid] [officer2Uid]
 *
 * <officerUid> is required — the Firebase Auth UID of the
 * officer@example.com account (Firebase Console -> Authentication -> that
 * user's row). [fleetManagerUid] and [officer2Uid] are optional; if
 * omitted, obviously-fake placeholder UIDs are used instead so the script
 * still runs — replace them (or pass real UIDs) once those accounts
 * exist, and re-run to fix the seeded docs in place.
 *
 * Requires a service account key saved at <repo root>/serviceAccountKey.json
 * (Firebase Console -> Project settings -> Service accounts -> Generate new
 * private key). That file is gitignored — never commit it.
 */
import * as fs from "fs";
import * as path from "path";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import type { InspectionItemResult, IssueSeverity, TemplateItem } from "../src/types";

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "serviceAccountKey.json");
const ORG_ID = "demo-org";
const VEHICLE_ID = "unit-312";
const TEMPLATE_ID = "template-1";
const OFFICER_EMAIL = "officer@example.com";

const PLACEHOLDER_FLEET_MANAGER_UID = "REPLACE_WITH_FLEET_MANAGER_UID";
const PLACEHOLDER_OFFICER2_UID = "REPLACE_WITH_OFFICER2_UID";

function loadServiceAccount(): ServiceAccount {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `Missing service account key at ${SERVICE_ACCOUNT_PATH}\n\n` +
        "Download one from Firebase Console -> Project settings -> Service accounts\n" +
        "-> Generate new private key, and save it as serviceAccountKey.json in the\n" +
        "project root."
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
}

function getCliArgs(): { officerUid: string; fleetManagerUid: string; officer2Uid: string } {
  const officerUid = process.argv[2];
  if (!officerUid) {
    console.error(
      "Usage: npm run seed -- <officerUid> [fleetManagerUid] [officer2Uid]\n\n" +
        "Pass the Firebase Auth UID of the officer@example.com account this demo\n" +
        "data should belong to (Firebase Console -> Authentication -> that user's row).\n" +
        "fleetManagerUid/officer2Uid are optional — placeholders are used if omitted."
    );
    process.exit(1);
  }
  const fleetManagerUid = process.argv[3] || PLACEHOLDER_FLEET_MANAGER_UID;
  const officer2Uid = process.argv[4] || PLACEHOLDER_OFFICER2_UID;
  return { officerUid, fleetManagerUid, officer2Uid };
}

/**
 * Returns `fields` if `ref`'s document doesn't exist yet, else `{}`.
 * Use this for fields the live app/Cloud Functions also mutate (vehicle
 * `status`, issue `status`) so re-running this idempotent seed only ever
 * sets an initial value — it never stomps on real, already-tested state
 * from a previous run.
 */
async function onlyOnFirstCreate(
  ref: DocumentReference,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const snap = await ref.get();
  return snap.exists ? {} : fields;
}

function daysAgoTimestamp(days: number): Timestamp {
  return Timestamp.fromDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

/**
 * The six-item daily vehicle inspection checklist, in the canonical
 * `TemplateItem` shape (src/types) — every item is a pass/fail check,
 * required, and auto-creates an Issue on failure; `requiresPhoto`/
 * `requiresNote` are layered on for items that need supporting evidence.
 */
const CHECKLIST_ITEMS: Array<Pick<TemplateItem, "id" | "label" | "requiresPhoto" | "requiresNote">> = [
  { id: "tires", label: "Tires", requiresPhoto: false, requiresNote: false },
  { id: "brakes", label: "Brakes", requiresPhoto: false, requiresNote: false },
  { id: "lights", label: "Lights", requiresPhoto: true, requiresNote: true },
  { id: "emergency-light", label: "Emergency Lights", requiresPhoto: true, requiresNote: false },
  { id: "siren", label: "Siren", requiresPhoto: false, requiresNote: false },
  { id: "radio", label: "Radio", requiresPhoto: false, requiresNote: false },
];

const DAILY_INSPECTION_ITEMS: TemplateItem[] = CHECKLIST_ITEMS.map((item, index) => ({
  ...item,
  templateId: TEMPLATE_ID,
  sortOrder: index,
  section: item.label,
  responseType: "pass_fail",
  isRequired: true,
  autoCreateIssueOnFail: true,
}));

/** Builds an all-items-passed response set for a seeded completed inspection. */
function buildPassingItems(inspectionId: string, respondedAt: Timestamp): InspectionItemResult[] {
  return CHECKLIST_ITEMS.map((item) => ({
    id: `${inspectionId}-${item.id}`,
    inspectionId,
    templateItemId: item.id,
    itemLabel: item.label,
    passed: true,
    textValue: "",
    respondedAt: respondedAt.toDate().toISOString(),
  }));
}

type OfficerKey = "officer1" | "officer2" | null;

interface SeedIssueSpec {
  id: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  daysAgo: number;
}

interface SeedVehicleSpec {
  id: string;
  unitNumber: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  odometer: number;
  /** Initial status — only ever written the first time this vehicle doc is created (see `onlyOnFirstCreate`). */
  status: "ready" | "attention" | "maintenance_required" | "out_of_service" | "retired" | "unknown";
  assignedOfficer: OfficerKey;
  /** A completed inspection to seed, with realistic-looking dates (all items pass — any problem is modeled as a separately-reported Issue instead). */
  inspection?: { daysAgo: number; overallResult: "pass" | "fail" | "pass_with_issues" };
  /** An open Issue to seed against this vehicle. */
  issue?: SeedIssueSpec;
}

/**
 * Nine additional vehicles (unit-312 makes ten total) spanning every
 * status the fleet dashboard cares about: 3 ready, 2 maintenance_required
 * (each with an open high/critical issue attached — on purpose, to
 * exercise deriveVehicleStatus's "an open critical/high issue holds
 * maintenance_required even after a passing inspection" rule), 2
 * attention (open low/medium issues), 1 out_of_service, 1 retired.
 * unit-312 itself continues to cover "never inspected / unknown" on a
 * fresh install. Assigned across officer1/officer2, not all to one.
 */
const FLEET: SeedVehicleSpec[] = [
  {
    id: "unit-101",
    unitNumber: "101",
    make: "Ford",
    model: "Explorer",
    year: 2022,
    vin: "1FM5K8GC2NGA00101",
    odometer: 24500,
    status: "ready",
    assignedOfficer: "officer1",
    inspection: { daysAgo: 2, overallResult: "pass" },
  },
  {
    id: "unit-102",
    unitNumber: "102",
    make: "Chevrolet",
    model: "Tahoe PPV",
    year: 2023,
    vin: "1GNSKPKD7PR100102",
    odometer: 15800,
    status: "ready",
    assignedOfficer: "officer2",
    inspection: { daysAgo: 1, overallResult: "pass" },
  },
  {
    id: "unit-103",
    unitNumber: "103",
    make: "Dodge",
    model: "Charger Pursuit",
    year: 2021,
    vin: "2C3CDXAT6MH100103",
    odometer: 41200,
    status: "ready",
    assignedOfficer: "officer1",
    inspection: { daysAgo: 4, overallResult: "pass" },
  },
  {
    id: "unit-104",
    unitNumber: "104",
    make: "Ford",
    model: "Police Interceptor Utility",
    year: 2022,
    vin: "1FM5K8GT8NGA00104",
    odometer: 33750,
    status: "maintenance_required",
    assignedOfficer: "officer2",
    inspection: { daysAgo: 3, overallResult: "pass" },
    issue: {
      id: "issue-104",
      title: "Check engine light on",
      description: "Check engine light illuminated during pre-trip; engine runs rough at idle.",
      severity: "high",
      daysAgo: 3,
    },
  },
  {
    id: "unit-105",
    unitNumber: "105",
    make: "Chevrolet",
    model: "Tahoe PPV",
    year: 2020,
    vin: "1GNSKPKC5LR100105",
    odometer: 58900,
    status: "maintenance_required",
    assignedOfficer: "officer1",
    inspection: { daysAgo: 6, overallResult: "pass" },
    issue: {
      id: "issue-105",
      title: "Brake pedal soft / low",
      description:
        "Brake pedal feels spongy and sinks under sustained pressure. Pulled from patrol rotation pending service.",
      severity: "critical",
      daysAgo: 6,
    },
  },
  {
    id: "unit-106",
    unitNumber: "106",
    make: "Ford",
    model: "Explorer",
    year: 2019,
    vin: "1FM5K8GC0KGA00106",
    odometer: 71300,
    status: "attention",
    assignedOfficer: "officer2",
    inspection: { daysAgo: 5, overallResult: "pass" },
    issue: {
      id: "issue-106",
      title: "Passenger door trim loose",
      description: "Interior door trim panel on passenger side has come partially loose. Cosmetic only.",
      severity: "low",
      daysAgo: 5,
    },
  },
  {
    id: "unit-107",
    unitNumber: "107",
    make: "Dodge",
    model: "Charger Pursuit",
    year: 2022,
    vin: "2C3CDXAT4NH100107",
    odometer: 27600,
    status: "attention",
    assignedOfficer: "officer1",
    inspection: { daysAgo: 8, overallResult: "pass" },
    issue: {
      id: "issue-107",
      title: "Spotlight lens cracked",
      description: "Driver-side spotlight lens is cracked; light still functions but should be replaced.",
      severity: "medium",
      daysAgo: 8,
    },
  },
  {
    id: "unit-108",
    unitNumber: "108",
    make: "Ford",
    model: "F-150 Police Responder",
    year: 2021,
    vin: "1FTFW1E58MFA00108",
    odometer: 62400,
    status: "out_of_service",
    assignedOfficer: "officer2",
    // Manual override status — no inspection/issue needed to justify it.
  },
  {
    id: "unit-109",
    unitNumber: "109",
    make: "Ford",
    model: "Crown Victoria",
    year: 2011,
    vin: "2FABP7BV8BX100109",
    odometer: 138200,
    status: "retired",
    assignedOfficer: null,
  },
];

async function main() {
  const { officerUid, fleetManagerUid, officer2Uid } = getCliArgs();
  initializeApp({ credential: cert(loadServiceAccount()) });
  const db = getFirestore();

  const officerUidByKey: Record<Exclude<OfficerKey, null>, string> = {
    officer1: officerUid,
    officer2: officer2Uid,
  };

  console.log(`Seeding demo data:`);
  console.log(`  officer1 (existing): ${officerUid}`);
  console.log(`  officer2: ${officer2Uid}${officer2Uid === PLACEHOLDER_OFFICER2_UID ? " (placeholder)" : ""}`);
  console.log(`  fleetManager: ${fleetManagerUid}${fleetManagerUid === PLACEHOLDER_FLEET_MANAGER_UID ? " (placeholder)" : ""}\n`);

  await db.doc(`organizations/${ORG_ID}`).set(
    {
      name: "Tulsa Example Police Department",
      isActive: true,
      settings: { inspectionIntervalDays: 7 },
    },
    { merge: true }
  );
  console.log(`  organizations/${ORG_ID}`);

  // --- Users -----------------------------------------------------------

  const users = [
    { uid: officerUid, email: OFFICER_EMAIL, firstName: "Officer", lastName: "Smith", role: "officer" },
    { uid: officer2Uid, email: "officer2@example.com", firstName: "Officer", lastName: "Ramirez", role: "officer" },
    { uid: fleetManagerUid, email: "manager@example.com", firstName: "Alex", lastName: "Rivera", role: "fleet_manager" },
  ];

  for (const u of users) {
    await db.doc(`userOrgs/${u.uid}`).set({ organizationId: ORG_ID, email: u.email }, { merge: true });
    await db.doc(`organizations/${ORG_ID}/users/${u.uid}`).set(
      {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        organizationId: ORG_ID,
        isActive: true,
      },
      { merge: true }
    );
    console.log(`  organizations/${ORG_ID}/users/${u.uid} (${u.role})`);
  }

  // --- unit-312 (pre-existing — status write is initial-only, see header comment) ---

  const unit312Ref = db.doc(`organizations/${ORG_ID}/vehicles/${VEHICLE_ID}`);
  await unit312Ref.set(
    {
      unitNumber: "312",
      vin: "1FM5K8GT5PGA00312",
      make: "Ford",
      model: "Police Interceptor Utility",
      year: 2023,
      odometer: 10000,
      assignedUserId: officerUid,
      organizationId: ORG_ID,
      ...(await onlyOnFirstCreate(unit312Ref, { status: "unknown" })),
    },
    { merge: true }
  );
  console.log(`  organizations/${ORG_ID}/vehicles/${VEHICLE_ID}`);

  // --- The rest of the fleet --------------------------------------------

  for (const spec of FLEET) {
    const assignedUserId = spec.assignedOfficer ? officerUidByKey[spec.assignedOfficer] : undefined;
    const vehicleRef = db.doc(`organizations/${ORG_ID}/vehicles/${spec.id}`);

    await vehicleRef.set(
      {
        unitNumber: spec.unitNumber,
        vin: spec.vin,
        make: spec.make,
        model: spec.model,
        year: spec.year,
        odometer: spec.odometer,
        organizationId: ORG_ID,
        ...(assignedUserId ? { assignedUserId } : {}),
        ...(await onlyOnFirstCreate(vehicleRef, { status: spec.status })),
      },
      { merge: true }
    );
    console.log(`  organizations/${ORG_ID}/vehicles/${spec.id} (${spec.status})`);

    if (spec.inspection) {
      const inspectionId = `inspection-${spec.unitNumber}`;
      const completedAt = daysAgoTimestamp(spec.inspection.daysAgo);
      const startedAt = Timestamp.fromMillis(completedAt.toMillis() - 15 * 60 * 1000); // 15 min before

      await db.doc(`organizations/${ORG_ID}/inspections/${inspectionId}`).set(
        {
          organizationId: ORG_ID,
          templateId: TEMPLATE_ID,
          assetType: "vehicle",
          assetId: spec.id,
          inspectorUserId: assignedUserId ?? officerUid,
          overallResult: spec.inspection.overallResult,
          items: buildPassingItems(inspectionId, completedAt),
          issueIds: [],
          startedAt,
          completedAt,
        },
        { merge: true }
      );
      console.log(`    inspections/${inspectionId} (${spec.inspection.overallResult}, ${spec.inspection.daysAgo}d ago)`);
    }

    if (spec.issue) {
      const issueRef = db.doc(`organizations/${ORG_ID}/issues/${spec.issue.id}`);
      const reportedAt = daysAgoTimestamp(spec.issue.daysAgo);

      await issueRef.set(
        {
          organizationId: ORG_ID,
          assetType: "vehicle",
          assetId: spec.id,
          title: spec.issue.title,
          description: spec.issue.description,
          severity: spec.issue.severity,
          reportedByUserId: assignedUserId ?? officerUid,
          reportedAt,
          updatedAt: reportedAt,
          ...(await onlyOnFirstCreate(issueRef, { status: "open" })),
        },
        { merge: true }
      );
      console.log(`    issues/${spec.issue.id} (${spec.issue.severity})`);
    }
  }

  // --- Inspection template ------------------------------------------------

  await db.doc(`organizations/${ORG_ID}/inspectionTemplates/${TEMPLATE_ID}`).set(
    {
      appliesTo: "vehicle",
      name: "Daily Vehicle Inspection",
      version: 1,
      isActive: true,
      // Daily template -> daily recurrence, so onInspectionComplete's
      // "next inspection due" Alert has a recurrenceDays to work from.
      recurrenceDays: 1,
      items: DAILY_INSPECTION_ITEMS,
    },
    { merge: true }
  );
  console.log(`  organizations/${ORG_ID}/inspectionTemplates/${TEMPLATE_ID}`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

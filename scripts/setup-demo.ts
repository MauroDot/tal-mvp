/**
 * Seeds a demo dataset into Firestore: one organization, its officer user
 * (keyed by their real Firebase Auth UID, so auth and Firestore data always
 * match), one vehicle, and one inspection template.
 *
 * Idempotent: every write is `set(..., { merge: true })`, never `add()`,
 * so re-running this script updates the same demo docs in place instead
 * of duplicating them.
 *
 * Usage:
 *   npm run seed -- <officerUid>
 *
 * <officerUid> is the Firebase Auth UID of the officer@example.com account
 * (Firebase Console -> Authentication -> that user's row).
 *
 * Requires a service account key saved at <repo root>/serviceAccountKey.json
 * (Firebase Console -> Project settings -> Service accounts -> Generate new
 * private key). That file is gitignored — never commit it.
 */
import * as fs from "fs";
import * as path from "path";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { TemplateItem } from "../src/types";

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "serviceAccountKey.json");
const ORG_ID = "demo-org";
const VEHICLE_ID = "unit-312";
const TEMPLATE_ID = "template-1";
const OFFICER_EMAIL = "officer@example.com";

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

function getOfficerUid(): string {
  const uid = process.argv[2];
  if (!uid) {
    console.error(
      "Usage: npm run seed -- <officerUid>\n\n" +
        "Pass the Firebase Auth UID of the officer@example.com account this demo\n" +
        "data should belong to (Firebase Console -> Authentication -> that user's row)."
    );
    process.exit(1);
  }
  return uid;
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

async function main() {
  const uid = getOfficerUid();
  initializeApp({ credential: cert(loadServiceAccount()) });
  const db = getFirestore();

  console.log(`Seeding demo data for officer UID: ${uid}\n`);

  await db.doc(`organizations/${ORG_ID}`).set(
    {
      name: "Tulsa Example Police Department",
      isActive: true,
      settings: { inspectionIntervalDays: 7 },
    },
    { merge: true }
  );
  console.log(`  organizations/${ORG_ID}`);

  await db.doc(`userOrgs/${uid}`).set(
    {
      organizationId: ORG_ID,
      email: OFFICER_EMAIL,
    },
    { merge: true }
  );
  console.log(`  userOrgs/${uid}`);

  await db.doc(`organizations/${ORG_ID}/users/${uid}`).set(
    {
      email: OFFICER_EMAIL,
      firstName: "Officer",
      lastName: "Smith",
      role: "officer",
      organizationId: ORG_ID,
      isActive: true,
    },
    { merge: true }
  );
  console.log(`  organizations/${ORG_ID}/users/${uid}`);

  await db.doc(`organizations/${ORG_ID}/vehicles/${VEHICLE_ID}`).set(
    {
      unitNumber: "312",
      vin: "1FM5K8GT5PGA00312",
      make: "Ford",
      model: "Police Interceptor Utility",
      year: 2023,
      odometer: 10000,
      status: "unknown",
      assignedUserId: uid,
      organizationId: ORG_ID,
    },
    { merge: true }
  );
  console.log(`  organizations/${ORG_ID}/vehicles/${VEHICLE_ID}`);

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

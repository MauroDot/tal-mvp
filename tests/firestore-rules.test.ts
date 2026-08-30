/**
 * Firestore Security Rules tests, run against the local emulator only —
 * never production. Requires the emulator running, which this repo's
 * `npm run test:rules` handles via `firebase emulators:exec`.
 *
 * NOTE: I could not run this suite myself — the Firestore emulator
 * requires a local Java runtime, and none is available in this
 * environment. Every assertion below is traced by hand against
 * firestore.rules (see the PR/commit description), but this is the
 * first time it will actually execute.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-fleetready-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "firestore.rules");

const ORG_A = "org-a";
const ORG_B = "org-b";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  // Guarded: if beforeAll itself failed (e.g. no emulator running),
  // testEnv is never assigned — don't let that mask the real error.
  await testEnv?.cleanup();
});

/** A client Firestore instance authenticated as `uid`, for use with the modular SDK. */
function ctxFor(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

/**
 * Baseline fixtures: two orgs, one officer + one fleet_manager in org A,
 * one officer in org B, one vehicle per org, one auditLog entry in org A.
 * Written with Security Rules disabled — this is setup, not what's under
 * test (and rules deny writing user profiles/auditLogs from a plain
 * client regardless, so there'd be no other way to seed them).
 */
async function seedFixtures(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;

    await setDoc(doc(db, "organizations", ORG_A), { name: "Org A", isActive: true });
    await setDoc(doc(db, "organizations", ORG_B), { name: "Org B", isActive: true });

    await setDoc(doc(db, "organizations", ORG_A, "users", "officer-a"), {
      email: "officer-a@example.com",
      firstName: "Officer",
      lastName: "A",
      role: "officer",
      organizationId: ORG_A,
      isActive: true,
    });
    await setDoc(doc(db, "organizations", ORG_A, "users", "manager-a"), {
      email: "manager-a@example.com",
      firstName: "Manager",
      lastName: "A",
      role: "fleet_manager",
      organizationId: ORG_A,
      isActive: true,
    });
    await setDoc(doc(db, "organizations", ORG_B, "users", "officer-b"), {
      email: "officer-b@example.com",
      firstName: "Officer",
      lastName: "B",
      role: "officer",
      organizationId: ORG_B,
      isActive: true,
    });

    await setDoc(doc(db, "userOrgs", "officer-a"), { organizationId: ORG_A, email: "officer-a@example.com" });
    await setDoc(doc(db, "userOrgs", "manager-a"), { organizationId: ORG_A, email: "manager-a@example.com" });
    await setDoc(doc(db, "userOrgs", "officer-b"), { organizationId: ORG_B, email: "officer-b@example.com" });

    await setDoc(doc(db, "organizations", ORG_A, "vehicles", "vehicle-a1"), {
      unitNumber: "A1",
      status: "ready",
      organizationId: ORG_A,
    });
    await setDoc(doc(db, "organizations", ORG_B, "vehicles", "vehicle-b1"), {
      unitNumber: "B1",
      status: "ready",
      organizationId: ORG_B,
    });

    await setDoc(doc(db, "organizations", ORG_A, "auditLogs", "log-1"), {
      organizationId: ORG_A,
      action: "vehicle_status_changed",
      entityType: "vehicle",
      entityId: "vehicle-a1",
      performedBy: "system",
      timestamp: new Date().toISOString(),
    });
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedFixtures();
});

describe("multi-tenant boundary", () => {
  it("denies an org-A user reading an org-B vehicle by changing the orgId in the path", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(getDoc(doc(officerA, "organizations", ORG_B, "vehicles", "vehicle-b1")));
  });

  it("denies an unauthenticated request entirely", async () => {
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anon, "organizations", ORG_A, "vehicles", "vehicle-a1")));
  });

  it("allows an org-A user to read an org-A vehicle (sanity check the boundary isn't just denying everything)", async () => {
    const officerA = ctxFor("officer-a");
    await assertSucceeds(getDoc(doc(officerA, "organizations", ORG_A, "vehicles", "vehicle-a1")));
  });
});

describe("vehicles: read for any member, write for admin/fleet_manager", () => {
  it("denies an officer creating a vehicle", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(
      setDoc(doc(officerA, "organizations", ORG_A, "vehicles", "vehicle-a2"), {
        unitNumber: "A2",
        status: "unknown",
        organizationId: ORG_A,
      })
    );
  });

  it("allows a fleet_manager to create a vehicle", async () => {
    const managerA = ctxFor("manager-a");
    await assertSucceeds(
      setDoc(doc(managerA, "organizations", ORG_A, "vehicles", "vehicle-a2"), {
        unitNumber: "A2",
        status: "unknown",
        organizationId: ORG_A,
      })
    );
  });
});

describe("inspections: create only where inspectorUserId is the requester", () => {
  it("allows an officer to create an inspection with themselves as inspectorUserId", async () => {
    const officerA = ctxFor("officer-a");
    await assertSucceeds(
      setDoc(doc(officerA, "organizations", ORG_A, "inspections", "inspection-1"), {
        organizationId: ORG_A,
        templateId: "template-1",
        assetType: "vehicle",
        assetId: "vehicle-a1",
        inspectorUserId: "officer-a",
        items: [],
        issueIds: [],
        startedAt: new Date().toISOString(),
      })
    );
  });

  it("denies an officer creating an inspection attributed to someone else", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(
      setDoc(doc(officerA, "organizations", ORG_A, "inspections", "inspection-2"), {
        organizationId: ORG_A,
        templateId: "template-1",
        assetType: "vehicle",
        assetId: "vehicle-a1",
        inspectorUserId: "manager-a", // not the requester
        items: [],
        issueIds: [],
        startedAt: new Date().toISOString(),
      })
    );
  });
});

describe("inspections: update by the original inspector, only while incomplete", () => {
  /** Seeds an inspection (rules disabled — this is fixture setup, not what's under test). */
  async function seedInspection(id: string, inspectorUserId: string, completed: boolean) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, "organizations", ORG_A, "inspections", id), {
        organizationId: ORG_A,
        templateId: "template-1",
        assetType: "vehicle",
        assetId: "vehicle-a1",
        inspectorUserId,
        items: [],
        issueIds: [],
        startedAt: new Date().toISOString(),
        ...(completed ? { completedAt: new Date().toISOString(), overallResult: "pass" } : {}),
      });
    });
  }

  it("allows the inspector to update their own still-incomplete inspection (completing it)", async () => {
    await seedInspection("inspection-incomplete", "officer-a", false);
    const officerA = ctxFor("officer-a");
    await assertSucceeds(
      updateDoc(doc(officerA, "organizations", ORG_A, "inspections", "inspection-incomplete"), {
        overallResult: "pass",
        completedAt: new Date().toISOString(),
      })
    );
  });

  it("denies another user updating someone else's inspection", async () => {
    await seedInspection("inspection-incomplete-2", "officer-a", false);
    const managerA = ctxFor("manager-a");
    await assertFails(
      updateDoc(doc(managerA, "organizations", ORG_A, "inspections", "inspection-incomplete-2"), {
        overallResult: "pass",
        completedAt: new Date().toISOString(),
      })
    );
  });

  it("denies the original inspector updating an already-completed inspection", async () => {
    await seedInspection("inspection-completed", "officer-a", true);
    const officerA = ctxFor("officer-a");
    await assertFails(
      updateDoc(doc(officerA, "organizations", ORG_A, "inspections", "inspection-completed"), {
        overallResult: "fail",
      })
    );
  });
});

describe("issues: create for any member, update for reporter or admin/fleet_manager/supervisor", () => {
  it("allows any org member to create an issue", async () => {
    const officerA = ctxFor("officer-a");
    await assertSucceeds(
      setDoc(doc(officerA, "organizations", ORG_A, "issues", "issue-1"), {
        organizationId: ORG_A,
        assetType: "vehicle",
        assetId: "vehicle-a1",
        title: "Test issue",
        severity: "low",
        status: "open",
        reportedByUserId: "officer-a",
        reportedAt: new Date().toISOString(),
      })
    );
  });

  it("allows the reporter to update their own issue", async () => {
    const officerA = ctxFor("officer-a");
    await setDoc(doc(officerA, "organizations", ORG_A, "issues", "issue-2"), {
      organizationId: ORG_A,
      assetType: "vehicle",
      assetId: "vehicle-a1",
      title: "Test issue",
      severity: "low",
      status: "open",
      reportedByUserId: "officer-a",
      reportedAt: new Date().toISOString(),
    });
    await assertSucceeds(
      updateDoc(doc(officerA, "organizations", ORG_A, "issues", "issue-2"), { status: "acknowledged" })
    );
  });

  it("denies a non-reporting officer updating someone else's issue", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, "organizations", ORG_A, "issues", "issue-3"), {
        organizationId: ORG_A,
        assetType: "vehicle",
        assetId: "vehicle-a1",
        title: "Reported by manager",
        severity: "low",
        status: "open",
        reportedByUserId: "manager-a",
        reportedAt: new Date().toISOString(),
      });
    });
    const officerA = ctxFor("officer-a");
    await assertFails(
      updateDoc(doc(officerA, "organizations", ORG_A, "issues", "issue-3"), { status: "acknowledged" })
    );
  });

  it("allows a fleet_manager to update an issue they didn't report", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, "organizations", ORG_A, "issues", "issue-4"), {
        organizationId: ORG_A,
        assetType: "vehicle",
        assetId: "vehicle-a1",
        title: "Reported by officer",
        severity: "low",
        status: "open",
        reportedByUserId: "officer-a",
        reportedAt: new Date().toISOString(),
      });
    });
    const managerA = ctxFor("manager-a");
    await assertSucceeds(
      updateDoc(doc(managerA, "organizations", ORG_A, "issues", "issue-4"), { status: "resolved" })
    );
  });
});

describe("maintenanceRecords: read for any member, write for admin/fleet_manager", () => {
  it("allows an officer to read maintenance records", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, "organizations", ORG_A, "maintenanceRecords", "record-1"), {
        organizationId: ORG_A,
        assetType: "vehicle",
        assetId: "vehicle-a1",
        maintenanceType: "oil_change",
        performedAt: new Date().toISOString(),
      });
    });
    const officerA = ctxFor("officer-a");
    await assertSucceeds(getDoc(doc(officerA, "organizations", ORG_A, "maintenanceRecords", "record-1")));
  });

  it("denies an officer writing a maintenance record", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(
      setDoc(doc(officerA, "organizations", ORG_A, "maintenanceRecords", "record-2"), {
        organizationId: ORG_A,
        assetType: "vehicle",
        assetId: "vehicle-a1",
        maintenanceType: "oil_change",
        performedAt: new Date().toISOString(),
      })
    );
  });

  it("allows a fleet_manager to write a maintenance record", async () => {
    const managerA = ctxFor("manager-a");
    await assertSucceeds(
      setDoc(doc(managerA, "organizations", ORG_A, "maintenanceRecords", "record-3"), {
        organizationId: ORG_A,
        assetType: "vehicle",
        assetId: "vehicle-a1",
        maintenanceType: "oil_change",
        performedAt: new Date().toISOString(),
      })
    );
  });
});

describe("auditLogs: client writes denied entirely, read gated to management roles", () => {
  it("denies an officer writing an auditLog", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(
      setDoc(doc(officerA, "organizations", ORG_A, "auditLogs", "log-hack"), {
        organizationId: ORG_A,
        action: "vehicle_status_changed",
        entityType: "vehicle",
        entityId: "vehicle-a1",
        performedBy: "officer-a",
        timestamp: new Date().toISOString(),
      })
    );
  });

  it("denies even a fleet_manager writing an auditLog — Admin SDK (Cloud Functions) only, not role-gated", async () => {
    const managerA = ctxFor("manager-a");
    await assertFails(
      setDoc(doc(managerA, "organizations", ORG_A, "auditLogs", "log-hack-2"), {
        organizationId: ORG_A,
        action: "vehicle_status_changed",
        timestamp: new Date().toISOString(),
      })
    );
  });

  it("denies an officer reading auditLogs", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(getDoc(doc(officerA, "organizations", ORG_A, "auditLogs", "log-1")));
  });

  it("allows a fleet_manager to read auditLogs", async () => {
    const managerA = ctxFor("manager-a");
    await assertSucceeds(getDoc(doc(managerA, "organizations", ORG_A, "auditLogs", "log-1")));
  });
});

describe("userOrgs/{uid}: readable only by that uid", () => {
  it("allows a user to read their own userOrgs doc", async () => {
    const officerA = ctxFor("officer-a");
    await assertSucceeds(getDoc(doc(officerA, "userOrgs", "officer-a")));
  });

  it("denies a user reading someone else's userOrgs doc", async () => {
    const officerA = ctxFor("officer-a");
    await assertFails(getDoc(doc(officerA, "userOrgs", "manager-a")));
  });
});

// Not a real test — just fails loudly if the fixtures themselves are
// broken, so a real failure above isn't misread as a fixture problem.
describe("fixture sanity", () => {
  it("seeded org-A vehicle exists", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      const snap = await getDoc(doc(db, "organizations", ORG_A, "vehicles", "vehicle-a1"));
      expect(snap.exists()).toBe(true);
    });
  });
});

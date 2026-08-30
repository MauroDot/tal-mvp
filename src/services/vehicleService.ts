/**
 * Vehicle data access, backed by Firestore. Schema:
 *   organizations/{orgId}/vehicles/{vehicleId}          -> Vehicle
 *   organizations/{orgId}/inspections/{inspectionId}     -> Inspection (assetType/assetId filtered)
 *   organizations/{orgId}/issues/{issueId}               -> Issue (assetType/assetId filtered)
 *   organizations/{orgId}/maintenanceRecords/{recordId}  -> MaintenanceRecord (assetType/assetId filtered)
 *
 * Inspections, issues, and maintenance records are stored per-org (not
 * nested under each vehicle) and filtered by `assetType`/`assetId`, since
 * those records already carry that discriminator (see `src/types`) and
 * this keeps fleet-wide queries (e.g. "all open issues") possible later.
 * Querying them here requires composite indexes on
 * (assetType, assetId, <orderBy field>) — Firestore will prompt for these
 * on first run if they don't exist yet.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitQuery,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { convertTimestamps, stripUndefined } from "../lib/firestoreUtils";
import type { AssetStatus, AssetType, Inspection, Issue, MaintenanceRecord, Vehicle } from "../types";

/** Optional filters accepted by {@link listVehicles}. */
export interface VehicleFilter {
  status?: AssetStatus;
  assignedUserId?: string;
}

/** Fields the caller supplies when creating a new vehicle; the rest are server-assigned. */
export type NewVehicle = Omit<Vehicle, "id" | "organizationId" | "createdAt" | "updatedAt">;

/**
 * Fetches a single Vehicle by ID from `organizations/{orgId}/vehicles/{vehicleId}`.
 * Returns `null` if no such vehicle document exists.
 */
export async function getVehicle(orgId: string, vehicleId: string): Promise<Vehicle | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "vehicles", vehicleId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<Vehicle>({ id: snapshot.id, organizationId: orgId, ...snapshot.data() });
}

/**
 * Lists vehicles in an organization, optionally filtered by status and/or
 * the user they're assigned to. With no filter, returns all vehicles.
 */
export async function listVehicles(orgId: string, filter?: VehicleFilter): Promise<Vehicle[]> {
  const constraints: QueryConstraint[] = [];
  if (filter?.status) {
    constraints.push(where("status", "==", filter.status));
  }
  if (filter?.assignedUserId) {
    constraints.push(where("assignedUserId", "==", filter.assignedUserId));
  }

  const q = query(collection(db, "organizations", orgId, "vehicles"), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) =>
    convertTimestamps<Vehicle>({ id: d.id, organizationId: orgId, ...d.data() })
  );
}

/**
 * Creates a new vehicle under `organizations/{orgId}/vehicles`.
 * `createdAt`/`updatedAt` are set via `serverTimestamp()`; the returned
 * object approximates them with the current client time since the
 * server-resolved value isn't available until the write is read back.
 */
export async function createVehicle(orgId: string, vehicle: NewVehicle): Promise<Vehicle> {
  const docRef = await addDoc(collection(db, "organizations", orgId, "vehicles"), {
    ...vehicle,
    organizationId: orgId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const now = new Date().toISOString();
  return { ...vehicle, id: docRef.id, organizationId: orgId, createdAt: now, updatedAt: now };
}

/**
 * Updates a vehicle's odometer reading and bumps `updatedAt`.
 */
export async function updateVehicleMileage(
  orgId: string,
  vehicleId: string,
  mileage: number
): Promise<void> {
  await updateDoc(doc(db, "organizations", orgId, "vehicles", vehicleId), {
    odometer: mileage,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Fetches the most recent inspections for a vehicle, newest first.
 */
export async function getVehicleInspections(
  orgId: string,
  vehicleId: string,
  limit = 10
): Promise<Inspection[]> {
  const q = query(
    collection(db, "organizations", orgId, "inspections"),
    where("assetType", "==", "vehicle"),
    where("assetId", "==", vehicleId),
    orderBy("startedAt", "desc"),
    limitQuery(limit)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => convertTimestamps<Inspection>({ id: d.id, ...d.data() }));
}

/**
 * Fetches a vehicle's most recently *completed* inspection. Orders by
 * `completedAt` (not `startedAt`), which naturally excludes
 * abandoned/in-progress inspections — Firestore's `orderBy` skips
 * documents missing that field entirely — so this never returns one with
 * no `overallResult`. Returns `null` if no inspection has ever completed.
 */
export async function getLatestCompletedInspection(orgId: string, vehicleId: string): Promise<Inspection | null> {
  const q = query(
    collection(db, "organizations", orgId, "inspections"),
    where("assetType", "==", "vehicle"),
    where("assetId", "==", vehicleId),
    orderBy("completedAt", "desc"),
    limitQuery(1)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return null;
  }
  const doc = snapshot.docs[0];
  return convertTimestamps<Inspection>({ id: doc.id, ...doc.data() });
}

/**
 * Fetches all issues reported against a vehicle, newest first.
 */
export async function getVehicleIssues(orgId: string, vehicleId: string): Promise<Issue[]> {
  const q = query(
    collection(db, "organizations", orgId, "issues"),
    where("assetType", "==", "vehicle"),
    where("assetId", "==", vehicleId),
    orderBy("reportedAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => convertTimestamps<Issue>({ id: d.id, ...d.data() }));
}

/**
 * Fetches a vehicle's full maintenance history, newest first.
 */
export async function getVehicleMaintenanceHistory(
  orgId: string,
  vehicleId: string
): Promise<MaintenanceRecord[]> {
  const q = query(
    collection(db, "organizations", orgId, "maintenanceRecords"),
    where("assetType", "==", "vehicle"),
    where("assetId", "==", vehicleId),
    orderBy("performedAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => convertTimestamps<MaintenanceRecord>({ id: d.id, ...d.data() }));
}

/** Fields the caller supplies when logging a new maintenance record; the rest are server-assigned. */
export interface NewMaintenanceRecord {
  assetType: AssetType;
  assetId: string;
  maintenanceType: string;
  description?: string;
  performedBy?: string;
  cost?: number;
  meterReadingAtService?: number;
  /** ISO date string. Stored as a Firestore Timestamp, not a raw string —
   * getVehicleMaintenanceHistory's `orderBy("performedAt")` needs every
   * document's value to be the same type to sort consistently. */
  performedAt: string;
}

/**
 * Logs a new maintenance record under `organizations/{orgId}/maintenanceRecords`.
 * Returns the new record's ID.
 */
export async function createMaintenanceRecord(orgId: string, record: NewMaintenanceRecord): Promise<string> {
  const ref = doc(collection(db, "organizations", orgId, "maintenanceRecords"));
  await setDoc(
    ref,
    stripUndefined({
      organizationId: orgId,
      assetType: record.assetType,
      assetId: record.assetId,
      maintenanceType: record.maintenanceType,
      description: record.description,
      performedBy: record.performedBy,
      cost: record.cost,
      meterReadingAtService: record.meterReadingAtService,
      performedAt: Timestamp.fromDate(new Date(record.performedAt)),
      createdAt: serverTimestamp(),
    })
  );
  return ref.id;
}

/**
 * Manually overrides a vehicle's status — pulling it for a recall
 * ("out_of_service"), or putting it back into service ("ready"). This is
 * a direct write, not a re-derivation: `recalculateVehicleStatus`
 * (functions/src/index.ts) only runs off inspection/issue events, so
 * "Return to Active" sets "ready" outright rather than checking for
 * still-open issues first — the same way setting "out_of_service" is a
 * direct write, not a computed one. Rule 1 of deriveVehicleStatus
 * preserves whatever this writes until the next inspection or issue
 * event recalculates it again.
 *
 * Also writes an auditLogs entry in the same batch, matching the shape
 * `recalculateVehicleStatus` writes for automatic changes — except
 * `performedBy` is the actual admin/fleet_manager (not "system") and
 * `rule`/`triggeredBy` are "manual_override" rather than a Cloud
 * Function name, so the two kinds of entry stay distinguishable in the
 * audit trail.
 *
 * Requires a Firestore rules allowance beyond what the rest of this app
 * assumes: auditLogs writes were previously denied to every client
 * outright ("Cloud Functions/Admin SDK only"). firestore.rules now carves
 * out one narrow exception — admin/fleet_manager may `create` (never
 * update/delete) an auditLogs entry — specifically for this path.
 */
export async function overrideVehicleStatus(
  orgId: string,
  vehicleId: string,
  newStatus: "out_of_service" | "ready",
  performedByUserId: string
): Promise<void> {
  const vehicleRef = doc(db, "organizations", orgId, "vehicles", vehicleId);
  const vehicleSnap = await getDoc(vehicleRef);
  if (!vehicleSnap.exists()) {
    throw new Error(`Vehicle ${vehicleId} not found in organization ${orgId}`);
  }
  const previousStatus = (vehicleSnap.data().status as AssetStatus | undefined) ?? "unknown";

  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(vehicleRef, { status: newStatus, updatedAt: now });
  batch.set(doc(collection(db, "organizations", orgId, "auditLogs")), {
    organizationId: orgId,
    action: "vehicle_status_changed",
    entityType: "vehicle",
    entityId: vehicleId,
    performedBy: performedByUserId,
    metadata: {
      previousStatus,
      newStatus,
      rule: "manual_override",
      triggeredBy: "manual_override",
      triggeredByEntityId: vehicleId,
    },
    timestamp: now,
  });
  await batch.commit();
}

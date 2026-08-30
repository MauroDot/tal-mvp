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
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as limitQuery,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
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
 * True if no *other* vehicle in the org already has this unit number
 * (exact match, same casing the form collects). Pass `excludeVehicleId`
 * when checking during an edit so a vehicle doesn't collide with itself.
 * A single equality `where()` — Firestore auto-indexes single fields, so
 * this needs no entry in firestore.indexes.json.
 */
export async function isUnitNumberAvailable(
  orgId: string,
  unitNumber: string,
  excludeVehicleId?: string
): Promise<boolean> {
  const q = query(collection(db, "organizations", orgId, "vehicles"), where("unitNumber", "==", unitNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every((d) => d.id === excludeVehicleId);
}

/** Fields the management UI collects for a new vehicle. `status` isn't among them — see addVehicle. */
export interface NewVehicleFields {
  unitNumber: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  odometer?: number;
  /** Officer to assign the vehicle to; omit/empty for unassigned. */
  assignedUserId?: string;
}

/**
 * Creates a new vehicle. Always starts at status "unknown" — never
 * inspected, no signal yet to derive anything else from (see
 * deriveVehicleStatus's precedence rules, functions/src/index.ts) —
 * callers don't get to set it. Validates unitNumber is unique within the
 * org first and throws if it's already taken. Writes an auditLogs
 * "vehicle_created" entry in the same batch, matching the shape
 * `overrideVehicleStatus` uses. Returns the new vehicle's ID.
 */
export async function addVehicle(
  orgId: string,
  fields: NewVehicleFields,
  performedByUserId: string
): Promise<string> {
  const unitNumber = fields.unitNumber.trim();
  if (!unitNumber) {
    throw new Error("Unit number is required.");
  }
  if (!(await isUnitNumberAvailable(orgId, unitNumber))) {
    throw new Error(`Unit number "${unitNumber}" is already in use in this organization.`);
  }

  const vehicleRef = doc(collection(db, "organizations", orgId, "vehicles"));
  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(
    vehicleRef,
    stripUndefined({
      organizationId: orgId,
      unitNumber,
      year: fields.year,
      make: fields.make?.trim() || undefined,
      model: fields.model?.trim() || undefined,
      vin: fields.vin?.trim() || undefined,
      odometer: fields.odometer,
      assignedUserId: fields.assignedUserId || undefined,
      status: "unknown",
      createdAt: now,
      updatedAt: now,
    })
  );
  batch.set(doc(collection(db, "organizations", orgId, "auditLogs")), {
    organizationId: orgId,
    action: "vehicle_created",
    entityType: "vehicle",
    entityId: vehicleRef.id,
    performedBy: performedByUserId,
    metadata: { unitNumber, status: "unknown" },
    timestamp: now,
  });
  await batch.commit();
  return vehicleRef.id;
}

/** Fields the management UI collects when editing an existing vehicle. */
export interface VehicleEditFields {
  unitNumber: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  odometer?: number;
  assignedUserId?: string;
}

export interface UpdateVehicleResult {
  /** True if a lower odometer value was submitted and *not* applied — see updateVehicle. */
  odometerSkipped: boolean;
}

/**
 * Edits a vehicle's identifying/assignment fields. Re-validates
 * unitNumber uniqueness (excluding this vehicle itself) if it changed.
 *
 * Odometer is monotonic — this never lets it decrease. If the submitted
 * value is lower than what's currently stored, the stored value is kept
 * and `odometerSkipped: true` comes back so the UI can say so. That's a
 * simpler and more robust guarantee than trying to detect "this form was
 * loaded before a newer reading came in": it holds regardless of *what*
 * produced the higher reading (today, nothing else writes odometer — no
 * inspection flow touches it — but the guard costs nothing and holds up
 * if/when one does).
 *
 * Clearing an optional field in the form removes it from the document
 * (via `deleteField()`) rather than leaving the old value in place.
 * Writes an auditLogs "vehicle_updated" entry listing which fields
 * changed — skipped entirely if nothing actually did.
 */
export async function updateVehicle(
  orgId: string,
  vehicleId: string,
  fields: VehicleEditFields,
  performedByUserId: string
): Promise<UpdateVehicleResult> {
  const vehicleRef = doc(db, "organizations", orgId, "vehicles", vehicleId);
  const snap = await getDoc(vehicleRef);
  if (!snap.exists()) {
    throw new Error(`Vehicle ${vehicleId} not found in organization ${orgId}`);
  }
  const current = snap.data() as Record<string, unknown>;

  const unitNumber = fields.unitNumber.trim();
  if (!unitNumber) {
    throw new Error("Unit number is required.");
  }
  if (unitNumber !== current.unitNumber && !(await isUnitNumberAvailable(orgId, unitNumber, vehicleId))) {
    throw new Error(`Unit number "${unitNumber}" is already in use in this organization.`);
  }

  const currentOdometer = typeof current.odometer === "number" ? current.odometer : undefined;
  const odometerSkipped =
    fields.odometer != null && currentOdometer != null && fields.odometer < currentOdometer;

  // undefined here means "clear this field" — resolved to deleteField()
  // below, once the diff against `current` is computed off plain values.
  const resolved: Record<string, unknown> = {
    unitNumber,
    year: fields.year ?? undefined,
    make: fields.make?.trim() || undefined,
    model: fields.model?.trim() || undefined,
    vin: fields.vin?.trim() || undefined,
    assignedUserId: fields.assignedUserId || undefined,
  };
  if (fields.odometer != null && !odometerSkipped) {
    resolved.odometer = fields.odometer;
  }

  const changedFields = Object.keys(resolved).filter((key) => (resolved[key] ?? null) !== (current[key] ?? null));

  const now = serverTimestamp();
  const batch = writeBatch(db);
  const updatePayload: Record<string, unknown> = { updatedAt: now };
  for (const [key, value] of Object.entries(resolved)) {
    updatePayload[key] = value === undefined ? deleteField() : value;
  }
  batch.update(vehicleRef, updatePayload);

  if (changedFields.length > 0) {
    batch.set(doc(collection(db, "organizations", orgId, "auditLogs")), {
      organizationId: orgId,
      action: "vehicle_updated",
      entityType: "vehicle",
      entityId: vehicleId,
      performedBy: performedByUserId,
      metadata: { changedFields },
      timestamp: now,
    });
  }

  await batch.commit();
  return { odometerSkipped };
}

/**
 * Retires a vehicle — sets status to "retired" rather than deleting it.
 * Inspection and maintenance history stay exactly as they are; the
 * vehicle just drops off the fleet page's default view (see
 * fleet/page.tsx's `showRetired` toggle) and can no longer have new
 * inspections started (see inspections/new/page.tsx). No delete path is
 * offered anywhere — a department needs the history.
 *
 * Sets `outOfServiceDate` to today, and writes an auditLogs
 * "vehicle_retired" entry recording the previous status, matching the
 * shape `overrideVehicleStatus` uses.
 */
export async function retireVehicle(orgId: string, vehicleId: string, performedByUserId: string): Promise<void> {
  const vehicleRef = doc(db, "organizations", orgId, "vehicles", vehicleId);
  const snap = await getDoc(vehicleRef);
  if (!snap.exists()) {
    throw new Error(`Vehicle ${vehicleId} not found in organization ${orgId}`);
  }
  const previousStatus = (snap.data().status as AssetStatus | undefined) ?? "unknown";

  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(vehicleRef, { status: "retired", outOfServiceDate: new Date().toISOString(), updatedAt: now });
  batch.set(doc(collection(db, "organizations", orgId, "auditLogs")), {
    organizationId: orgId,
    action: "vehicle_retired",
    entityType: "vehicle",
    entityId: vehicleId,
    performedBy: performedByUserId,
    metadata: { previousStatus, newStatus: "retired" },
    timestamp: now,
  });
  await batch.commit();
}

/**
 * Changes (or clears, with `assignedUserId: null`) which officer a
 * vehicle is assigned to. A dedicated, single-field action distinct from
 * the general edit flow — `updateVehicle` can also touch `assignedUserId`
 * as part of a broader edit, but going through *this* path logs a
 * "vehicle_reassigned" entry rather than "vehicle_updated", so the audit
 * trail can tell "the record changed" apart from "this vehicle changed
 * hands" at a glance.
 */
export async function reassignVehicle(
  orgId: string,
  vehicleId: string,
  assignedUserId: string | null,
  performedByUserId: string
): Promise<void> {
  const vehicleRef = doc(db, "organizations", orgId, "vehicles", vehicleId);
  const snap = await getDoc(vehicleRef);
  if (!snap.exists()) {
    throw new Error(`Vehicle ${vehicleId} not found in organization ${orgId}`);
  }
  const previousAssignedUserId = (snap.data().assignedUserId as string | undefined) ?? null;

  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(vehicleRef, {
    assignedUserId: assignedUserId ? assignedUserId : deleteField(),
    updatedAt: now,
  });
  batch.set(doc(collection(db, "organizations", orgId, "auditLogs")), {
    organizationId: orgId,
    action: "vehicle_reassigned",
    entityType: "vehicle",
    entityId: vehicleId,
    performedBy: performedByUserId,
    metadata: { previousAssignedUserId, newAssignedUserId: assignedUserId },
    timestamp: now,
  });
  await batch.commit();
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

/**
 * Equipment data access, backed by Firestore. Schema:
 *   organizations/{orgId}/equipment/{equipmentId} -> Equipment
 *
 * Mirrors the read/write conventions in `vehicleService.ts` (same
 * `convertTimestamps` helper, same `addDoc` + `serverTimestamp()` create
 * pattern) since Vehicle and Equipment share the same status model.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { convertTimestamps } from "../lib/firestoreUtils";
import type { AssetStatus, Equipment } from "../types";

/** Optional filters accepted by {@link listEquipment}. */
export interface EquipmentFilter {
  status?: AssetStatus;
  assignedUserId?: string;
}

/** Fields the caller supplies when creating new equipment; the rest are server-assigned. */
export type NewEquipment = Omit<Equipment, "id" | "organizationId" | "createdAt" | "updatedAt">;

/** Fields accepted by {@link updateEquipmentDates}. */
export interface EquipmentDatesUpdate {
  inspectionDate?: string;
  expirationDate?: string;
}

/**
 * Fetches a single piece of Equipment by ID from
 * `organizations/{orgId}/equipment/{equipmentId}`. Returns `null` if no
 * such document exists.
 */
export async function getEquipment(orgId: string, equipmentId: string): Promise<Equipment | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "equipment", equipmentId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<Equipment>({ id: snapshot.id, organizationId: orgId, ...snapshot.data() });
}

/**
 * Lists equipment in an organization, optionally filtered by status
 * and/or the user it's assigned to. With no filter, returns all equipment.
 */
export async function listEquipment(orgId: string, filter?: EquipmentFilter): Promise<Equipment[]> {
  const constraints: QueryConstraint[] = [];
  if (filter?.status) {
    constraints.push(where("status", "==", filter.status));
  }
  if (filter?.assignedUserId) {
    constraints.push(where("assignedUserId", "==", filter.assignedUserId));
  }

  const q = query(collection(db, "organizations", orgId, "equipment"), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) =>
    convertTimestamps<Equipment>({ id: d.id, organizationId: orgId, ...d.data() })
  );
}

/**
 * Creates a new equipment record under `organizations/{orgId}/equipment`.
 * `createdAt`/`updatedAt` are set via `serverTimestamp()`; the returned
 * object approximates them with the current client time since the
 * server-resolved value isn't available until the write is read back.
 * `inspectionDate`/`expirationDate`, if provided, are stored as Firestore
 * `Timestamp`s (not raw strings) so range queries against them — e.g. the
 * `checkEquipmentExpiration` Cloud Function's `expirationDate < now` — work.
 */
export async function createEquipment(orgId: string, equipment: NewEquipment): Promise<Equipment> {
  const docRef = await addDoc(collection(db, "organizations", orgId, "equipment"), {
    ...equipment,
    organizationId: orgId,
    ...(equipment.inspectionDate && { inspectionDate: Timestamp.fromDate(new Date(equipment.inspectionDate)) }),
    ...(equipment.expirationDate && { expirationDate: Timestamp.fromDate(new Date(equipment.expirationDate)) }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const now = new Date().toISOString();
  return { ...equipment, id: docRef.id, organizationId: orgId, createdAt: now, updatedAt: now };
}

/**
 * Assigns a piece of equipment to a user (or reassigns it) and bumps
 * `updatedAt`.
 */
export async function assignEquipment(orgId: string, equipmentId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, "organizations", orgId, "equipment", equipmentId), {
    assignedUserId: userId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Updates a piece of equipment's inspection/expiration dates. Only the
 * fields provided are written; omitted fields are left unchanged. Dates
 * are stored as Firestore `Timestamp`s (converted from the input ISO
 * strings), not raw strings — see {@link createEquipment} for why.
 */
export async function updateEquipmentDates(
  orgId: string,
  equipmentId: string,
  dates: EquipmentDatesUpdate
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (dates.inspectionDate !== undefined) {
    update.inspectionDate = Timestamp.fromDate(new Date(dates.inspectionDate));
  }
  if (dates.expirationDate !== undefined) {
    update.expirationDate = Timestamp.fromDate(new Date(dates.expirationDate));
  }

  await updateDoc(doc(db, "organizations", orgId, "equipment", equipmentId), update);
}

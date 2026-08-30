/**
 * Shared Firestore data-shaping helpers used across the `services/*` layer.
 */
import { Timestamp, type DocumentData } from "firebase/firestore";

/**
 * Converts any Firestore `Timestamp` fields on a document's data into ISO
 * 8601 strings (matching the `string` timestamp fields on our domain
 * types), leaving all other fields untouched.
 */
export function convertTimestamps<T>(data: DocumentData): T {
  const result: DocumentData = { ...data };
  for (const key of Object.keys(result)) {
    if (result[key] instanceof Timestamp) {
      result[key] = result[key].toDate().toISOString();
    }
  }
  return result as T;
}

/**
 * Returns a shallow copy of `obj` with every key whose value is
 * `undefined` removed. Firestore rejects `undefined` field values outright
 * in `setDoc`/`updateDoc` — including inside array elements, where there's
 * no `ignoreUndefinedProperties`-style setting to fall back on — so any
 * object built from optional or possibly-empty inputs should be passed
 * through this immediately before being written.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

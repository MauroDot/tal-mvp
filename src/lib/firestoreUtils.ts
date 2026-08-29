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

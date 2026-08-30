/**
 * Formats an ISO date/datetime string for display (e.g. "Aug 30, 2026").
 * Returns "—" for a missing value, or the raw string if it fails to parse.
 */
import { format } from "date-fns";

export function formatDate(value?: string): string {
  if (!value) {
    return "—";
  }
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

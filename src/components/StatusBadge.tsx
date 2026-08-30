/**
 * Color-coded pill badge for a Vehicle/Equipment's {@link AssetStatus}.
 */
import type { AssetStatus } from "@/types";

const STATUS_STYLES: Record<AssetStatus, string> = {
  ready: "bg-green-100 text-green-800",
  attention: "bg-yellow-100 text-yellow-800",
  maintenance_required: "bg-orange-100 text-orange-800",
  out_of_service: "bg-red-100 text-red-800",
  retired: "bg-gray-200 text-gray-600",
  unknown: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<AssetStatus, string> = {
  ready: "Ready",
  attention: "Attention",
  maintenance_required: "Maintenance Required",
  out_of_service: "Out of Service",
  retired: "Retired",
  unknown: "Unknown",
};

interface StatusBadgeProps {
  status: AssetStatus;
  className?: string;
}

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]} ${className}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Tactical Asset Log core domain types.
 *
 * These interfaces describe the shape of data as it is stored and moved
 * through the application (API payloads, database rows mapped to camelCase,
 * and client-side state). Timestamps are ISO 8601 strings unless noted.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Roles a User can hold within an Organization, from broadest to narrowest access. */
export type UserRole =
  | "admin" // Full control: org settings, billing, user management, all fleet data
  | "fleet_manager" // Manages vehicles, equipment, work orders, and assignments org-wide
  | "equipment_manager" // Scoped to equipment (non-vehicle assets): inspections, maintenance, work orders
  | "supervisor" // Oversees a team/site: reviews inspections, approves issues, assigns work
  | "officer" // Field role: performs inspections, reports issues, operates assigned assets
  | "readonly"; // View-only access to dashboards and records, no write actions

/**
 * Operational status shared by both Vehicles and Equipment.
 * Reflects whether an asset is safe/available to use right now.
 */
export type AssetStatus =
  | "ready" // Passed inspection, no open issues, available for use
  | "attention" // Minor issue(s) open but asset is still usable; needs monitoring
  | "maintenance_required" // A defect requires service before the asset should be used again
  | "out_of_service" // Actively pulled from service (safety hold, awaiting parts, etc.)
  | "retired" // Permanently decommissioned; kept for historical records only
  | "unknown"; // Status has not been established yet (e.g. newly added, no inspection on file)

/** Severity of a reported Issue/Defect, used for triage and alerting. */
export type IssueSeverity =
  | "low" // Cosmetic or informational; no impact on safe operation
  | "medium" // Should be addressed soon; does not block current use
  | "high" // Impacts safe/effective operation; use with caution
  | "critical"; // Asset must not be used until resolved

/** Lifecycle state of an Issue/Defect from discovery to close-out. */
export type IssueStatus =
  | "open" // Reported, not yet triaged or actioned
  | "acknowledged" // Seen by a manager/supervisor, awaiting scheduling
  | "in_progress" // Actively being worked (usually tied to a WorkOrder)
  | "resolved" // Fix completed, pending verification
  | "closed"; // Verified and closed out, no further action needed

/** `IssueStatus` values that count as "still open" — not yet resolved or closed. */
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = ["open", "acknowledged", "in_progress"];

/** Lifecycle state of a WorkOrder. */
export type WorkOrderStatus =
  | "open" // Created, not yet acknowledged by anyone
  | "acknowledged" // Seen by a manager/supervisor, awaiting work starting
  | "in_progress" // Work has started
  | "completed" // Work finished; the linked issue(s) are resolved as a result
  | "cancelled"; // Abandoned without completion (not part of the normal forward flow)

/** Priority used for scheduling WorkOrders. */
export type WorkOrderPriority = "low" | "normal" | "high" | "urgent";

/** How an InspectionItemResult was answered. */
export type InspectionItemResponseType =
  | "pass_fail" // Simple pass/fail checkbox item
  | "numeric" // Numeric reading (e.g. tire pressure, fluid level)
  | "text" // Free-text note
  | "photo"; // Photo evidence required/attached

/** Severity/kind of an Alert surfaced to users. */
export type AlertType =
  | "issue_reported" // A new Issue/Defect was logged
  | "inspection_overdue" // A scheduled/expected inspection is late
  | "maintenance_due" // Preventive maintenance is coming due or overdue
  | "work_order_status_change" // A WorkOrder moved to a new status
  | "asset_status_change" // A Vehicle/Equipment status changed (e.g. to out_of_service)
  | "assignment_change"; // An Assignment was created, changed, or ended

/** Severity level for Alert presentation (banner color, sort order, etc.). */
export type AlertSeverity = "info" | "warning" | "critical";

/** Type of asset an Assignment, MaintenanceRecord, etc. refers to. */
export type AssetType = "vehicle" | "equipment";

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/**
 * A tenant in the multi-tenant system. All other records (users, vehicles,
 * equipment, etc.) belong to exactly one Organization and are scoped by it.
 */
export interface Organization {
  /** Unique identifier (UUID). */
  id: string;
  /** Display name shown throughout the UI. */
  name: string;
  /** URL-safe unique identifier used in routes (e.g. /org/acme-trucking). */
  slug: string;
  /** Optional logo image URL shown in the app header/branding. */
  logoUrl?: string;
  /** IANA timezone name (e.g. "America/Denver") used to localize schedules and reports. */
  timezone: string;
  /** Subscription/plan tier, used to gate features (e.g. "free", "pro", "enterprise"). */
  plan: string;
  /** Whether the organization is active; false hides it and blocks logins. */
  isActive: boolean;
  /** When the organization record was created. */
  createdAt: string;
  /** When the organization record was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/**
 * A person who can log into Tactical Asset Log. Always belongs to one Organization
 * and holds one primary role that determines their permissions.
 */
export interface User {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this user belongs to. */
  organizationId: string;
  /** Login email address; unique per organization. */
  email: string;
  /** User's given name. */
  firstName: string;
  /** User's family name. */
  lastName: string;
  /** Optional phone number for SMS alerts / contact. */
  phone?: string;
  /** Optional avatar/profile image URL. */
  avatarUrl?: string;
  /** Permission role controlling what the user can see and do. See {@link UserRole}. */
  role: UserRole;
  /** Optional job title / free-text label shown in the UI (distinct from `role`). */
  title?: string;
  /** IDs of sites/depots/locations this user is scoped to; empty/undefined means org-wide. */
  locationIds?: string[];
  /** Whether the user account can currently log in. */
  isActive: boolean;
  /** Timestamp of the user's last successful login, if any. */
  lastLoginAt?: string;
  /** When the user record was created. */
  createdAt: string;
  /** When the user record was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

/**
 * A motorized, licensed/titled fleet asset (truck, van, trailer, etc.)
 * that undergoes inspections and maintenance.
 */
export interface Vehicle {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization that owns this vehicle. */
  organizationId: string;
  /** Fleet-assigned unit/asset number (e.g. "T-104"), shown as the primary label. */
  unitNumber: string;
  /** Vehicle Identification Number. */
  vin?: string;
  /** License plate number. */
  licensePlate?: string;
  /** State/province that issued the license plate. */
  licensePlateState?: string;
  /** Manufacturer (e.g. "Ford"). */
  make?: string;
  /** Model name (e.g. "F-150"). */
  model?: string;
  /** Model year. */
  year?: number;
  /** Vehicle type/class (e.g. "pickup", "box_truck", "trailer", "sedan"). */
  vehicleType?: string;
  /** Current odometer reading, in the unit specified by `odometerUnit`. */
  odometer?: number;
  /** Unit for `odometer` — "miles" or "km". */
  odometerUnit?: "miles" | "km";
  /** Current overall operational status. See {@link AssetStatus}. */
  status: AssetStatus;
  /** Site/depot/yard where the vehicle is normally based. */
  locationId?: string;
  /** User ID of the person currently/primarily assigned to this vehicle, if any. */
  assignedUserId?: string;
  /** Date the vehicle was placed into service. */
  inServiceDate?: string;
  /** Date the vehicle was taken out of service permanently, if retired. */
  outOfServiceDate?: string;
  /** Free-text notes visible to fleet staff. */
  notes?: string;
  /** Arbitrary org-defined tags for filtering/grouping (e.g. ["refrigerated", "cdl-required"]). */
  tags?: string[];
  /** Optional photo URL of the vehicle. */
  photoUrl?: string;
  /** When the vehicle record was created. */
  createdAt: string;
  /** When the vehicle record was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/**
 * A non-vehicle fleet asset (generator, forklift, trailer-mounted tool,
 * heavy machinery, etc.) that undergoes inspections and maintenance,
 * mirroring the Vehicle status model.
 */
export interface Equipment {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization that owns this equipment. */
  organizationId: string;
  /** Fleet-assigned unit/asset number, shown as the primary label. */
  unitNumber: string;
  /** Human-readable name (e.g. "20kW Diesel Generator"). */
  name: string;
  /** Manufacturer. */
  make?: string;
  /** Model name/number. */
  model?: string;
  /** Serial number from the manufacturer. */
  serialNumber?: string;
  /** Equipment category (e.g. "generator", "forklift", "compressor"). */
  equipmentType?: string;
  /** Manufacture/model year. */
  year?: number;
  /** Current meter reading (e.g. engine hours), in the unit specified by `meterUnit`. */
  meterReading?: number;
  /** Unit for `meterReading` — "hours" or "miles" or "cycles". */
  meterUnit?: "hours" | "miles" | "cycles";
  /** Current overall operational status. See {@link AssetStatus}. */
  status: AssetStatus;
  /** Site/depot/yard where the equipment is normally based. */
  locationId?: string;
  /** User ID of the person currently/primarily assigned to this equipment, if any. */
  assignedUserId?: string;
  /** Date the equipment was placed into service. */
  inServiceDate?: string;
  /** Date the equipment was taken out of service permanently, if retired. */
  outOfServiceDate?: string;
  /** Date of the equipment's last required inspection/certification (e.g. annual fire extinguisher check). */
  inspectionDate?: string;
  /** Date the equipment's current certification/inspection expires and re-inspection is due. */
  expirationDate?: string;
  /** Free-text notes visible to fleet staff. */
  notes?: string;
  /** Arbitrary org-defined tags for filtering/grouping. */
  tags?: string[];
  /** Optional photo URL of the equipment. */
  photoUrl?: string;
  /** When the equipment record was created. */
  createdAt: string;
  /** When the equipment record was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inspection Template
// ---------------------------------------------------------------------------

/**
 * A single checklist line item within an InspectionTemplate, defining what
 * to check and how the response should be captured.
 */
export interface TemplateItem {
  /** Unique identifier (UUID). */
  id: string;
  /** Template this item belongs to. */
  templateId: string;
  /** Display order within the template/section (ascending). */
  sortOrder: number;
  /** Optional grouping/section label (e.g. "Brakes", "Lights & Signals"). */
  section?: string;
  /** The prompt shown to the inspector (e.g. "Check tire tread depth"). */
  label: string;
  /** Longer guidance/instructions for how to perform the check. */
  description?: string;
  /** How the inspector should respond to this item. See {@link InspectionItemResponseType}. */
  responseType: InspectionItemResponseType;
  /** Whether a response to this item is mandatory to complete the inspection. */
  isRequired: boolean;
  /** Whether passing/answering this item also requires attaching a photo as evidence. */
  requiresPhoto: boolean;
  /** Whether passing/answering this item also requires a free-text note. */
  requiresNote: boolean;
  /** Whether a failed/out-of-range response should automatically create an Issue. */
  autoCreateIssueOnFail: boolean;
  /** For `responseType: "numeric"`, the minimum acceptable value. */
  minValue?: number;
  /** For `responseType: "numeric"`, the maximum acceptable value. */
  maxValue?: number;
  /** For `responseType: "numeric"`, the unit label (e.g. "psi", "mm"). */
  unit?: string;
}

/**
 * A reusable checklist definition used to run Inspections against Vehicles
 * or Equipment (e.g. "Daily Pre-Trip", "Monthly Preventive Maintenance").
 */
export interface InspectionTemplate {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization that owns this template. */
  organizationId: string;
  /** Display name of the template. */
  name: string;
  /** Longer description of the template's purpose/scope. */
  description?: string;
  /** Which asset type this template applies to. See {@link AssetType}. */
  appliesTo: AssetType;
  /** Ordered checklist items belonging to this template. */
  items: TemplateItem[];
  /** Suggested recurrence in days (e.g. 1 for daily, 30 for monthly); undefined if ad hoc. */
  recurrenceDays?: number;
  /** Whether this template is currently offered when starting a new inspection. At most one template per `appliesTo` should be active at once (enforced by inspectionTemplateService.activateTemplate, not by Firestore rules). */
  isActive: boolean;
  /**
   * Version number within this template's lineage, starting at 1.
   * Editing a template (see inspectionTemplateService.updateTemplate)
   * never changes an existing version's document — it creates a new one
   * with `version` incremented, so a completed Inspection's
   * `templateId`/`templateVersion` keep resolving to the exact content
   * that was in effect when it ran, forever.
   */
  version: number;
  /**
   * Stable id shared by every version of one template's lineage — set to
   * the version-1 document's own id and copied forward on every
   * subsequent version. Groups `organizations/{orgId}/inspectionTemplates`
   * documents that are "the same template" across edits, since each edit
   * is a new document with a new id.
   */
  familyId: string;
  /** The version this one was created from, if it was created by editing an earlier version rather than from scratch. */
  previousVersionId?: string;
  /** When the template was created. */
  createdAt: string;
  /** When the template was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/**
 * The recorded response to a single TemplateItem within one Inspection.
 */
export interface InspectionItemResult {
  /** Unique identifier (UUID). */
  id: string;
  /** Inspection this result belongs to. */
  inspectionId: string;
  /** TemplateItem this result answers. */
  templateItemId: string;
  /** Snapshot of the item's label at the time of inspection (survives template edits). */
  itemLabel: string;
  /** Whether the item passed; undefined if not applicable to the response type. */
  passed?: boolean;
  /** Numeric reading, when `responseType` is "numeric". */
  numericValue?: number;
  /** Free-text response/notes for this item. */
  textValue?: string;
  /** IDs of photos captured as evidence for this item (see `uploadInspectionPhoto`); resolve to display URLs at render time. */
  photoIds?: string[];
  /** ID of the Issue auto-created or linked as a result of this response, if any. */
  issueId?: string;
  /** When this specific item was answered. */
  respondedAt: string;
}

/**
 * A completed or in-progress inspection run against a Vehicle or Equipment,
 * using a specific InspectionTemplate.
 */
export interface Inspection {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this inspection belongs to. */
  organizationId: string;
  /** Template used to generate this inspection's checklist — a specific version's document id, frozen at `startInspection` time (see inspectionTemplateService for why editing a template never changes this document out from under an existing Inspection). */
  templateId: string;
  /** The `InspectionTemplate.version` in effect at `templateId` when this inspection started — recorded alongside `templateId` for a human-readable audit trail (the id alone is already sufficient to resolve the exact content). */
  templateVersion: number;
  /** Which asset type was inspected. See {@link AssetType}. */
  assetType: AssetType;
  /** ID of the Vehicle or Equipment inspected (matches `assetType`). */
  assetId: string;
  /** User who performed the inspection. */
  inspectorUserId: string;
  /** Odometer or meter reading recorded at the time of inspection, if applicable. */
  meterReading?: number;
  /** Overall pass/fail outcome, derived from item results. */
  overallResult: "pass" | "fail" | "pass_with_issues";
  /** Individual checklist responses. */
  items: InspectionItemResult[];
  /** IDs of Issues created as a result of this inspection. */
  issueIds: string[];
  /** Free-text summary/notes for the inspection as a whole. */
  notes?: string;
  /** Inspector's signature image URL or typed signature confirming completion. */
  signatureUrl?: string;
  /** When the inspection was started. */
  startedAt: string;
  /** When the inspection was completed; undefined while still in progress. */
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Issue / Defect
// ---------------------------------------------------------------------------

/**
 * A reported problem/defect on a Vehicle or Equipment, whether discovered
 * during an Inspection or reported ad hoc.
 */
export interface Issue {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this issue belongs to. */
  organizationId: string;
  /** Which asset type is affected. See {@link AssetType}. */
  assetType: AssetType;
  /** ID of the Vehicle or Equipment affected (matches `assetType`). */
  assetId: string;
  /** Inspection this issue originated from, if auto-created during one. */
  inspectionId?: string;
  /** Short title summarizing the problem (e.g. "Left rear tire low tread"). */
  title: string;
  /** Detailed description of the problem. */
  description?: string;
  /** How severe the issue is. See {@link IssueSeverity}. */
  severity: IssueSeverity;
  /** Current lifecycle state. See {@link IssueStatus}. */
  status: IssueStatus;
  /** User who reported the issue. */
  reportedByUserId: string;
  /** User currently responsible for resolving the issue, if assigned. */
  assignedToUserId?: string;
  /** IDs of photos documenting the issue (see `uploadInspectionPhoto`); resolve to display URLs at render time. */
  photoIds?: string[];
  /** WorkOrder created to resolve this issue, if any. */
  workOrderId?: string;
  /** Notes added when the issue was resolved (root cause, fix applied, etc.). */
  resolutionNotes?: string;
  /** When the issue was reported. */
  reportedAt: string;
  /** When the issue was resolved, if it has been. */
  resolvedAt?: string;
  /** When the issue record was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Work Order
// ---------------------------------------------------------------------------

/**
 * A unit of maintenance/repair work scheduled or performed on a Vehicle or
 * Equipment, optionally tied to one or more Issues.
 */
export interface WorkOrder {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this work order belongs to. */
  organizationId: string;
  /** Human-friendly work order number shown in the UI (e.g. "WO-2024-0312"). */
  workOrderNumber: string;
  /** Which asset type this work order is for. See {@link AssetType}. */
  assetType: AssetType;
  /** ID of the Vehicle or Equipment worked on (matches `assetType`). */
  assetId: string;
  /** IDs of Issues this work order addresses. */
  issueIds: string[];
  /** Short summary of the work to be done. */
  title: string;
  /** Detailed description / scope of work. */
  description?: string;
  /** Current lifecycle state. See {@link WorkOrderStatus}. */
  status: WorkOrderStatus;
  /** Scheduling priority. See {@link WorkOrderPriority}. */
  priority: WorkOrderPriority;
  /** User who created/requested the work order. */
  requestedByUserId: string;
  /**
   * Free-text label for who's doing the work — a person's name or an
   * outside shop ("Joe's Auto Shop"). Deliberately not a User reference:
   * small departments route most repairs to outside vendors, so this
   * can't be restricted to org accounts. The UI offers the org's users as
   * autocomplete suggestions, but any text is accepted.
   */
  assignedTo?: string;
  /** Name of the outside vendor/shop performing the work, if external. */
  vendorName?: string;
  /** Planned start date for the work. */
  scheduledDate?: string;
  /** Actual date the work was completed. */
  completedDate?: string;
  /** Estimated total cost (parts + labor), in the organization's currency. */
  estimatedCost?: number;
  /** Actual total cost once completed. */
  actualCost?: number;
  /** When the work order record was created. */
  createdAt: string;
  /** When the work order record was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Maintenance Record
// ---------------------------------------------------------------------------

/**
 * A historical record of maintenance performed on a Vehicle or Equipment —
 * either logged directly or generated from a completed WorkOrder.
 */
export interface MaintenanceRecord {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this record belongs to. */
  organizationId: string;
  /** Which asset type this record is for. See {@link AssetType}. */
  assetType: AssetType;
  /** ID of the Vehicle or Equipment serviced (matches `assetType`). */
  assetId: string;
  /** WorkOrder this record was generated from, if applicable. */
  workOrderId?: string;
  /** Type of maintenance performed (e.g. "oil_change", "brake_service", "annual_inspection"). */
  maintenanceType: string;
  /** Description of the work performed. */
  description?: string;
  /** Odometer/meter reading at the time of service. */
  meterReadingAtService?: number;
  /** Total cost of parts and labor for this service event. */
  cost?: number;
  /** Name of the technician or vendor who performed the work. */
  performedBy?: string;
  /** Suggested next meter reading at which this maintenance should recur. */
  nextDueMeterReading?: number;
  /** Suggested next calendar date at which this maintenance should recur. */
  nextDueDate?: string;
  /** URLs to receipts, invoices, or service reports. */
  attachmentUrls?: string[];
  /** Date the service was performed. */
  performedAt: string;
  /** When the record was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

/**
 * A system-generated notification surfaced to one or more users, typically
 * shown in a notification center / bell menu.
 */
export interface Alert {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this alert belongs to. */
  organizationId: string;
  /** What kind of event triggered this alert. See {@link AlertType}. */
  type: AlertType;
  /** Presentation severity. See {@link AlertSeverity}. */
  severity: AlertSeverity;
  /** Short headline text. */
  title: string;
  /** Longer message body, may include details specific to the triggering event. */
  message?: string;
  /** Asset type this alert relates to, if applicable. See {@link AssetType}. */
  relatedAssetType?: AssetType;
  /** ID of the related Vehicle/Equipment, if applicable. */
  relatedAssetId?: string;
  /** ID of the related Issue, WorkOrder, Inspection, etc., if applicable. */
  relatedEntityId?: string;
  /** Type name of the related entity (e.g. "issue", "work_order"), if applicable. */
  relatedEntityType?: string;
  /** User this alert is addressed to; undefined if broadcast to a role/org. */
  recipientUserId?: string;
  /** Role this alert is broadcast to, when not addressed to a single user. */
  recipientRole?: UserRole;
  /** Whether the recipient has read/dismissed the alert. */
  isRead: boolean;
  /** In-app link/route to navigate to when the alert is clicked. */
  linkUrl?: string;
  /** When the alert was generated. */
  createdAt: string;
  /** When the alert was read/dismissed, if it has been. */
  readAt?: string;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * A record linking a User to a Vehicle or Equipment for a period of time,
 * capturing who is/was responsible for or operating an asset.
 */
export interface Assignment {
  /** Unique identifier (UUID). */
  id: string;
  /** Organization this assignment belongs to. */
  organizationId: string;
  /** Which asset type is being assigned. See {@link AssetType}. */
  assetType: AssetType;
  /** ID of the Vehicle or Equipment being assigned (matches `assetType`). */
  assetId: string;
  /** User the asset is assigned to. */
  userId: string;
  /** User who created/authorized this assignment. */
  assignedByUserId?: string;
  /** Free-text reason/context for the assignment (e.g. "Route 12 coverage"). */
  reason?: string;
  /** Date/time the assignment begins. */
  startDate: string;
  /** Date/time the assignment ends; undefined while still active. */
  endDate?: string;
  /** Whether this assignment is the asset's current active assignment. */
  isActive: boolean;
  /** When the assignment record was created. */
  createdAt: string;
  /** When the assignment record was last updated. */
  updatedAt: string;
}

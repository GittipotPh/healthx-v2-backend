import type { audit_log, auditReferenceType } from "@prisma/client";

export interface AuditLogView {
  id: string;
  clinicId: string;
  branchId: string;
  referenceType: auditReferenceType;
  referenceId: string;
  action: string;
  actionLabel: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string;
  actorName: string | null;
  actorRole: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfName: string | null;
  durationSec: number | null;
  notes: string | null;
  reason: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
}

export function toAuditLogView(row: audit_log): AuditLogView {
  return {
    id: row.audit_log_id,
    clinicId: row.clinic_id,
    branchId: row.branch_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    action: row.action,
    actionLabel: row.action_label,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    onBehalfOfUserId: row.on_behalf_of_user_id,
    onBehalfOfName: row.on_behalf_of_name,
    durationSec: row.duration_sec,
    notes: row.notes,
    reason: row.reason,
    ipAddress: row.ip_address,
    metadata: row.metadata ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

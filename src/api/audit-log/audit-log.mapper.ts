import { ApiProperty } from "@nestjs/swagger";
import { auditReferenceType, type audit_log } from "@prisma/client";

export class AuditLogView {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clinicId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ enum: auditReferenceType, enumName: "AuditReferenceType" })
  referenceType!: auditReferenceType;

  @ApiProperty()
  referenceId!: string;

  @ApiProperty({ description: 'Machine action key, e.g. "check-in"' })
  action!: string;

  @ApiProperty({ description: 'Human-readable Thai label, e.g. "มาถึงแล้ว"' })
  actionLabel!: string;

  @ApiProperty({ type: String, nullable: true })
  fromStatus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  toStatus!: string | null;

  @ApiProperty()
  actorUserId!: string;

  @ApiProperty({ type: String, nullable: true })
  actorName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  actorRole!: string | null;

  @ApiProperty({ type: String, nullable: true })
  onBehalfOfUserId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  onBehalfOfName!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationSec!: number | null;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  ipAddress!: string | null;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    nullable: true,
    description: "Free-form action metadata recorded by the workflow",
  })
  metadata!: unknown;

  @ApiProperty({ description: "ISO timestamp" })
  createdAt!: string;
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

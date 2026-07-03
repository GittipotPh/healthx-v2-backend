import { Injectable } from "@nestjs/common";
import type { Prisma, audit_log, auditReferenceType } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { QueryAuditLogDto } from "./dto/query-audit-log.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface PaginatedAuditLogs {
  items: audit_log[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Service-internal input for writing an audit entry. There is deliberately no
 * HTTP DTO for this: audit rows are only created server-side as workflow side
 * effects, with the actor derived from the validated request scope.
 */
export interface AuditLogCreateInput {
  clinicId: string;
  branchId: string;
  referenceType: auditReferenceType;
  referenceId: string;
  action: string;
  actionLabel: string;
  fromStatus?: string;
  toStatus?: string;
  actorUserId: string;
  actorName?: string;
  actorRole?: string;
  onBehalfOfUserId?: string;
  onBehalfOfName?: string;
  durationSec?: number;
  notes?: string;
  reason?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Display name for an actor, falling back to their email, for audit rows. */
  async findActorName(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { user_id: userId },
      select: { name: true, lastname: true, email: true },
    });
    if (!user) return null;
    return `${user.name ?? ""} ${user.lastname ?? ""}`.trim() || user.email;
  }

  async create(
    dto: AuditLogCreateInput,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<audit_log> {
    return tx.audit_log.create({
      data: {
        clinic_id: dto.clinicId,
        branch_id: dto.branchId,
        reference_type: dto.referenceType,
        reference_id: dto.referenceId,
        action: dto.action,
        action_label: dto.actionLabel,
        from_status: dto.fromStatus ?? null,
        to_status: dto.toStatus ?? null,
        actor_user_id: dto.actorUserId,
        actor_name: dto.actorName ?? null,
        actor_role: dto.actorRole ?? null,
        on_behalf_of_user_id: dto.onBehalfOfUserId ?? null,
        on_behalf_of_name: dto.onBehalfOfName ?? null,
        duration_sec: dto.durationSec ?? null,
        notes: dto.notes ?? null,
        reason: dto.reason ?? null,
        ip_address: dto.ipAddress ?? null,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async findMany(query: QueryAuditLogDto, scope: RequestScope): Promise<PaginatedAuditLogs> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.audit_log.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.audit_log.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  private buildWhere(query: QueryAuditLogDto, scope: RequestScope): Prisma.audit_logWhereInput {
    const where: Prisma.audit_logWhereInput = {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };

    if (query.referenceType) where.reference_type = query.referenceType;
    if (query.referenceId) where.reference_id = query.referenceId;
    if (query.actorUserId) where.actor_user_id = query.actorUserId;

    if (query.dateFrom || query.dateTo) {
      where.created_at = {};
      if (query.dateFrom) where.created_at.gte = new Date(query.dateFrom);
      if (query.dateTo) where.created_at.lte = new Date(query.dateTo);
    }

    if (query.search) {
      const search = query.search;
      where.OR = [
        { action_label: { contains: search, mode: "insensitive" } },
        { actor_name: { contains: search, mode: "insensitive" } },
        { reference_id: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    return where;
  }
}

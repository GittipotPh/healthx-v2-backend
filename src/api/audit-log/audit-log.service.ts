import { Injectable, Logger } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { auditReferenceType, type Prisma, type audit_log } from "@prisma/client";
import {
  AuditLogRepository,
  type AuditLogCreateInput,
} from "./audit-log.repository";
import { AuditLogView, toAuditLogView } from "./audit-log.mapper";
import type { QueryAuditLogDto } from "./dto/query-audit-log.dto";
import type { RequestScope } from "../../auth/auth.types";
import type { PrismaService } from "../../prisma.service";

export class AuditLogListResult {
  @ApiProperty({ type: [AuditLogView] })
  items!: AuditLogView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

@Injectable()
export class AuditLogService {
  // Every audit write is mirrored to the structured logger (OWASP A09): the DB
  // row is the queryable record, the stdout JSON line is the off-site copy an
  // attacker with DB credentials cannot delete.
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repository: AuditLogRepository) {}

  private mirror(input: AuditLogCreateInput): void {
    this.logger.log({
      event: "audit.recorded",
      action: input.action,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      clinicId: input.clinicId,
      branchId: input.branchId,
      actorUserId: input.actorUserId,
    });
  }

  async list(query: QueryAuditLogDto, scope: RequestScope): Promise<AuditLogListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toAuditLogView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async create(
    input: AuditLogCreateInput,
    tx?: Prisma.TransactionClient | PrismaService,
  ): Promise<AuditLogView> {
    const created = await this.repository.create(input, tx);
    this.mirror(input);
    return toAuditLogView(created);
  }

  /**
   * Records a LOGIN audit entry against the branch the user has just entered.
   * Called once on branch entry (after login → clinic → branch), so the login
   * is attributed to a real clinic+branch the branch-scoped audit list can show.
   */
  async recordLogin(scope: RequestScope, ipAddress?: string): Promise<AuditLogView> {
    const actorName = await this.repository.findActorName(scope.userId);
    const input: AuditLogCreateInput = {
      clinicId: scope.clinicId,
      branchId: scope.branchId,
      referenceType: auditReferenceType.SYSTEM,
      referenceId: scope.userId,
      action: "LOGIN",
      actionLabel: "เข้าสู่ระบบ",
      actorUserId: scope.userId,
      actorName: actorName ?? undefined,
      actorRole: scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined),
      ipAddress,
      notes: `${actorName ?? scope.userId} เข้าสู่ระบบสำเร็จ`,
    };
    const created = await this.repository.create(input);
    this.mirror(input);
    return toAuditLogView(created);
  }

  /**
   * Internal helper for other feature services to record an audit entry as part
   * of a workflow (e.g. a queue/opd/appointment status transition). Never throws
   * into the caller's transaction path — audit failures are non-fatal.
   */
  async record(input: AuditLogCreateInput): Promise<audit_log | null> {
    try {
      const created = await this.repository.create(input);
      this.mirror(input);
      return created;
    } catch (error) {
      // Non-fatal by contract, but never silent: a failed audit write is itself
      // a security event — and the mirror line preserves the entry off-site.
      this.logger.error({
        event: "audit.write_failed",
        action: input.action,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        clinicId: input.clinicId,
        branchId: input.branchId,
        actorUserId: input.actorUserId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

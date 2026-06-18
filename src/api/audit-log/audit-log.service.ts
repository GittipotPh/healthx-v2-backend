import { Injectable } from "@nestjs/common";
import type { audit_log } from "@prisma/client";
import { AuditLogRepository } from "./audit-log.repository";
import { type AuditLogView, toAuditLogView } from "./audit-log.mapper";
import type { CreateAuditLogDto } from "./dto/create-audit-log.dto";
import type { QueryAuditLogDto } from "./dto/query-audit-log.dto";

export interface AuditLogListResult {
  items: AuditLogView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly repository: AuditLogRepository) {}

  async list(query: QueryAuditLogDto): Promise<AuditLogListResult> {
    const result = await this.repository.findMany(query);
    return {
      items: result.items.map(toAuditLogView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async create(dto: CreateAuditLogDto): Promise<AuditLogView> {
    const created = await this.repository.create(dto);
    return toAuditLogView(created);
  }

  /**
   * Internal helper for other feature services to record an audit entry as part
   * of a workflow (e.g. a queue/opd/appointment status transition). Never throws
   * into the caller's transaction path — audit failures are non-fatal.
   */
  async record(dto: CreateAuditLogDto): Promise<audit_log | null> {
    try {
      return await this.repository.create(dto);
    } catch {
      return null;
    }
  }
}

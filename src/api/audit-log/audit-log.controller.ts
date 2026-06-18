import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AuditLogService, type AuditLogListResult } from "./audit-log.service";
import type { AuditLogView } from "./audit-log.mapper";
import { CreateAuditLogDto } from "./dto/create-audit-log.dto";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";

@Controller("clinic/audit-log")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  list(@Query() query: QueryAuditLogDto): Promise<AuditLogListResult> {
    return this.auditLogService.list(query);
  }

  @Post()
  create(@Body() dto: CreateAuditLogDto): Promise<AuditLogView> {
    return this.auditLogService.create(dto);
  }
}

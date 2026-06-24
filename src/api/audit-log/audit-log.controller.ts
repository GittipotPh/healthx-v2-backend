import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AuditLogService, type AuditLogListResult } from "./audit-log.service";
import type { AuditLogView } from "./audit-log.mapper";
import { CreateAuditLogDto } from "./dto/create-audit-log.dto";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@Controller("clinic/audit-log")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  list(
    @Query() query: QueryAuditLogDto,
    @Scope() scope: RequestScope,
  ): Promise<AuditLogListResult> {
    return this.auditLogService.list(query, scope);
  }

  @Post()
  create(@Body() dto: CreateAuditLogDto, @Scope() scope: RequestScope): Promise<AuditLogView> {
    return this.auditLogService.create({
      ...dto,
      clinicId: scope.clinicId,
      branchId: scope.branchId,
    });
  }
}

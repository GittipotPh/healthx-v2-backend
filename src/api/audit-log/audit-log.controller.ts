import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { role_enum } from "@prisma/client";
import { AuditLogService, type AuditLogListResult } from "./audit-log.service";
import type { AuditLogView } from "./audit-log.mapper";
import { CreateAuditLogDto } from "./dto/create-audit-log.dto";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

/** Roles allowed to read the audit trail (plus any clinic-root user). */
const AUDIT_VIEW_ROLES: readonly role_enum[] = [role_enum.ADMIN, role_enum.MANAGER];

function canViewAudit(scope: RequestScope): boolean {
  return scope.isClinicRootUser || scope.roles.some((role) => AUDIT_VIEW_ROLES.includes(role));
}

@Controller("clinic/audit-log")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  list(
    @Query() query: QueryAuditLogDto,
    @Scope() scope: RequestScope,
  ): Promise<AuditLogListResult> {
    if (!canViewAudit(scope)) {
      throw new ForbiddenException("You do not have access to the audit log");
    }
    return this.auditLogService.list(query, scope);
  }

  /**
   * Records a LOGIN entry for the user against the branch they just entered.
   * Called once by the frontend on branch selection after login.
   */
  @Post("login")
  @HttpCode(HttpStatus.CREATED)
  recordLogin(@Scope() scope: RequestScope, @Req() req: Request): Promise<AuditLogView> {
    return this.auditLogService.recordLogin(scope, req.ip);
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

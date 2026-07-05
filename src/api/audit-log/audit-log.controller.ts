import {
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
import { ApiTags } from "@nestjs/swagger";
import { role_enum } from "@prisma/client";
import { AuditLogService, AuditLogListResult } from "./audit-log.service";
import { AuditLogView } from "./audit-log.mapper";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

/** Roles allowed to read the audit trail (plus any clinic-root user). */
const AUDIT_VIEW_ROLES: readonly role_enum[] = [role_enum.ADMIN, role_enum.MANAGER];

function canViewAudit(scope: RequestScope): boolean {
  return scope.isClinicRootUser || scope.roles.some((role) => AUDIT_VIEW_ROLES.includes(role));
}

@ApiTags("Audit Log")
@BaseOpenApiErrorResponses()
@Controller("clinic/audit-log")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @BaseOpenApiResponse(AuditLogListResult)
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
  @BaseOpenApiResponse(AuditLogView, { status: 201 })
  recordLogin(@Scope() scope: RequestScope, @Req() req: Request): Promise<AuditLogView> {
    return this.auditLogService.recordLogin(scope, req.ip);
  }

  // No generic POST create endpoint: audit rows are written server-side only,
  // as side effects of workflows (queue transition, appointment create) via
  // AuditLogService with a server-derived actor. A client-facing create would
  // let callers forge actorUserId/actorName/actorRole.
}

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { record_status, type role_enum } from "@prisma/client";
import type { Request } from "express";
import { PrismaService } from "../prisma.service";
import { IS_PUBLIC_KEY, SCOPE_LEVEL_KEY, type ScopeLevel } from "./scope.decorator";
import type { Principal, RequestScope } from "./auth.types";

const CLINIC_HEADER = "x-clinic-id";
const BRANCH_HEADER = "x-branch-id";

/**
 * Validates the requested scope from the `x-clinic-id` / `x-branch-id` headers
 * against the authenticated principal, then attaches a trusted `RequestScope`.
 *
 * Headers are never trusted directly: clinic membership is proven by an ACTIVE
 * `user` row for (email, clinic); branch access by an ACTIVE `user_branch` row
 * (or `is_clinic_root_user`). Routes default to requiring a branch; `@RequireClinic()`
 * relaxes that to clinic-only.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const level =
      this.reflector.getAllAndOverride<ScopeLevel>(SCOPE_LEVEL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? "branch";

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal; scope?: RequestScope }>();
    const principal = request.principal;
    if (!principal) throw new ForbiddenException("Missing authenticated principal");

    // Identity-only routes (e.g. /authentication/me) need auth but no clinic/branch.
    if (level === "none") return true;

    const clinicId = this.header(request, CLINIC_HEADER);
    if (!clinicId) throw new ForbiddenException("Missing x-clinic-id header");

    const user = await this.prisma.user.findFirst({
      where: { email: principal.email, clinic_id: clinicId, status: record_status.ACTIVE },
      select: { user_id: true, is_clinic_root_user: true },
    });
    if (!user) throw new ForbiddenException("No access to the requested clinic");

    let branchId = "";
    const roles: role_enum[] = [];
    if (level === "branch") {
      branchId = this.header(request, BRANCH_HEADER) ?? "";
      if (!branchId) throw new ForbiddenException("Missing x-branch-id header");

      const branch = await this.prisma.branch.findFirst({
        where: { branch_id: branchId, clinic_id: clinicId },
        select: { branch_id: true },
      });
      if (!branch) throw new ForbiddenException("Branch not found in the requested clinic");

      if (!user.is_clinic_root_user) {
        const access = await this.prisma.user_branch.findFirst({
          where: { user_id: user.user_id, branch_id: branchId, status: record_status.ACTIVE },
          select: { role_id: true },
        });
        if (!access) throw new ForbiddenException("No access to the requested branch");
        roles.push(access.role_id);
      }
    }

    request.scope = {
      userId: user.user_id,
      clinicId,
      branchId,
      isClinicRootUser: user.is_clinic_root_user,
      roles,
    };
    return true;
  }

  private header(request: Request, key: string): string | undefined {
    const value = request.headers[key];
    return Array.isArray(value) ? value[0] : value;
  }
}

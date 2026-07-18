import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../permissions.decorator";

/**
 * Resolves fine-grained, branch-specific permissions after ScopeGuard.
 *
 * An explicit user_permission true/false overrides the role defaults. When no
 * user override exists, any matching default_permission for the caller's
 * branch role grants the permission. Missing entries deny by default.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement || (requirement.allOf.length === 0 && requirement.anyOf.length === 0)) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { scope?: RequestScope }>();
    const scope = request.scope;
    if (!scope) throw new ForbiddenException("Missing validated request scope");

    // ScopeGuard already proved clinic ownership for clinic-root users. This
    // preserves the existing root-user semantics while ordinary users remain
    // subject to explicit branch permission resolution.
    if (scope.isClinicRootUser) return true;
    if (!scope.branchId) {
      throw new ForbiddenException("Fine-grained permissions require a branch scope");
    }

    const requested = [...new Set([...requirement.allOf, ...requirement.anyOf])];
    const [overrides, defaults] = await Promise.all([
      this.prisma.user_permission.findMany({
        where: {
          branch_id: scope.branchId,
          user_id: scope.userId,
          permission_id: { in: requested },
        },
        select: { permission_id: true, permission: true },
      }),
      scope.roles.length === 0
        ? Promise.resolve([])
        : this.prisma.default_permission.findMany({
            where: {
              role_id: { in: scope.roles },
              permission_id: { in: requested },
            },
            select: { permission_id: true },
          }),
    ]);

    const explicit = new Map(
      overrides
        .filter((row) => row.permission !== null)
        .map((row) => [row.permission_id, row.permission === true]),
    );
    const roleGrants = new Set(defaults.map((row) => row.permission_id));
    const isGranted = (permissionId: string): boolean =>
      explicit.has(permissionId)
        ? explicit.get(permissionId) === true
        : roleGrants.has(permissionId);

    const hasAll = requirement.allOf.every(isGranted);
    const hasAny = requirement.anyOf.length === 0 || requirement.anyOf.some(isGranted);
    if (!hasAll || !hasAny) {
      throw new ForbiddenException("Missing required permission");
    }

    return true;
  }
}

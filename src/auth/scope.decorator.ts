import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Principal, RequestScope } from "./auth.types";

/** Marks a route as public (skips JwtAuthGuard + ScopeGuard). */
export const IS_PUBLIC_KEY = "isPublic";
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export type ScopeLevel = "none" | "clinic" | "branch";
export const SCOPE_LEVEL_KEY = "scopeLevel";

/**
 * Requires only a validated clinic (x-clinic-id), not a branch.
 * Guarded routes default to "branch" (x-clinic-id + x-branch-id).
 */
export const RequireClinic = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPE_LEVEL_KEY, "clinic");

/**
 * Requires authentication (JwtAuthGuard) but no clinic/branch scope. For
 * identity routes like `/authentication/me` that resolve the person, not a clinic.
 */
export const NoScope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPE_LEVEL_KEY, "none");

/** Injects the validated `RequestScope` set by ScopeGuard. */
export const Scope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestScope => {
    const request = ctx.switchToHttp().getRequest<{ scope: RequestScope }>();
    return request.scope;
  },
);

/** Injects the authenticated `Principal` set by JwtAuthGuard. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest<{ principal: Principal }>();
    return request.principal;
  },
);

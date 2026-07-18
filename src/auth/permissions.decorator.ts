import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSIONS_KEY = "requiredPermissions";

export interface PermissionRequirement {
  allOf: string[];
  anyOf: string[];
}

function uniquePermissions(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Requires every listed permission after the normal clinic/branch scope check. */
export const RequirePermissions = (
  ...allOf: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, {
    allOf: uniquePermissions(allOf),
    anyOf: [],
  } satisfies PermissionRequirement);

/** Requires at least one listed permission after the normal clinic/branch scope check. */
export const RequireAnyPermission = (
  ...anyOf: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, {
    allOf: [],
    anyOf: uniquePermissions(anyOf),
  } satisfies PermissionRequirement);

/** Supports endpoints that need both an all-of set and an any-of set. */
export const RequirePermissionExpression = (requirement: {
  allOf?: readonly string[];
  anyOf?: readonly string[];
}): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, {
    allOf: uniquePermissions(requirement.allOf ?? []),
    anyOf: uniquePermissions(requirement.anyOf ?? []),
  } satisfies PermissionRequirement);

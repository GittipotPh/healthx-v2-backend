import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { role_enum } from "@prisma/client";
import type { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../auth.types";
import type { PermissionRequirement } from "../permissions.decorator";
import { PermissionsGuard } from "./permissions.guard";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};

function makeGuard(
  requirement: PermissionRequirement | undefined,
  options: {
    overrides?: Array<{ permission_id: string; permission: boolean | null }>;
    defaults?: Array<{ permission_id: string }>;
    scope?: RequestScope;
  } = {},
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requirement),
  } as unknown as Reflector;
  const prisma = {
    user_permission: {
      findMany: jest.fn().mockResolvedValue(options.overrides ?? []),
    },
    default_permission: {
      findMany: jest.fn().mockResolvedValue(options.defaults ?? []),
    },
  } as unknown as PrismaService;
  const request = { scope: options.scope ?? SCOPE };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { guard: new PermissionsGuard(reflector, prisma), prisma, context };
}

describe("PermissionsGuard", () => {
  it("allows routes without permission metadata", async () => {
    const { guard, prisma, context } = makeGuard(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user_permission.findMany).not.toHaveBeenCalled();
  });

  it("preserves clinic-root access after ScopeGuard validates the clinic", async () => {
    const { guard, prisma, context } = makeGuard(
      { allOf: ["OPD_CREATE"], anyOf: [] },
      { scope: { ...SCOPE, branchId: "", isClinicRootUser: true, roles: [] } },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user_permission.findMany).not.toHaveBeenCalled();
  });

  it("uses an explicit user allow before role defaults", async () => {
    const { guard, context } = makeGuard(
      { allOf: ["OPD_CREATE"], anyOf: [] },
      { overrides: [{ permission_id: "OPD_CREATE", permission: true }] },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("lets an explicit user deny override a role grant", async () => {
    const { guard, context } = makeGuard(
      { allOf: ["OPD_CREATE"], anyOf: [] },
      {
        overrides: [{ permission_id: "OPD_CREATE", permission: false }],
        defaults: [{ permission_id: "OPD_CREATE" }],
      },
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("falls back to role defaults when the user override is null", async () => {
    const { guard, context } = makeGuard(
      { allOf: ["OPD_READ"], anyOf: [] },
      {
        overrides: [{ permission_id: "OPD_READ", permission: null }],
        defaults: [{ permission_id: "OPD_READ" }],
      },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("enforces all-of and any-of expressions together", async () => {
    const { guard, context } = makeGuard(
      { allOf: ["OPD_EDIT"], anyOf: ["OPD_CREATE", "OPD_FINALIZE_OVERRIDE"] },
      {
        defaults: [
          { permission_id: "OPD_EDIT" },
          { permission_id: "OPD_FINALIZE_OVERRIDE" },
        ],
      },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies missing permissions by default", async () => {
    const { guard, context } = makeGuard({ allOf: ["OPD_READ"], anyOf: [] });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});

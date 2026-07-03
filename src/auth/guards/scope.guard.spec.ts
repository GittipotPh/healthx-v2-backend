import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { record_status, role_enum } from "@prisma/client";
import type { Request } from "express";
import { ScopeGuard } from "./scope.guard";
import type { PrismaService } from "../../prisma.service";
import type { Principal, RequestScope } from "../auth.types";
import type { ScopeLevel } from "../scope.decorator";

type GuardRequest = Partial<Request> & { principal?: Principal; scope?: RequestScope };

const PRINCIPAL: Principal = { email: "user@example.com", name: "User Example" };

function contextOf(req: GuardRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

interface PrismaMocks {
  userFindFirst: jest.Mock;
  branchFindFirst: jest.Mock;
  userBranchFindFirst: jest.Mock;
}

function makeGuard(options: {
  isPublic?: boolean;
  level?: ScopeLevel;
  user?: { user_id: string; is_clinic_root_user: boolean } | null;
  branch?: { branch_id: string } | null;
  access?: { role_id: role_enum } | null;
}): { guard: ScopeGuard; prisma: PrismaMocks } {
  const reflector = {
    // First getAllAndOverride call resolves IS_PUBLIC_KEY, second SCOPE_LEVEL_KEY.
    getAllAndOverride: jest
      .fn()
      .mockReturnValueOnce(options.isPublic ?? false)
      .mockReturnValueOnce(options.level),
  } as unknown as Reflector;

  const prismaMocks: PrismaMocks = {
    userFindFirst: jest.fn().mockResolvedValue(options.user ?? null),
    branchFindFirst: jest.fn().mockResolvedValue(options.branch ?? null),
    userBranchFindFirst: jest.fn().mockResolvedValue(options.access ?? null),
  };
  const prisma = {
    user: { findFirst: prismaMocks.userFindFirst },
    branch: { findFirst: prismaMocks.branchFindFirst },
    user_branch: { findFirst: prismaMocks.userBranchFindFirst },
  } as unknown as PrismaService;

  return { guard: new ScopeGuard(reflector, prisma), prisma: prismaMocks };
}

describe("ScopeGuard", () => {
  it("allows public routes without touching the database", async () => {
    const { guard, prisma } = makeGuard({ isPublic: true });
    const request: GuardRequest = { headers: {} };

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(prisma.userFindFirst).not.toHaveBeenCalled();
  });

  it("rejects requests without an authenticated principal", async () => {
    const { guard } = makeGuard({});
    const request: GuardRequest = { headers: { "x-clinic-id": "clinic-1" } };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(ForbiddenException);
  });

  it('passes "none"-level routes with only a principal, without scope headers', async () => {
    const { guard, prisma } = makeGuard({ level: "none" });
    const request: GuardRequest = { headers: {}, principal: PRINCIPAL };

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(prisma.userFindFirst).not.toHaveBeenCalled();
    expect(request.scope).toBeUndefined();
  });

  it("rejects when the x-clinic-id header is missing", async () => {
    const { guard } = makeGuard({ level: "clinic" });
    const request: GuardRequest = { headers: {}, principal: PRINCIPAL };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(
      new ForbiddenException("Missing x-clinic-id header"),
    );
  });

  it("rejects when the principal has no ACTIVE user row in the requested clinic", async () => {
    const { guard, prisma } = makeGuard({ level: "clinic", user: null });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(
      new ForbiddenException("No access to the requested clinic"),
    );
    expect(prisma.userFindFirst).toHaveBeenCalledWith({
      where: { email: PRINCIPAL.email, clinic_id: "clinic-1", status: record_status.ACTIVE },
      select: { user_id: true, is_clinic_root_user: true },
    });
  });

  it('attaches a clinic-only scope (branchId "") on "clinic"-level routes', async () => {
    const { guard, prisma } = makeGuard({
      level: "clinic",
      user: { user_id: "user-1", is_clinic_root_user: false },
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1", "x-branch-id": "branch-1" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(request.scope).toEqual({
      userId: "user-1",
      clinicId: "clinic-1",
      branchId: "",
      isClinicRootUser: false,
      roles: [],
    });
    // Clinic-level routes must not run any branch checks, even if the header is sent.
    expect(prisma.branchFindFirst).not.toHaveBeenCalled();
    expect(prisma.userBranchFindFirst).not.toHaveBeenCalled();
  });

  it("defaults to branch level and rejects when x-branch-id is missing", async () => {
    const { guard } = makeGuard({
      user: { user_id: "user-1", is_clinic_root_user: false },
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(
      new ForbiddenException("Missing x-branch-id header"),
    );
  });

  it("rejects when the branch does not belong to the requested clinic", async () => {
    const { guard, prisma } = makeGuard({
      level: "branch",
      user: { user_id: "user-1", is_clinic_root_user: false },
      branch: null,
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1", "x-branch-id": "branch-other" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(
      new ForbiddenException("Branch not found in the requested clinic"),
    );
    expect(prisma.branchFindFirst).toHaveBeenCalledWith({
      where: { branch_id: "branch-other", clinic_id: "clinic-1" },
      select: { branch_id: true },
    });
  });

  it("rejects non-root users without an ACTIVE user_branch membership", async () => {
    const { guard } = makeGuard({
      level: "branch",
      user: { user_id: "user-1", is_clinic_root_user: false },
      branch: { branch_id: "branch-1" },
      access: null,
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1", "x-branch-id": "branch-1" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(
      new ForbiddenException("No access to the requested branch"),
    );
  });

  it("attaches the branch scope with the membership role for non-root users", async () => {
    const { guard, prisma } = makeGuard({
      level: "branch",
      user: { user_id: "user-1", is_clinic_root_user: false },
      branch: { branch_id: "branch-1" },
      access: { role_id: role_enum.NURSE },
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1", "x-branch-id": "branch-1" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(request.scope).toEqual({
      userId: "user-1",
      clinicId: "clinic-1",
      branchId: "branch-1",
      isClinicRootUser: false,
      roles: [role_enum.NURSE],
    });
    expect(prisma.userBranchFindFirst).toHaveBeenCalledWith({
      where: { user_id: "user-1", branch_id: "branch-1", status: record_status.ACTIVE },
      select: { role_id: true },
    });
  });

  it("lets clinic-root users into any branch of the clinic without a user_branch row", async () => {
    const { guard, prisma } = makeGuard({
      level: "branch",
      user: { user_id: "root-1", is_clinic_root_user: true },
      branch: { branch_id: "branch-1" },
      access: null,
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1", "x-branch-id": "branch-1" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(prisma.userBranchFindFirst).not.toHaveBeenCalled();
    expect(request.scope).toEqual({
      userId: "root-1",
      clinicId: "clinic-1",
      branchId: "branch-1",
      isClinicRootUser: true,
      roles: [],
    });
  });

  it("root bypass still requires the branch to exist in the clinic", async () => {
    const { guard } = makeGuard({
      level: "branch",
      user: { user_id: "root-1", is_clinic_root_user: true },
      branch: null,
    });
    const request: GuardRequest = {
      headers: { "x-clinic-id": "clinic-1", "x-branch-id": "branch-of-other-clinic" },
      principal: PRINCIPAL,
    };

    await expect(guard.canActivate(contextOf(request))).rejects.toThrow(
      new ForbiddenException("Branch not found in the requested clinic"),
    );
  });
});

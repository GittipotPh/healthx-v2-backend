import { Injectable } from "@nestjs/common";
import { record_status, role_enum, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { BranchAccessService } from "../../common/branch-access/branch-access.service";
import {
  CONSULT_TYPE_OPTIONS,
  INTERNAL_TAG_OPTIONS,
  MARKETING_CAMPAIGN_OPTIONS,
  MARKETING_PLATFORM_OPTIONS,
  NUMBING_DURATION_OPTIONS,
  PREPARATION_TAG_OPTIONS,
} from "./appointments.constants";
import type {
  AppointmentOptionPage,
  AppointmentOptionsView,
  BranchOption,
  BranchScopedOption,
  StaffOption,
} from "./appointments.mapper";
import type { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import type { RequestScope } from "../../auth/auth.types";

@Injectable()
export class AppointmentOptionsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async options(scope: RequestScope): Promise<AppointmentOptionsView> {
    const branches = await this.accessibleBranchOptions(scope);
    const branchIds = branches.map((branch) => branch.id);

    if (branchIds.length === 0) {
      return this.emptyOptions(branches);
    }

    const [rooms] = await this.prisma.$transaction([
      this.prisma.examination_room.findMany({
        where: {
          branch_id: { in: branchIds },
          room_status: record_status.ACTIVE,
        },
        select: { room_id: true, room_name: true, branch_id: true },
        orderBy: [{ branch_id: "asc" }, { room_name: "asc" }],
      }),
    ]);

    return {
      ...this.emptyOptions(branches),
      rooms: rooms.map((room) => ({
        id: room.room_id,
        label: room.room_name,
        branchId: room.branch_id,
      })),
      procedures: [],
      doctors: [],
      assistants: [],
    };
  }

  async procedureOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<BranchScopedOption>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const branchIds = await this.resolveOptionBranchIds(query.branchId, scope);

    if (branchIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const where: Prisma.operation_itemWhereInput = {
      branch_id: { in: branchIds },
      status: record_status.ACTIVE,
      branch: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
    };

    const search = query.search?.trim();
    if (search) {
      where.title = { contains: search, mode: "insensitive" };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operation_item.findMany({
        where,
        select: { op_id: true, title: true, branch_id: true },
        orderBy: [{ branch_id: "asc" }, { title: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operation_item.count({ where }),
    ]);

    return {
      items: items.map((procedure) => ({
        id: procedure.op_id,
        label: procedure.title,
        branchId: procedure.branch_id,
      })),
      total,
      page,
      pageSize,
    };
  }

  doctorOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.findStaffByRole(query, scope, role_enum.DOCTOR);
  }

  assistantOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.findStaffByRole(query, scope, { in: [role_enum.NURSE, role_enum.THERAPIST] });
  }

  private async findStaffByRole(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
    roleFilter: Prisma.user_branchWhereInput["role_id"],
  ): Promise<AppointmentOptionPage<StaffOption>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const branchIds = await this.resolveOptionBranchIds(query.branchId, scope);

    if (branchIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const search = query.search?.trim();
    const where: Prisma.user_branchWhereInput = {
      branch_id: { in: branchIds },
      status: record_status.ACTIVE,
      role_id: roleFilter,
      branch: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
      user: {
        status: record_status.ACTIVE,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { lastname: { contains: search, mode: "insensitive" } },
                { nickname: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user_branch.findMany({
        where,
        select: {
          branch_id: true,
          role_id: true,
          user: {
            select: {
              user_id: true,
              name: true,
              lastname: true,
              nickname: true,
              email: true,
            },
          },
        },
        orderBy: [{ branch_id: "asc" }, { role_id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user_branch.count({ where }),
    ]);

    return {
      items: items.map((row) => ({
        id: row.user.user_id,
        branchId: row.branch_id,
        role: row.role_id,
        label: this.userLabel(row.user),
      })),
      total,
      page,
      pageSize,
    };
  }

  private async accessibleBranchOptions(scope: RequestScope): Promise<BranchOption[]> {
    const branches = await this.branchAccessService.findAccessibleBranches(scope);
    return branches.map((branch) => ({
      id: branch.branchId,
      label: branch.branchName,
      typeBranch: branch.typeBranch,
    }));
  }

  private async resolveOptionBranchIds(
    requestedBranchId: string | undefined,
    scope: RequestScope,
  ): Promise<string[]> {
    const branches = await this.accessibleBranchOptions(scope);
    const requested = requestedBranchId || scope.branchId;

    if (!requested) {
      return branches.map((branch) => branch.id);
    }

    return branches.some((branch) => branch.id === requested) ? [requested] : [];
  }

  private emptyOptions(branches: BranchOption[]): AppointmentOptionsView {
    return {
      branches,
      rooms: [],
      procedures: [],
      doctors: [],
      assistants: [],
      consultTypes: CONSULT_TYPE_OPTIONS,
      marketingPlatforms: MARKETING_PLATFORM_OPTIONS,
      marketingCampaigns: MARKETING_CAMPAIGN_OPTIONS,
      preparationTags: PREPARATION_TAG_OPTIONS,
      internalTags: INTERNAL_TAG_OPTIONS,
      numbingDurations: NUMBING_DURATION_OPTIONS,
    };
  }

  private userLabel(user: {
    name: string | null;
    lastname: string | null;
    nickname: string | null;
    email: string;
  }): string {
    const fullName = [user.name, user.lastname].filter(Boolean).join(" ").trim();
    if (fullName && user.nickname) return `${fullName} (${user.nickname})`;
    return fullName || user.nickname || user.email;
  }
}

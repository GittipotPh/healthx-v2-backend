import { Injectable } from "@nestjs/common";
import { record_status, role_enum, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { BranchAccessService } from "../../common/branch-access/branch-access.service";
import type {
  AppointmentOption,
  AppointmentOptionPage,
  AppointmentOptionsView,
  BranchOption,
  BranchScopedOption,
  StaffOption,
} from "./appointments.mapper";
import type { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import type { RequestScope } from "../../auth/auth.types";

const APPOINTMENT_OPTION_TYPES = [
  "CONSULT_TYPE",
  "MARKETING_PLATFORM",
  "MARKETING_CAMPAIGN",
  "PREPARATION_TAG",
  "INTERNAL_TAG",
  "NUMBING_DURATION",
] as const;

type AppointmentOptionType = (typeof APPOINTMENT_OPTION_TYPES)[number];
type GroupedAppointmentOption = {
  option: AppointmentOption;
  rank: number;
  sortOrder: number;
};

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

    const [rooms, refOptions, procedures, doctors, assistants] = await Promise.all([
      this.prisma.examination_room.findMany({
        where: {
          branch_id: { in: branchIds },
          room_status: record_status.ACTIVE,
        },
        select: { room_id: true, room_name: true, branch_id: true },
        orderBy: [{ branch_id: "asc" }, { room_name: "asc" }],
      }),
      this.refOptions(branchIds, scope),
      this.procedureOptions({ branchId: scope.branchId, page: 1, pageSize: 100 }, scope),
      this.doctorOptions({ branchId: scope.branchId, page: 1, pageSize: 100 }, scope),
      this.assistantOptions({ branchId: scope.branchId, page: 1, pageSize: 100 }, scope),
    ]);

    const grouped = this.groupRefOptions(refOptions);

    return {
      ...this.emptyOptions(branches),
      rooms: rooms.map((room) => ({
        id: room.room_id,
        label: room.room_name,
        branchId: room.branch_id,
      })),
      procedures: procedures.items,
      doctors: doctors.items,
      assistants: assistants.items,
      consultTypes: grouped.CONSULT_TYPE,
      marketingPlatforms: grouped.MARKETING_PLATFORM,
      marketingCampaigns: grouped.MARKETING_CAMPAIGN,
      preparationTags: grouped.PREPARATION_TAG,
      internalTags: grouped.INTERNAL_TAG,
      numbingDurations: grouped.NUMBING_DURATION
        .map((option) => this.numbingMinutes(option))
        .filter((minutes): minutes is number => minutes !== null),
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
    console.log("docter",{scope})
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
      consultTypes: [],
      marketingPlatforms: [],
      marketingCampaigns: [],
      preparationTags: [],
      internalTags: [],
      numbingDurations: [],
    };
  }

  private refOptions(branchIds: string[], scope: RequestScope) {
    return this.prisma.ref_appointment_option.findMany({
      where: {
        is_active: true,
        type: { in: [...APPOINTMENT_OPTION_TYPES] },
        OR: [
          { clinic_id: null, branch_id: null },
          { clinic_id: scope.clinicId, branch_id: null },
          { clinic_id: scope.clinicId, branch_id: { in: branchIds } },
        ],
      },
      orderBy: [{ type: "asc" }, { sort_order: "asc" }, { label_th: "asc" }],
    });
  }

  private groupRefOptions(
    rows: Awaited<ReturnType<AppointmentOptionsRepository["refOptions"]>>,
  ): Record<AppointmentOptionType, AppointmentOption[]> {
    const grouped: Record<AppointmentOptionType, Map<string, GroupedAppointmentOption>> = {
      CONSULT_TYPE: new Map(),
      MARKETING_PLATFORM: new Map(),
      MARKETING_CAMPAIGN: new Map(),
      PREPARATION_TAG: new Map(),
      INTERNAL_TAG: new Map(),
      NUMBING_DURATION: new Map(),
    };

    for (const row of rows) {
      if (!APPOINTMENT_OPTION_TYPES.includes(row.type as AppointmentOptionType)) continue;
      const type = row.type as AppointmentOptionType;
      const rank = this.optionScopeRank(row);
      const existing = grouped[type].get(row.code);
      if (existing && existing.rank >= rank) continue;
      grouped[type].set(row.code, {
        option: { id: row.code, label: row.label_th },
        rank,
        sortOrder: row.sort_order,
      });
    }

    return {
      CONSULT_TYPE: this.toAppointmentOptions(grouped.CONSULT_TYPE),
      MARKETING_PLATFORM: this.toAppointmentOptions(grouped.MARKETING_PLATFORM),
      MARKETING_CAMPAIGN: this.toAppointmentOptions(grouped.MARKETING_CAMPAIGN),
      PREPARATION_TAG: this.toAppointmentOptions(grouped.PREPARATION_TAG),
      INTERNAL_TAG: this.toAppointmentOptions(grouped.INTERNAL_TAG),
      NUMBING_DURATION: this.toAppointmentOptions(grouped.NUMBING_DURATION),
    };
  }

  private toAppointmentOptions(options: Map<string, GroupedAppointmentOption>): AppointmentOption[] {
    return Array.from(options.values())
      .sort((left, right) => left.sortOrder - right.sortOrder || left.option.label.localeCompare(right.option.label))
      .map(({ option }) => option);
  }

  private optionScopeRank(row: { clinic_id: string | null; branch_id: string | null }): number {
    if (row.branch_id) return 3;
    if (row.clinic_id) return 2;
    return 1;
  }

  private numbingMinutes(option: AppointmentOption): number | null {
    const parsed = Number(option.id);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

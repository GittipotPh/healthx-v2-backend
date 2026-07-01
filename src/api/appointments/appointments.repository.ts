import { Injectable } from "@nestjs/common";
import { record_status, role_enum, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type {
  AppointmentOptionPage,
  AppointmentOptionsView,
  AppointmentWithCustomer,
  BranchOption,
  BranchScopedOption,
  StaffOption,
} from "./appointments.mapper";
import type { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface PaginatedAppointments {
  items: AppointmentWithCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: QueryAppointmentsDto,
    scope: RequestScope,
  ): Promise<PaginatedAppointments> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: { customer: true },
        orderBy: [{ date_appointment: "asc" }, { start_time: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  buildWhere(query: QueryAppointmentsDto, scope: RequestScope): Prisma.appointmentWhereInput {
    const where: Prisma.appointmentWhereInput = {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };

    if (query.customerId) where.customer_id = query.customerId;
    if (query.status) where.status_appointment = query.status;

    if (query.date) {
      where.date_appointment = query.date;
    } else if (query.dateFrom || query.dateTo) {
      where.date_appointment = {};
      if (query.dateFrom) where.date_appointment.gte = query.dateFrom;
      if (query.dateTo) where.date_appointment.lte = query.dateTo;
    }

    return where;
  }

  async options(scope: RequestScope): Promise<AppointmentOptionsView> {
    console.log({scope})
    const branches = await this.findAccessibleBranches(scope);
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

  async doctorOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const branchIds = await this.resolveOptionBranchIds(query.branchId, scope);

    if (branchIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const search = query.search?.trim();
    console.log({scope})
    const where: Prisma.user_branchWhereInput = {
      branch_id: { in: branchIds },
      status: record_status.ACTIVE,
      role_id: role_enum.DOCTOR,
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

  async assistantOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
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
      role_id: { in: [role_enum.NURSE, role_enum.THERAPIST] },
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

  private async findAccessibleBranches(scope: RequestScope): Promise<BranchOption[]> {
    if (scope.isClinicRootUser) {
      const branches = await this.prisma.branch.findMany({
        where: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
        select: { branch_id: true, branch_name: true, type_branch: true },
        orderBy: [{ type_branch: "asc" }, { branch_name: "asc" }],
      });

      return branches.map((branch) => ({
        id: branch.branch_id,
        label: branch.branch_name,
        typeBranch: branch.type_branch,
      }));
    }

    const userBranches = await this.prisma.user_branch.findMany({
      where: {
        user_id: scope.userId,
        status: record_status.ACTIVE,
        branch: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
      },
      select: {
        branch: { select: { branch_id: true, branch_name: true, type_branch: true } },
      },
      orderBy: { branch_id: "asc" },
    });

    return userBranches.map((userBranch) => ({
      id: userBranch.branch.branch_id,
      label: userBranch.branch.branch_name,
      typeBranch: userBranch.branch.type_branch,
    }));
  }

  private async resolveOptionBranchIds(
    requestedBranchId: string | undefined,
    scope: RequestScope,
  ): Promise<string[]> {
    const branches = await this.findAccessibleBranches(scope);
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
      consultTypes: [
        { id: "consult", label: "Consult" },
        { id: "procedure", label: "Procedure" },
        { id: "follow-up", label: "Follow-up" },
      ],
      marketingPlatforms: [
        { id: "facebook", label: "Facebook" },
        { id: "line", label: "LINE" },
        { id: "google-ads", label: "Google Ads" },
        { id: "walk-in", label: "Walk-in" },
        { id: "instagram", label: "Instagram" },
      ],
      marketingCampaigns: [
        { id: "birthday-promotion", label: "Birthday Promotion" },
        { id: "member-special", label: "Member Special" },
        { id: "flash-sale", label: "Flash Sale" },
        { id: "new-year-campaign", label: "New Year Campaign" },
      ],
      preparationTags: [
        { id: "no-vitamins", label: "No vitamins" },
        { id: "no-alcohol", label: "No alcohol" },
        { id: "fasting", label: "Fasting" },
        { id: "wash-face", label: "Wash face" },
        { id: "numbing-cream", label: "Numbing cream" },
      ],
      internalTags: [
        { id: "laser-zone", label: "Laser zone" },
        { id: "vip", label: "VIP patient" },
        { id: "special-care", label: "Special care" },
      ],
      numbingDurations: [30, 45, 60],
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

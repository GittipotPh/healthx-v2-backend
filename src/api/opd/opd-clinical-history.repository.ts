import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  OpdVitalTrendMetric,
  type QueryCustomerExaminationHistoryDto,
  type QueryCustomerVitalTrendDto,
} from "./dto/opd-clinical-history.dto";
import type {
  OpdExaminationHistoryRecord,
  OpdVitalTrendRecord,
} from "./opd-clinical-history.mapper";

export interface OpdHistoryUserRecord {
  user_id: string;
  name: string | null;
  lastname: string | null;
  nickname: string | null;
  email: string;
}

@Injectable()
export class OpdClinicalHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async customerExists(
    customerId: string,
    scope: RequestScope,
  ): Promise<boolean> {
    const customer = await this.prisma.customer.findFirst({
      where: { customer_id: customerId, clinic_id: scope.clinicId },
      select: { customer_id: true },
    });
    return customer !== null;
  }

  async listCustomerExaminations(
    customerId: string,
    query: QueryCustomerExaminationHistoryDto,
    scope: RequestScope,
  ): Promise<{
    items: OpdExaminationHistoryRecord[];
    total: number;
    recorderUserIds: string[];
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.historyWhere(customerId, query, scope, true);
    const facetWhere = this.historyWhere(customerId, query, scope, false);
    const [items, total, recorderRows] = await this.prisma.$transaction([
      this.prisma.opd_examination.findMany({
        where,
        include: {
          vital_observation: true,
          intake: true,
          symptom_section: {
            include: {
              symptoms: {
                orderBy: { display_order: "asc" },
                include: {
                  associations: { orderBy: { display_order: "asc" } },
                },
              },
            },
          },
          encounter: {
            select: {
              customer_id: true,
              legacy_opd_id: true,
              business_date: true,
            },
          },
        },
        orderBy: [
          { measured_at: "desc" },
          { examination_number: "desc" },
          { examination_id: "desc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opd_examination.count({ where }),
      this.prisma.opd_examination.findMany({
        where: facetWhere,
        select: { recorder_user_id: true },
        distinct: ["recorder_user_id"],
        orderBy: { recorder_user_id: "asc" },
      }),
    ]);
    return {
      items,
      total,
      recorderUserIds: recorderRows.map((row) => row.recorder_user_id),
      page,
      pageSize,
    };
  }

  async findCustomerExamination(
    customerId: string,
    examinationId: string,
    scope: RequestScope,
  ): Promise<OpdExaminationHistoryRecord | null> {
    return this.prisma.opd_examination.findFirst({
      where: {
        examination_id: examinationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter: { customer_id: customerId },
      },
      include: {
        vital_observation: true,
        intake: true,
        symptom_section: {
          include: {
            symptoms: {
              orderBy: { display_order: "asc" },
              include: {
                associations: { orderBy: { display_order: "asc" } },
              },
            },
          },
        },
        encounter: {
          select: {
            customer_id: true,
            legacy_opd_id: true,
            business_date: true,
          },
        },
      },
    });
  }

  async listVitalTrend(
    customerId: string,
    query: QueryCustomerVitalTrendDto,
    scope: RequestScope,
  ): Promise<{ items: OpdVitalTrendRecord[]; total: number; limit: number }> {
    const metric = query.metric ?? OpdVitalTrendMetric.WEIGHT_KG;
    const limit = query.limit ?? 200;
    const where: Prisma.opd_examinationWhereInput = {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
      status: { in: ["DRAFT", "FINAL"] },
      OR: [
        { status: "FINAL" },
        { status: "DRAFT", supersedes_examination_id: null },
      ],
      ...(query.recorderUserId
        ? { recorder_user_id: query.recorderUserId.trim() }
        : {}),
      encounter: {
        customer_id: customerId,
        ...this.businessDateWhere(query.dateFrom, query.dateTo),
      },
      vital_observation: { is: this.trendVitalWhere(metric) },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.opd_examination.findMany({
        where,
        include: {
          vital_observation: true,
          encounter: {
            select: {
              customer_id: true,
              legacy_opd_id: true,
              business_date: true,
            },
          },
        },
        orderBy: [
          { measured_at: "desc" },
          { examination_number: "desc" },
          { examination_id: "desc" },
        ],
        take: limit,
      }),
      this.prisma.opd_examination.count({ where }),
    ]);
    return { items, total, limit };
  }

  async branchName(scope: RequestScope): Promise<string | null> {
    const row = await this.prisma.branch.findFirst({
      where: { branch_id: scope.branchId, clinic_id: scope.clinicId },
      select: { branch_name: true },
    });
    return row?.branch_name ?? null;
  }

  async usersByIds(
    userIds: string[],
    scope: RequestScope,
  ): Promise<OpdHistoryUserRecord[]> {
    if (userIds.length === 0) return [];
    return this.prisma.user.findMany({
      where: {
        user_id: { in: userIds },
        OR: [{ clinic_id: scope.clinicId }, { clinic_id: null }],
      },
      select: {
        user_id: true,
        name: true,
        lastname: true,
        nickname: true,
        email: true,
      },
    });
  }

  private historyWhere(
    customerId: string,
    query: QueryCustomerExaminationHistoryDto,
    scope: RequestScope,
    includeRecorder: boolean,
  ): Prisma.opd_examinationWhereInput {
    return {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
      ...(query.status
        ? { status: query.status }
        : { status: { not: "VOID" } }),
      ...(includeRecorder && query.recorderUserId
        ? { recorder_user_id: query.recorderUserId.trim() }
        : {}),
      encounter: {
        customer_id: customerId,
        ...this.businessDateWhere(query.dateFrom, query.dateTo),
      },
    };
  }

  private businessDateWhere(
    dateFrom: string | undefined,
    dateTo: string | undefined,
  ): Pick<Prisma.opd_encounterWhereInput, "business_date"> {
    if (!dateFrom && !dateTo) return {};
    return {
      business_date: {
        ...(dateFrom ? { gte: this.dateOnly(dateFrom) } : {}),
        ...(dateTo ? { lte: this.dateOnly(dateTo) } : {}),
      },
    };
  }

  private trendVitalWhere(
    metric: OpdVitalTrendMetric,
  ): Prisma.opd_vital_observationWhereInput {
    switch (metric) {
      case OpdVitalTrendMetric.WEIGHT_KG:
        return { weight_kg: { not: null } };
      case OpdVitalTrendMetric.BODY_MASS_INDEX:
        return { body_mass_index: { not: null } };
      case OpdVitalTrendMetric.BLOOD_PRESSURE:
        return {
          OR: [
            { systolic_blood_pressure_mmhg: { not: null } },
            { diastolic_blood_pressure_mmhg: { not: null } },
          ],
        };
      case OpdVitalTrendMetric.PULSE_RATE:
        return { pulse_rate_per_minute: { not: null } };
      case OpdVitalTrendMetric.TEMPERATURE:
        return { temperature_celsius: { not: null } };
      case OpdVitalTrendMetric.OXYGEN_SATURATION:
        return { oxygen_saturation_percent: { not: null } };
      case OpdVitalTrendMetric.RESPIRATORY_RATE:
        return { respiratory_rate_per_minute: { not: null } };
      case OpdVitalTrendMetric.DTX:
        return { dtx_mg_dl: { not: null } };
      case OpdVitalTrendMetric.PAIN_SCORE:
        return { pain_score: { not: null } };
    }
  }

  private dateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
}

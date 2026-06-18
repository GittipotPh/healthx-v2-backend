import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { OpdWithCustomer } from "./opd.mapper";
import type { QueryOpdDto } from "./dto/query-opd.dto";

export interface PaginatedOpd {
  items: OpdWithCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OpdRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: QueryOpdDto): Promise<PaginatedOpd> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.opd.findMany({
        where,
        include: { customer: true },
        orderBy: { opd_date: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opd.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findHistoryByCustomer(customerId: string, clinicId: string): Promise<OpdWithCustomer[]> {
    return this.prisma.opd.findMany({
      where: { customer_id: customerId, clinic_id: clinicId },
      include: { customer: true },
      orderBy: { opd_date: "desc" },
    });
  }

  private buildWhere(query: QueryOpdDto): Prisma.opdWhereInput {
    const where: Prisma.opdWhereInput = {};

    if (query.clinicId) where.clinic_id = query.clinicId;
    if (query.branchId) where.branch_id = query.branchId;
    if (query.customerId) where.customer_id = query.customerId;
    if (query.status) where.status_opd = query.status;

    return where;
  }
}

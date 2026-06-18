import { Injectable } from "@nestjs/common";
import type { Prisma, customer } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { QueryCustomersDto } from "./dto/query-customers.dto";

export interface PaginatedCustomers {
  items: customer[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: QueryCustomersDto): Promise<PaginatedCustomers> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(customerId: string, clinicId: string): Promise<customer | null> {
    return this.prisma.customer.findUnique({
      where: { customer_id_clinic_id: { customer_id: customerId, clinic_id: clinicId } },
    });
  }

  private buildWhere(query: QueryCustomersDto): Prisma.customerWhereInput {
    const where: Prisma.customerWhereInput = {};

    if (query.clinicId) where.clinic_id = query.clinicId;
    if (query.branchId) where.branch_id = query.branchId;
    if (query.vip === "true") where.status_vip = true;
    if (query.vip === "false") where.status_vip = false;

    if (query.search) {
      const search = query.search;
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { lastname: { contains: search, mode: "insensitive" } },
        { nickname: { contains: search, mode: "insensitive" } },
        { phone_number: { contains: search } },
        { personal_id: { contains: search } },
      ];
    }

    return where;
  }
}

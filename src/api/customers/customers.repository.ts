import { Injectable } from "@nestjs/common";
import { record_status, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { QueryCustomersDto } from "./dto/query-customers.dto";
import type { RequestScope } from "../../auth/auth.types";
import type { CustomerWithCardRelations } from "./customers.mapper";

export interface PaginatedCustomers {
  items: CustomerWithCardRelations[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: QueryCustomersDto, scope: RequestScope): Promise<PaginatedCustomers> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: {
          attendant_detail: {
            select: { name: true, lastname: true, nickname: true },
          },
          customer_attendant: {
            where: { status: record_status.ACTIVE },
            include: {
              user: { select: { name: true, lastname: true, nickname: true } },
            },
            take: 1,
          },
          documents_signed_customer: {
            select: { status: true },
          },
          customer_coures: {
            include: {
              course_item: { select: { name: true } },
            },
            orderBy: { created_at: "desc" },
          },
          customer_course_usage_log: {
            select: {
              item_id: true,
              expire_date: true,
              amount: true,
              status: true,
            },
          },
          customer_wallet: {
            select: {
              amount: true,
              bonus: true,
              status: true,
            },
          },
          wallet_log: {
            select: {
              in: true,
              out: true,
            },
          },
          sale_order: {
            select: {
              totalDue: true,
              sale_order_status: true,
              status: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(customerId: string, clinicId: string): Promise<CustomerWithCardRelations | null> {
    return this.prisma.customer.findUnique({
      where: { customer_id_clinic_id: { customer_id: customerId, clinic_id: clinicId } },
      include: {
        attendant_detail: {
          select: { name: true, lastname: true, nickname: true },
        },
        customer_attendant: {
          where: { status: record_status.ACTIVE },
          include: {
            user: { select: { name: true, lastname: true, nickname: true } },
          },
          take: 1,
        },
        documents_signed_customer: {
          select: { status: true },
        },
        customer_coures: {
          include: {
            course_item: { select: { name: true } },
          },
          orderBy: { created_at: "desc" },
        },
        customer_course_usage_log: {
          select: {
            item_id: true,
            expire_date: true,
            amount: true,
            status: true,
          },
        },
        customer_wallet: {
          select: {
            amount: true,
            bonus: true,
            status: true,
          },
        },
        wallet_log: {
          select: {
            in: true,
            out: true,
          },
        },
        sale_order: {
          select: {
            totalDue: true,
            sale_order_status: true,
            status: true,
          },
        },
      },
    });
  }

  private buildWhere(query: QueryCustomersDto, scope: RequestScope): Prisma.customerWhereInput {
    // Customers are clinic-wide; we deliberately do not filter by branch here.
    const where: Prisma.customerWhereInput = { clinic_id: scope.clinicId };

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

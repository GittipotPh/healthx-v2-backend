import { Injectable } from "@nestjs/common";
import { record_status, sale_order_status, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { QueryCustomersDto } from "./dto/query-customers.dto";
import type { RequestScope } from "../../auth/auth.types";
import type { CustomerOptionsView, CustomerWithCardRelations } from "./customers.mapper";
import type {
  CustomerFileWithUser,
  CustomerNoteWithUser,
  CustomerProfileRow,
} from "./customer-profile.mapper";

export interface PaginatedCustomers {
  items: CustomerWithCardRelations[];
  total: number;
  page: number;
  pageSize: number;
}

/** Relations the customer-card aggregate needs; shared by findMany/findOne. */
const CUSTOMER_CARD_INCLUDE = {
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
} satisfies Prisma.customerInclude;

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async options(scope: RequestScope): Promise<CustomerOptionsView> {
    const [groups, directAttendants, assignedAttendants] = await this.prisma.$transaction([
      this.prisma.customer_group.findMany({
        where: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
        select: { group_id: true, group_name: true, color_group: true, order: true },
        orderBy: [{ order: "asc" }, { group_name: "asc" }],
      }),
      this.prisma.customer.findMany({
        where: {
          clinic_id: scope.clinicId,
          attendant: { not: null },
        },
        select: {
          attendant: true,
          attendant_detail: {
            select: { user_id: true, name: true, lastname: true, nickname: true, email: true },
          },
        },
        distinct: ["attendant"],
      }),
      this.prisma.customer_attendant.findMany({
        where: {
          clinic_id: scope.clinicId,
          status: record_status.ACTIVE,
          user: { status: record_status.ACTIVE },
        },
        select: {
          user_id: true,
          user: { select: { user_id: true, name: true, lastname: true, nickname: true, email: true } },
        },
        distinct: ["user_id"],
      }),
    ]);

    const attendants = new Map<string, CustomerOptionsView["attendants"][number]>();
    for (const row of directAttendants) {
      const user = row.attendant_detail;
      const id = user?.user_id ?? row.attendant;
      if (!id || attendants.has(id)) continue;
      attendants.set(id, {
        id,
        label: user ? this.userLabel(user) : id,
        nickname: user?.nickname ?? null,
      });
    }
    for (const row of assignedAttendants) {
      if (attendants.has(row.user_id)) continue;
      attendants.set(row.user_id, {
        id: row.user_id,
        label: this.userLabel(row.user),
        nickname: row.user.nickname,
      });
    }

    return {
      groups: groups.map((group) => ({
        id: group.group_id,
        label: group.group_name,
        color: group.color_group,
      })),
      attendants: Array.from(attendants.values()).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    };
  }

  async findMany(query: QueryCustomersDto, scope: RequestScope): Promise<PaginatedCustomers> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: CUSTOMER_CARD_INCLUDE,
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
      include: CUSTOMER_CARD_INCLUDE,
    });
  }

  async existsInClinic(customerId: string, clinicId: string): Promise<boolean> {
    const found = await this.prisma.customer.findUnique({
      where: { customer_id_clinic_id: { customer_id: customerId, clinic_id: clinicId } },
      select: { customer_id: true },
    });
    return found !== null;
  }

  async findProfile(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileRow | null> {
    const row = await this.prisma.customer.findUnique({
      where: {
        customer_id_clinic_id: {
          customer_id: customerId,
          clinic_id: scope.clinicId,
        },
      },
      include: {
        attendant_detail: {
          select: { name: true, lastname: true, nickname: true },
        },
        customer_attendant: {
          where: { status: record_status.ACTIVE, branch_id: scope.branchId },
          include: {
            user: { select: { name: true, lastname: true, nickname: true } },
          },
          take: 1,
        },
        customer_info: true,
        customer_group_info: {
          select: { group_name: true, color_group: true },
        },
        documents_signed_customer: {
          include: {
            documents_signed: {
              select: {
                document_name: true,
                purpose_use: true,
                document_type: true,
                document_url: true,
              },
            },
          },
          orderBy: { created_at: "desc" },
        },
        customer_coures: {
          where: { branch_id: scope.branchId },
          include: {
            course_item: { select: { name: true } },
          },
          orderBy: { created_at: "desc" },
        },
        customer_course_usage_log: {
          where: { branch_id: scope.branchId },
          include: {
            course_item: { select: { name: true } },
          },
          orderBy: { created_at: "desc" },
        },
        customer_wallet: {
          where: { branch_id: scope.branchId },
          include: {
            payment_method: { select: { name: true } },
            cashier_detail: { select: { name: true, lastname: true, nickname: true } },
          },
          orderBy: { created_at: "desc" },
        },
        wallet_log: {
          where: { branch_id: scope.branchId },
          select: {
            wallet_log_id: true,
            in: true,
            out: true,
            type: true,
            created_at: true,
          },
          orderBy: { created_at: "desc" },
          take: 50,
        },
        sale_order: {
          where: { branch_id: scope.branchId },
          include: {
            receipt: {
              include: {
                clinic_payment_method: {
                  select: { name: true, payment_type: true },
                },
              },
              orderBy: { created_at: "desc" },
            },
            sale_order_item: {
              select: { item_name: true, quantity: true, total: true },
            },
            seller: {
              select: { name: true, lastname: true, nickname: true },
            },
          },
          orderBy: { created_at: "desc" },
          take: 50,
        },
        appointment: {
          where: {
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
          },
          select: {
            appointment_id: true,
            branch_id: true,
            date_appointment: true,
            start_time: true,
            end_time: true,
            appointment_detail: true,
            status_appointment: true,
            created_at: true,
            branch: { select: { branch_name: true } },
            user_appointment: {
              include: {
                user: { select: { name: true, lastname: true, nickname: true } },
              },
            },
            operation_appointment: {
              include: {
                operation_item: { select: { title: true } },
              },
            },
          },
          orderBy: [{ date_appointment: "desc" }, { start_time: "desc" }],
          take: 50,
        },
        opd: {
          where: {
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
          },
          include: {
            user: { select: { name: true, lastname: true, nickname: true } },
          },
          orderBy: { opd_date: "desc" },
          take: 50,
        },
      },
    });

    return row as CustomerProfileRow | null;
  }

  /** Appointments only — for GET :customerId/appointments (no profile mega-query). */
  async findAppointmentSlice(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileRow | null> {
    console.log({scope})
    const row = await this.prisma.customer.findUnique({
      where: {
        customer_id_clinic_id: { customer_id: customerId, clinic_id: scope.clinicId },
      },
      include: {
        appointment: {
          where: {
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
          },
          select: {
            appointment_id: true,
            branch_id: true,
            date_appointment: true,
            start_time: true,
            end_time: true,
            appointment_detail: true,
            status_appointment: true,
            created_at: true,
            branch: { select: { branch_name: true } },
            user_appointment: {
              include: {
                user: { select: { name: true, lastname: true, nickname: true } },
              },
            },
            operation_appointment: {
              include: {
                operation_item: { select: { title: true } },
              },
            },
          },
          orderBy: [{ date_appointment: "desc" }, { start_time: "desc" }],
          take: 50,
        },
      },
    });

    return row as CustomerProfileRow | null;
  }

  /** Sale orders/receipts + wallets — for GET :customerId/financials. */
  async findFinancialSlice(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileRow | null> {
    const row = await this.prisma.customer.findUnique({
      where: {
        customer_id_clinic_id: { customer_id: customerId, clinic_id: scope.clinicId },
      },
      include: {
        customer_wallet: {
          where: { branch_id: scope.branchId },
          select: { amount: true, bonus: true, status: true },
        },
        wallet_log: {
          where: { branch_id: scope.branchId },
          select: {
            wallet_log_id: true,
            in: true,
            out: true,
            type: true,
            created_at: true,
          },
          orderBy: { created_at: "desc" },
          take: 50,
        },
        sale_order: {
          where: { branch_id: scope.branchId },
          include: {
            receipt: {
              include: {
                clinic_payment_method: {
                  select: { name: true, payment_type: true },
                },
              },
              orderBy: { created_at: "desc" },
            },
          },
          orderBy: { created_at: "desc" },
          take: 50,
        },
      },
    });

    return row as CustomerProfileRow | null;
  }

  /** Signed documents only — for GET :customerId/documents (files come from findFiles). */
  async findDocumentSlice(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileRow | null> {
    const row = await this.prisma.customer.findUnique({
      where: {
        customer_id_clinic_id: { customer_id: customerId, clinic_id: scope.clinicId },
      },
      include: {
        documents_signed_customer: {
          include: {
            documents_signed: {
              select: {
                document_name: true,
                purpose_use: true,
                document_type: true,
                document_url: true,
              },
            },
          },
          orderBy: { created_at: "desc" },
        },
      },
    });

    return row as CustomerProfileRow | null;
  }

  /** OPD, courses, wallet log, signed docs — for GET :customerId/timeline
   *  (notes/files come from findNotes/findFiles). */
  async findTimelineSlice(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileRow | null> {
    const row = await this.prisma.customer.findUnique({
      where: {
        customer_id_clinic_id: { customer_id: customerId, clinic_id: scope.clinicId },
      },
      include: {
        opd: {
          where: {
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
          },
          include: {
            user: { select: { name: true, lastname: true, nickname: true } },
          },
          orderBy: { opd_date: "desc" },
          take: 50,
        },
        customer_coures: {
          where: { branch_id: scope.branchId },
          include: {
            course_item: { select: { name: true } },
          },
          orderBy: { created_at: "desc" },
        },
        customer_course_usage_log: {
          where: { branch_id: scope.branchId },
          include: {
            course_item: { select: { name: true } },
          },
          orderBy: { created_at: "desc" },
        },
        wallet_log: {
          where: { branch_id: scope.branchId },
          select: {
            wallet_log_id: true,
            in: true,
            out: true,
            type: true,
            created_at: true,
          },
          orderBy: { created_at: "desc" },
          take: 50,
        },
        documents_signed_customer: {
          include: {
            documents_signed: {
              select: {
                document_name: true,
                purpose_use: true,
                document_type: true,
                document_url: true,
              },
            },
          },
          orderBy: { created_at: "desc" },
        },
      },
    });

    return row as CustomerProfileRow | null;
  }

  async findNotes(customerId: string, scope: RequestScope): Promise<CustomerNoteWithUser[]> {
    const rows = await this.prisma.customer_note.findMany({
      where: {
        customer_id: customerId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: record_status.ACTIVE,
      },
      include: {
        created_by_user: { select: { name: true, lastname: true, nickname: true } },
        updated_by_user: { select: { name: true, lastname: true, nickname: true } },
      },
      orderBy: { created_at: "desc" },
    });

    return rows as CustomerNoteWithUser[];
  }

  async createNote(input: {
    noteId: string;
    customerId: string;
    content: string;
    scope: RequestScope;
  }): Promise<CustomerNoteWithUser> {
    const now = new Date();
    const row = await this.prisma.customer_note.create({
      data: {
        note_id: input.noteId,
        clinic_id: input.scope.clinicId,
        branch_id: input.scope.branchId,
        customer_id: input.customerId,
        content: input.content,
        status: record_status.ACTIVE,
        created_by: input.scope.userId,
        created_at: now,
        updated_at: now,
      },
      include: {
        created_by_user: { select: { name: true, lastname: true, nickname: true } },
        updated_by_user: { select: { name: true, lastname: true, nickname: true } },
      },
    });

    return row as CustomerNoteWithUser;
  }

  async findFiles(customerId: string, scope: RequestScope): Promise<CustomerFileWithUser[]> {
    const rows = await this.prisma.customer_file.findMany({
      where: {
        customer_id: customerId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: record_status.ACTIVE,
      },
      include: {
        uploaded_by_user: { select: { name: true, lastname: true, nickname: true } },
      },
      orderBy: { created_at: "desc" },
    });

    return rows as CustomerFileWithUser[];
  }

  async findFile(
    customerId: string,
    fileId: string,
    scope: RequestScope,
  ): Promise<CustomerFileWithUser | null> {
    const row = await this.prisma.customer_file.findFirst({
      where: {
        file_id: fileId,
        customer_id: customerId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: record_status.ACTIVE,
      },
      include: {
        uploaded_by_user: { select: { name: true, lastname: true, nickname: true } },
      },
    });

    return row as CustomerFileWithUser | null;
  }

  async createFile(input: {
    fileId: string;
    customerId: string;
    displayName: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    storageProvider: string;
    bucketName: string;
    objectKey: string;
    publicUrl: string | null;
    scope: RequestScope;
  }): Promise<CustomerFileWithUser> {
    const now = new Date();
    const row = await this.prisma.customer_file.create({
      data: {
        file_id: input.fileId,
        clinic_id: input.scope.clinicId,
        branch_id: input.scope.branchId,
        customer_id: input.customerId,
        display_name: input.displayName,
        original_name: input.originalName,
        mime_type: input.mimeType,
        file_size: input.fileSize,
        storage_provider: input.storageProvider,
        bucket_name: input.bucketName,
        object_key: input.objectKey,
        public_url: input.publicUrl,
        status: record_status.ACTIVE,
        uploaded_by: input.scope.userId,
        created_at: now,
        updated_at: now,
      },
      include: {
        uploaded_by_user: { select: { name: true, lastname: true, nickname: true } },
      },
    });

    return row as CustomerFileWithUser;
  }

  async markFileDeleted(fileId: string, scope: RequestScope): Promise<void> {
    await this.prisma.customer_file.updateMany({
      where: {
        file_id: fileId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      data: {
        status: record_status.DELETED,
        updated_at: new Date(),
      },
    });
  }

  private buildWhere(query: QueryCustomersDto, scope: RequestScope): Prisma.customerWhereInput {
    const where: Prisma.customerWhereInput = { clinic_id: scope.clinicId };
    const and: Prisma.customerWhereInput[] = [];

    if (query.branchId) where.branch_id = query.branchId;

    if (query.vip === "true") where.status_vip = true;
    if (query.vip === "false") where.status_vip = false;

    if (query.groupId) where.customer_group = query.groupId;

    if (query.attendantId) {
      and.push({
        OR: [
          { attendant: query.attendantId },
          {
            customer_attendant: {
              some: {
                user_id: query.attendantId,
                status: record_status.ACTIVE,
              },
            },
          },
        ],
      });
    }

    if (query.paymentStatus === "outstanding") {
      where.sale_order = { some: this.outstandingSaleOrderWhere() };
    }
    if (query.paymentStatus === "deposit") {
      where.customer_wallet = { some: this.activeWalletBalanceWhere() };
    }
    if (query.paymentStatus === "clear") {
      where.sale_order = { none: this.outstandingSaleOrderWhere() };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { lastname: { contains: search, mode: "insensitive" } },
        { nickname: { contains: search, mode: "insensitive" } },
        { phone_number: { contains: search } },
        { personal_id: { contains: search } },
      ];
    }

    if (and.length > 0) where.AND = and;

    return where;
  }

  private outstandingSaleOrderWhere(): Prisma.sale_orderWhereInput {
    return {
      status: record_status.ACTIVE,
      sale_order_status: { in: [sale_order_status.PENDING, sale_order_status.PARTAIL] },
      totalDue: { gt: 0 },
    };
  }

  private activeWalletBalanceWhere(): Prisma.customer_walletWhereInput {
    return {
      status: record_status.ACTIVE,
      OR: [{ amount: { gt: 0 } }, { bonus: { gt: 0 } }],
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

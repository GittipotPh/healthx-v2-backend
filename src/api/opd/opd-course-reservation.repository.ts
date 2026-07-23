import { Injectable } from "@nestjs/common";
import {
  Prisma,
  amount_unit,
  course_usage_type,
  document_key,
  format_type,
  operator_type,
  record_status,
  role_enum,
  service_usage_status,
  usage_log_status,
  type api_idempotency,
  type opd,
  type opd_encounter,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { bangkokBusinessDate } from "../../common/business-date";
import { PrismaService } from "../../prisma.service";
import type { OpdCourseReservationRecord } from "./opd-course-reservation.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

interface CourseReservationCreateClient {
  opd_course_reservation: {
    create(args: {
      data: Prisma.opd_course_reservationUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
  opd_course_reservation_item: {
    createMany(args: {
      data: Prisma.opd_course_reservation_itemCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  opd_course_reservation_component: {
    createMany(args: {
      data: Prisma.opd_course_reservation_componentCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  opd_course_reservation_operator: {
    createMany(args: {
      data: Prisma.opd_course_reservation_operatorCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  service_usage: {
    create(args: {
      data: Prisma.service_usageUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
  service_usage_item: {
    createMany(args: {
      data: Prisma.service_usage_itemCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  service_usage_item_product: {
    createMany(args: {
      data: Prisma.service_usage_item_productCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  course_operator_user: {
    createMany(args: {
      data: Prisma.course_operator_userCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  service_usage_item_commission: {
    createMany(args: {
      data: Prisma.service_usage_item_commissionCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  customer_course_usage_log: {
    createMany(args: {
      data: Prisma.customer_course_usage_logCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  opd: {
    updateMany(args: Prisma.opdUpdateManyArgs): PromiseLike<{ count: number }>;
  };
}

const entitlementInclude = {
  sale_order: {
    select: {
      sale_order_id: true,
      branch_id: true,
      clinic_id: true,
      customer_id: true,
      sale_order_status: true,
      status: true,
      date: true,
      updated_at: true,
    },
  },
  course_item: {
    include: {
      course: { include: { course_operator: true } },
      course_item_product: { include: { product: true } },
    },
  },
} satisfies Prisma.customer_couresInclude;

export type CourseEntitlementRecord = Prisma.customer_couresGetPayload<{
  include: typeof entitlementInclude;
}>;

const reservationInclude = {
  items: {
    include: { components: true, operators: true },
    orderBy: { display_order: "asc" as const },
  },
  verification: {
    include: {
      components: true,
      compensation_requests: {
        include: { components: true },
        orderBy: { requested_at: "desc" as const },
      },
    },
  },
} satisfies Prisma.opd_course_reservationInclude;

interface LockedIdRow {
  id: string;
}

interface AllocatedNumberRow {
  current_number: number;
}

interface LotQueryRow {
  lot_id: string;
  in_stock: Prisma.Decimal | null;
  expiry_count: bigint;
  expiry_at: Date | null;
  inventory_updated_at: Date | null;
}

export interface CourseEntitlementIdentity {
  clinicId: string;
  purchaseBranchId: string;
  customerId: string;
  saleOrderId: string;
  courseItemId: string;
  entitlementExpireAt: Date;
}

export interface CourseUsageBalance {
  reserved: Prisma.Decimal;
  used: Prisma.Decimal;
}

export interface CourseComponentLotRecord {
  lotId: string;
  inStock: Prisma.Decimal;
  expiryCount: number;
  expiryAt: Date | null;
  inventoryUpdatedAt: Date | null;
}

export interface CourseOperatorAssignment {
  userId: string;
  displayName: string;
  operatorType: operator_type;
  roleId: role_enum;
  userUpdatedAt: Date | null;
}

export interface PreparedCourseComponent {
  reservationComponentId: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  configuredQuantity: Prisma.Decimal;
  totalQuantity: Prisma.Decimal;
  lotId: string;
  expiryAt: Date;
  stockObservedQuantity: Prisma.Decimal;
  sourceUpdatedAt: Date | null;
}

export interface PreparedCourseOperator {
  reservationOperatorId: string;
  userId: string;
  roleId: role_enum;
  operatorType: operator_type;
  commissionAmount: Prisma.Decimal;
  commissionUnit: amount_unit;
  sourceUserUpdatedAt: Date | null;
}

export interface PreparedCourseReservationItem {
  reservationItemId: string;
  legacyServiceUsageItemId: string;
  legacyUsageLogId: string;
  displayOrder: number;
  purchaseBranchId: string;
  customerId: string;
  saleOrderId: string;
  courseId: string;
  courseItemId: string;
  courseCode: string;
  courseName: string;
  itemName: string;
  unit: string;
  entitlementExpireAt: Date;
  displayExpireAt: Date;
  entitlementAmount: Prisma.Decimal;
  beforeReservedAmount: Prisma.Decimal;
  beforeUsedAmount: Prisma.Decimal;
  beforeRemainingAmount: Prisma.Decimal;
  reservedAmount: Prisma.Decimal;
  afterRemainingAmount: Prisma.Decimal;
  entitlementCreatedAt: Date | null;
  entitlementUpdatedAt: Date | null;
  saleOrderUpdatedAt: Date | null;
  courseUpdatedAt: Date;
  courseItemUpdatedAt: Date;
  sourceSnapshotHash: string;
  components: PreparedCourseComponent[];
  operators: PreparedCourseOperator[];
}

export interface CreateCourseReservationInput {
  reservationId: string;
  encounterId: string;
  customerId: string;
  legacyOpdId: string;
  legacyServiceUsageId: string;
  requestHash: string;
  idempotencyKeyHash: string;
  sourceEncounterVersion: number;
  sourceBalanceManifest: Prisma.InputJsonArray;
  items: PreparedCourseReservationItem[];
}

export type LegacyCourseReservationState = {
  serviceUsage: Prisma.service_usageGetPayload<{
    include: {
      service_usage_item: {
        include: {
          service_usage_item_product: true;
          service_usage_item_commission: true;
        };
      };
      course_operator_user: true;
      service_usage_request_cancel: true;
    };
  }> | null;
  usageLogs: Array<{
    id: string;
    service_usage_id: string;
    customer_id: string;
    branch_id: string;
    clinic_id: string;
    item_id: string;
    amount: Prisma.Decimal | null;
    status: usage_log_status;
    expire_date: Date;
    course_usage_type: course_usage_type | null;
  }>;
  legacyOpd: opd | null;
  inventoryMovementCount: number;
};

@Injectable()
export class OpdCourseReservationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEffectivePermissions(
    permissionIds: string[],
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<Set<string>> {
    if (scope.isClinicRootUser) return new Set(permissionIds);
    if (!scope.branchId || permissionIds.length === 0) return new Set();
    const [overrides, defaults] = await Promise.all([
      client.user_permission.findMany({
        where: {
          branch_id: scope.branchId,
          user_id: scope.userId,
          permission_id: { in: permissionIds },
        },
        select: { permission_id: true, permission: true },
      }),
      scope.roles.length === 0
        ? Promise.resolve([])
        : client.default_permission.findMany({
            where: {
              role_id: { in: scope.roles },
              permission_id: { in: permissionIds },
            },
            select: { permission_id: true },
          }),
    ]);
    const explicit = new Map(
      overrides
        .filter((row) => row.permission !== null)
        .map((row) => [row.permission_id, row.permission === true]),
    );
    const roleGrants = new Set(defaults.map((row) => row.permission_id));
    return new Set(
      permissionIds.filter((permissionId) =>
        explicit.has(permissionId)
          ? explicit.get(permissionId) === true
          : roleGrants.has(permissionId),
      ),
    );
  }

  findEncounter(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_encounter | null> {
    return client.opd_encounter.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  async lockEncounter(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT encounter_id::TEXT AS id
      FROM opd_encounter
      WHERE encounter_id = ${encounterId}::UUID
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  findLegacyOpd(
    encounter: opd_encounter,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd | null> {
    if (!encounter.legacy_opd_id) return Promise.resolve(null);
    return client.opd.findFirst({
      where: {
        opd_id: encounter.legacy_opd_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: encounter.customer_id,
      },
    });
  }

  async lockLegacyOpd(
    encounter: opd_encounter,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!encounter.legacy_opd_id) return false;
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT opd_id AS id
      FROM opd
      WHERE opd_id = ${encounter.legacy_opd_id}
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
        AND customer_id = ${encounter.customer_id}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  async listEntitlements(
    customerId: string,
    page: number,
    pageSize: number,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<{ rows: CourseEntitlementRecord[]; total: number }> {
    const where: Prisma.customer_couresWhereInput = {
      clinic_id: scope.clinicId,
      customer_id: customerId,
    };
    const [rows, total] = await Promise.all([
      client.customer_coures.findMany({
        where,
        include: entitlementInclude,
        orderBy: [
          { expire_date_display: "asc" },
          { created_at: "desc" },
          { sale_order_id: "asc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      client.customer_coures.count({ where }),
    ]);
    return { rows, total };
  }

  findEntitlement(
    identity: CourseEntitlementIdentity,
    client: DatabaseClient = this.prisma,
  ): Promise<CourseEntitlementRecord | null> {
    return client.customer_coures.findFirst({
      where: {
        clinic_id: identity.clinicId,
        branch_id: identity.purchaseBranchId,
        customer_id: identity.customerId,
        sale_order_id: identity.saleOrderId,
        item_id: identity.courseItemId,
        expire_date: identity.entitlementExpireAt,
      },
      include: entitlementInclude,
    });
  }

  async lockEntitlements(
    identities: CourseEntitlementIdentity[],
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    if (identities.length === 0) return 0;
    const conditions = identities
      .slice()
      .sort((left, right) =>
        `${left.purchaseBranchId}|${left.saleOrderId}|${left.courseItemId}|${left.entitlementExpireAt.toISOString()}`.localeCompare(
          `${right.purchaseBranchId}|${right.saleOrderId}|${right.courseItemId}|${right.entitlementExpireAt.toISOString()}`,
        ),
      )
      .map(
        (identity) => Prisma.sql`(
          branch_id = ${identity.purchaseBranchId}
          AND sale_order_id = ${identity.saleOrderId}
          AND customer_id = ${identity.customerId}
          AND item_id = ${identity.courseItemId}
          AND expire_date = ${identity.entitlementExpireAt}
        )`,
      );
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT sale_order_id AS id
      FROM customer_coures
      WHERE clinic_id = ${identities[0].clinicId}
        AND (${Prisma.join(conditions, " OR ")})
      ORDER BY branch_id, sale_order_id, item_id, expire_date
      FOR UPDATE
    `);
    return rows.length;
  }

  countLogicalEntitlements(
    identity: CourseEntitlementIdentity,
    client: DatabaseClient = this.prisma,
  ): Promise<number> {
    return client.customer_coures.count({
      where: {
        clinic_id: identity.clinicId,
        customer_id: identity.customerId,
        item_id: identity.courseItemId,
        expire_date: identity.entitlementExpireAt,
      },
    });
  }

  async usageBalance(
    identity: CourseEntitlementIdentity,
    client: DatabaseClient = this.prisma,
  ): Promise<CourseUsageBalance> {
    const rows = await client.customer_course_usage_log.groupBy({
      by: ["status"],
      where: {
        clinic_id: identity.clinicId,
        customer_id: identity.customerId,
        item_id: identity.courseItemId,
        expire_date: identity.entitlementExpireAt,
        status: { in: [usage_log_status.RESERVED, usage_log_status.USED] },
      },
      _sum: { amount: true },
    });
    const reserved =
      rows.find((row) => row.status === usage_log_status.RESERVED)?._sum
        .amount ?? new Prisma.Decimal(0);
    const used =
      rows.find((row) => row.status === usage_log_status.USED)?._sum.amount ??
      new Prisma.Decimal(0);
    return { reserved, used };
  }

  async findLots(
    productId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<CourseComponentLotRecord[]> {
    const rows = await client.$queryRaw<LotQueryRow[]>(Prisma.sql`
      SELECT
        inventory.lot_id,
        inventory.in_stock,
        COUNT(DISTINCT receive_order_item.expire_date)::BIGINT AS expiry_count,
        MIN(receive_order_item.expire_date) AS expiry_at,
        inventory.updated_at AS inventory_updated_at
      FROM inventory
      LEFT JOIN receive_order_item
        ON receive_order_item.branch_id = inventory.branch_id
       AND receive_order_item.item_id = inventory.item_id
       AND receive_order_item.lot_id = inventory.lot_id
      WHERE inventory.branch_id = ${scope.branchId}
        AND inventory.item_id = ${productId}
      GROUP BY inventory.lot_id, inventory.in_stock, inventory.updated_at
      ORDER BY inventory.lot_id
    `);
    return rows.map((row) => ({
      lotId: row.lot_id,
      inStock: row.in_stock ?? new Prisma.Decimal(0),
      expiryCount: Number(row.expiry_count),
      expiryAt: row.expiry_at,
      inventoryUpdatedAt: row.inventory_updated_at,
    }));
  }

  async operatorAssignments(
    encounter: opd_encounter,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<CourseOperatorAssignment[]> {
    if (!encounter.appointment_id) return [];
    const appointment = await client.appointment.findFirst({
      where: {
        appointment_id: encounter.appointment_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: encounter.customer_id,
      },
      select: {
        user_appointment: {
          select: {
            operator_type: true,
            user: {
              select: {
                user_id: true,
                name: true,
                lastname: true,
                nickname: true,
                status: true,
                updated_at: true,
                user_branch: {
                  where: { branch_id: scope.branchId },
                  select: { role_id: true, status: true },
                },
              },
            },
          },
        },
      },
    });
    if (!appointment) return [];
    return appointment.user_appointment.flatMap((assignment) => {
      const branch = assignment.user.user_branch[0];
      if (
        assignment.user.status !== record_status.ACTIVE ||
        branch?.status !== record_status.ACTIVE
      ) {
        return [];
      }
      const displayName =
        [assignment.user.name, assignment.user.lastname]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(" ") ||
        assignment.user.nickname?.trim() ||
        "Assigned staff";
      return [
        {
          userId: assignment.user.user_id,
          displayName,
          operatorType: assignment.operator_type,
          roleId: branch.role_id,
          userUpdatedAt: assignment.user.updated_at,
        },
      ];
    });
  }

  findLatestReservation(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdCourseReservationRecord | null> {
    return client.opd_course_reservation.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: reservationInclude,
      orderBy: [{ reserved_at: "desc" }, { created_at: "desc" }],
    });
  }

  findActiveReservation(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdCourseReservationRecord | null> {
    return client.opd_course_reservation.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "RESERVED",
      },
      include: reservationInclude,
    });
  }

  findReservation(
    encounterId: string,
    reservationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdCourseReservationRecord | null> {
    return client.opd_course_reservation.findFirst({
      where: {
        reservation_id: reservationId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: reservationInclude,
    });
  }

  async lockActiveReservation(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT reservation_id::TEXT AS id
      FROM opd_course_reservation
      WHERE encounter_id = ${encounterId}::UUID
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
        AND status = 'RESERVED'
      FOR UPDATE
    `);
    return rows[0]?.id ?? null;
  }

  async lockReservation(
    encounterId: string,
    reservationId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT reservation_id::TEXT AS id
      FROM opd_course_reservation
      WHERE reservation_id = ${reservationId}::UUID
        AND encounter_id = ${encounterId}::UUID
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  findIdempotency(
    operation: string,
    idempotencyKey: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<api_idempotency | null> {
    return client.api_idempotency.findUnique({
      where: {
        clinic_id_branch_id_actor_user_id_operation_idempotency_key: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          actor_user_id: scope.userId,
          operation,
          idempotency_key: idempotencyKey,
        },
      },
    });
  }

  createIdempotency(
    input: {
      operation: string;
      idempotencyKey: string;
      requestHash: string;
      resourceType: string;
      resourceId: string;
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<api_idempotency> {
    return tx.api_idempotency.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        operation: input.operation,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        state: "IN_PROGRESS",
        locked_at: now,
        lock_expires_at: new Date(now.getTime() + 2 * 60_000),
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        expires_at: new Date(now.getTime() + 24 * 60 * 60_000),
        created_at: now,
        updated_at: now,
      },
    });
  }

  async completeIdempotency(
    idempotencyId: string,
    resourceId: string,
    resultSnapshot: Prisma.InputJsonValue,
    responseCode: number,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: { api_idempotency_id: idempotencyId, state: "IN_PROGRESS" },
      data: {
        state: "COMPLETED",
        resource_id: resourceId,
        result_snapshot: resultSnapshot,
        response_code: responseCode,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        "Unable to complete OPD course reservation idempotency claim",
      );
    }
  }

  async allocateServiceUsageNumber(
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return this.allocateDocumentNumber(
      document_key.SERVICE_USAGE,
      scope,
      now,
      tx,
    );
  }

  async allocateDocumentNumber(
    documentKey: document_key,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const format = await tx.document_format.findFirst({
      where: {
        document_key: documentKey,
        branch_id: scope.branchId,
      },
    });
    if (!format) {
      throw new Error(
        `${documentKey} document format is not configured for this branch`,
      );
    }
    const businessDate = bangkokBusinessDate(now);
    const middle = await this.documentNumberMiddle(
      format.format_type,
      scope,
      businessDate,
      tx,
    );
    const prefix = `${format.prefix}${middle}`;
    const rows = await tx.$queryRaw<AllocatedNumberRow[]>(Prisma.sql`
      INSERT INTO document_format_number (
        format_id, prefix, current_number, created_at, updated_at
      ) VALUES (
        ${format.format_id}, ${prefix}, 1, ${now}, ${now}
      )
      ON CONFLICT (format_id, prefix)
      DO UPDATE SET
        current_number = document_format_number.current_number + 1,
        updated_at = EXCLUDED.updated_at
      RETURNING current_number
    `);
    const currentNumber = rows[0]?.current_number;
    if (!Number.isInteger(currentNumber) || currentNumber < 1) {
      throw new Error(`${documentKey} document number could not be allocated`);
    }
    const id = `${prefix}${String(currentNumber).padStart(format.digit_number, "0")}`;
    if (id.length > 50) {
      throw new Error(
        `Allocated ${documentKey} document number exceeds 50 characters`,
      );
    }
    return id;
  }

  async createReservation(
    input: CreateCourseReservationInput,
    scope: RequestScope,
    now: Date,
    tx: CourseReservationCreateClient,
  ): Promise<void> {
    await tx.opd_course_reservation.create({
      data: {
        reservation_id: input.reservationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        customer_id: input.customerId,
        legacy_opd_id: input.legacyOpdId,
        status: "RESERVED",
        request_hash: input.requestHash,
        idempotency_key_hash: input.idempotencyKeyHash,
        source_encounter_version: input.sourceEncounterVersion,
        source_balance_manifest: input.sourceBalanceManifest,
        legacy_service_usage_id: input.legacyServiceUsageId,
        legacy_service_usage_branch_id: scope.branchId,
        legacy_service_usage_status_snapshot: "PENDING",
        reserved_by_user_id: scope.userId,
        reserved_at: now,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    });

    await tx.opd_course_reservation_item.createMany({
      data: input.items.map((item) => ({
        reservation_item_id: item.reservationItemId,
        reservation_id: input.reservationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        display_order: item.displayOrder,
        legacy_service_usage_item_id: item.legacyServiceUsageItemId,
        legacy_usage_log_id: item.legacyUsageLogId,
        purchase_branch_id: item.purchaseBranchId,
        customer_id: item.customerId,
        sale_order_id: item.saleOrderId,
        course_id: item.courseId,
        course_item_id: item.courseItemId,
        course_code_snapshot: item.courseCode,
        course_name_snapshot: item.courseName,
        item_name_snapshot: item.itemName,
        unit_snapshot: item.unit,
        entitlement_expire_at: item.entitlementExpireAt,
        display_expire_at: item.displayExpireAt,
        entitlement_amount: item.entitlementAmount,
        before_reserved_amount: item.beforeReservedAmount,
        before_used_amount: item.beforeUsedAmount,
        before_remaining_amount: item.beforeRemainingAmount,
        reserved_amount: item.reservedAmount,
        after_remaining_amount: item.afterRemainingAmount,
        entitlement_created_at: item.entitlementCreatedAt,
        entitlement_updated_at: item.entitlementUpdatedAt,
        sale_order_updated_at: item.saleOrderUpdatedAt,
        course_updated_at: item.courseUpdatedAt,
        course_item_updated_at: item.courseItemUpdatedAt,
        source_snapshot_hash: item.sourceSnapshotHash,
        created_at: now,
      })),
    });

    const components = input.items.flatMap((item) =>
      item.components.map((component, index) => ({
        reservation_component_id: component.reservationComponentId,
        reservation_item_id: item.reservationItemId,
        reservation_id: input.reservationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        display_order: index + 1,
        product_id: component.productId,
        product_code_snapshot: component.productCode,
        product_name_snapshot: component.productName,
        unit_snapshot: component.unit,
        configured_quantity: component.configuredQuantity,
        total_quantity: component.totalQuantity,
        lot_id: component.lotId,
        expiry_at: component.expiryAt,
        stock_observed_quantity: component.stockObservedQuantity,
        stock_observed_at: now,
        source_updated_at: component.sourceUpdatedAt,
        created_at: now,
      })),
    );
    if (components.length > 0) {
      await tx.opd_course_reservation_component.createMany({
        data: components,
      });
    }

    const operators = input.items.flatMap((item) =>
      item.operators.map((operator) => ({
        reservation_operator_id: operator.reservationOperatorId,
        reservation_item_id: item.reservationItemId,
        reservation_id: input.reservationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        user_id: operator.userId,
        role_id: operator.roleId,
        operator_type: operator.operatorType,
        commission_amount: operator.commissionAmount,
        commission_unit: operator.commissionUnit,
        source_user_updated_at: operator.sourceUserUpdatedAt,
        created_at: now,
      })),
    );
    if (operators.length > 0) {
      await tx.opd_course_reservation_operator.createMany({ data: operators });
    }

    await tx.service_usage.create({
      data: {
        service_usage_id: input.legacyServiceUsageId,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_owner_id: input.customerId,
        customer_id: input.customerId,
        remark: "OPD V2 existing-course reservation",
        extra_remark: null,
        status: record_status.ACTIVE,
        service_usage_status: service_usage_status.PENDING,
        date: now,
        created_by: scope.userId,
        updated_by: scope.userId,
        verify_at: null,
        verify_by: null,
        document_url: null,
        created_at: now,
        updated_at: now,
      },
    });
    await tx.service_usage_item.createMany({
      data: input.items.map((item) => ({
        service_usage_item_id: item.legacyServiceUsageItemId,
        service_usage_id: input.legacyServiceUsageId,
        branch_id: scope.branchId,
        course_id: item.courseItemId,
        item_id: null,
        item_name: item.itemName,
        quantity: item.reservedAmount,
        remark: null,
        expire_date: item.entitlementExpireAt,
        lot_id: null,
        created_at: now,
        updated_at: now,
      })),
    });
    if (components.length > 0) {
      await tx.service_usage_item_product.createMany({
        data: input.items.flatMap((item) =>
          item.components.map((component) => ({
            service_usage_item_id: item.legacyServiceUsageItemId,
            service_usage_id: input.legacyServiceUsageId,
            branch_id: scope.branchId,
            item_id: component.productId,
            quantity: component.totalQuantity,
            lot_id: component.lotId,
          })),
        ),
      });
    }
    const uniqueOperatorUsers = new Map<
      string,
      { userId: string; operatorType: operator_type }
    >();
    for (const item of input.items) {
      for (const operator of item.operators) {
        uniqueOperatorUsers.set(`${operator.userId}|${operator.operatorType}`, {
          userId: operator.userId,
          operatorType: operator.operatorType,
        });
      }
    }
    if (uniqueOperatorUsers.size > 0) {
      await tx.course_operator_user.createMany({
        data: [...uniqueOperatorUsers.values()].map((operator) => ({
          service_usage_id: input.legacyServiceUsageId,
          branch_id: scope.branchId,
          user_id: operator.userId,
          operator_type: operator.operatorType,
        })),
      });
      await tx.service_usage_item_commission.createMany({
        data: input.items.flatMap((item) =>
          item.operators.map((operator) => ({
            service_usage_item_id: item.legacyServiceUsageItemId,
            service_usage_id: input.legacyServiceUsageId,
            branch_id: scope.branchId,
            commission: operator.commissionAmount,
            unit: operator.commissionUnit,
            role: operator.roleId,
            operator_type: operator.operatorType,
          })),
        ),
      });
    }
    await tx.customer_course_usage_log.createMany({
      data: input.items.map((item) => ({
        id: item.legacyUsageLogId,
        service_usage_id: input.legacyServiceUsageId,
        customer_id: input.customerId,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        item_id: item.courseItemId,
        amount: item.reservedAmount,
        status: usage_log_status.RESERVED,
        expire_date: item.entitlementExpireAt,
        course_usage_type: course_usage_type.SERVICE_USAGE,
        created_at: now,
        updated_at: now,
      })),
    });

    const linked = await tx.opd.updateMany({
      where: {
        opd_id: input.legacyOpdId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.customerId,
        management_item: null,
      },
      data: { management_item: input.legacyServiceUsageId, updated_at: now },
    });
    if (linked.count !== 1) {
      throw new Error(
        "Legacy OPD course-reservation link changed concurrently",
      );
    }
  }

  async loadLegacyState(
    record: OpdCourseReservationRecord,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<LegacyCourseReservationState> {
    const [serviceUsage, usageLogs, legacyOpd, inventoryMovementCount] =
      await Promise.all([
        client.service_usage.findFirst({
          where: {
            service_usage_id: record.legacy_service_usage_id,
            branch_id: scope.branchId,
            clinic_id: scope.clinicId,
          },
          include: {
            service_usage_item: {
              include: {
                service_usage_item_product: true,
                service_usage_item_commission: true,
              },
            },
            course_operator_user: true,
            service_usage_request_cancel: true,
          },
        }),
        client.customer_course_usage_log.findMany({
          where: {
            service_usage_id: record.legacy_service_usage_id,
            branch_id: scope.branchId,
            clinic_id: scope.clinicId,
          },
          select: {
            id: true,
            service_usage_id: true,
            customer_id: true,
            branch_id: true,
            clinic_id: true,
            item_id: true,
            amount: true,
            status: true,
            expire_date: true,
            course_usage_type: true,
          },
        }),
        client.opd.findFirst({
          where: {
            opd_id: record.legacy_opd_id,
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
            customer_id: record.customer_id,
          },
        }),
        client.inventory_log.count({
          where: {
            document_id: record.legacy_service_usage_id,
            branch_id: scope.branchId,
          },
        }),
      ]);
    return { serviceUsage, usageLogs, legacyOpd, inventoryMovementCount };
  }

  async lockLegacyState(
    record: OpdCourseReservationRecord,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT service_usage_id AS id
      FROM service_usage
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
        AND clinic_id = ${scope.clinicId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT id
      FROM customer_course_usage_log
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
        AND clinic_id = ${scope.clinicId}
      ORDER BY id
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT opd_id AS id
      FROM opd
      WHERE opd_id = ${record.legacy_opd_id}
        AND branch_id = ${scope.branchId}
        AND clinic_id = ${scope.clinicId}
      FOR UPDATE
    `);
  }

  async voidReservation(
    record: OpdCourseReservationRecord,
    expectedVersion: number,
    reason: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const root = await tx.opd_course_reservation.updateMany({
      where: {
        reservation_id: record.reservation_id,
        encounter_id: record.encounter_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "RESERVED",
        version: expectedVersion,
      },
      data: {
        status: "VOIDED",
        version: { increment: 1 },
        voided_by_user_id: scope.userId,
        voided_at: now,
        void_reason: reason,
        updated_at: now,
      },
    });
    if (root.count !== 1)
      throw new Error("Course reservation changed concurrently");

    const serviceUsage = await tx.service_usage.updateMany({
      where: {
        service_usage_id: record.legacy_service_usage_id,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: record.customer_id,
        customer_owner_id: record.customer_id,
        status: record_status.ACTIVE,
        service_usage_status: service_usage_status.PENDING,
        verify_at: null,
        verify_by: null,
        document_url: null,
      },
      data: {
        status: record_status.DELETED,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (serviceUsage.count !== 1) {
      throw new Error("Legacy service usage changed concurrently");
    }

    const logIds = record.items.map((item) => item.legacy_usage_log_id);
    const deletedLogs = await tx.customer_course_usage_log.deleteMany({
      where: {
        id: { in: logIds },
        service_usage_id: record.legacy_service_usage_id,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: record.customer_id,
        status: usage_log_status.RESERVED,
      },
    });
    if (deletedLogs.count !== logIds.length) {
      throw new Error("Legacy RESERVED usage logs changed concurrently");
    }

    const unlinked = await tx.opd.updateMany({
      where: {
        opd_id: record.legacy_opd_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: record.customer_id,
        management_item: record.legacy_service_usage_id,
      },
      data: { management_item: null, updated_at: now },
    });
    if (unlinked.count !== 1) {
      throw new Error("Legacy OPD reservation link changed concurrently");
    }
  }

  private async documentNumberMiddle(
    formatType: format_type,
    scope: RequestScope,
    businessDate: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    switch (formatType) {
      case format_type.CONTINUOUS:
        return "";
      case format_type.MONTH_YEAR:
        return `${businessDate.slice(2, 4)}${businessDate.slice(5, 7)}-`;
      case format_type.YEAR:
        return `${businessDate.slice(0, 4)}-`;
      case format_type.BRANCH_NO: {
        const branch = await tx.branch.findFirst({
          where: { branch_id: scope.branchId, clinic_id: scope.clinicId },
          select: { branch_no: true },
        });
        if (!branch) throw new Error("Service-usage branch is unavailable");
        return `${String(branch.branch_no ?? "")
          .trim()
          .toUpperCase()
          .padStart(2, "0")}-`;
      }
    }
  }
}

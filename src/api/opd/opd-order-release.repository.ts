import { Injectable } from "@nestjs/common";
import {
  Prisma,
  document_key,
  format_type,
  record_status,
  sale_order_status,
  statusPrescription,
  type api_idempotency,
  type opd,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { bangkokBusinessDate } from "../../common/business-date";
import { PrismaService } from "../../prisma.service";
import type {
  OpdOrderReleaseRecord,
  OpdReleaseBlocker,
} from "./opd-order-release.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

interface OpdReleaseCreateClient {
  opd_order_release: {
    create(args: {
      data: Prisma.opd_order_releaseUncheckedCreateInput;
    }): PromiseLike<{ release_id: string }>;
  };
  opd_order_release_item: {
    createMany(args: {
      data: Prisma.opd_order_release_itemCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  sale_order: {
    create(args: {
      data: Prisma.sale_orderUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
  sale_order_item: {
    createMany(args: {
      data: Prisma.sale_order_itemCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  prescription: {
    create(args: {
      data: Prisma.prescriptionUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
  prescription_item: {
    createMany(args: {
      data: Prisma.prescription_itemCreateManyInput[];
    }): PromiseLike<unknown>;
  };
  opd_order_prescription_link: {
    create(args: {
      data: Prisma.opd_order_prescription_linkUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
  opd_order_sale_link: {
    create(args: {
      data: Prisma.opd_order_sale_linkUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
}

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
}

export interface OpdReleaseLotRecord {
  lotId: string;
  inStock: Prisma.Decimal;
  expiryCount: number;
  expiryAt: Date | null;
}

export interface OpdReleasePreparedLine {
  orderItemId: string;
  legacyPrescriptionItemId: string;
  legacySaleOrderItemId: string;
  displayOrder: number;
  sourceId: string;
  sourceCode: string;
  category: "MEDICINE" | "DRUG";
  name: string;
  unit: string;
  quantity: Prisma.Decimal;
  baseUnitPrice: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  pricingSource: "BASE" | "PROMOTION";
  grossAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  orderItemNote: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  timing: string | null;
  durationValue: Prisma.Decimal | null;
  durationUnit: string | null;
  sigText: string;
  medicationNote: string | null;
  lotId: string;
  expiryAt: Date;
  stockObservedQuantity: Prisma.Decimal;
}

export interface CreateOpdReleaseInput {
  encounterId: string;
  orderId: string;
  legacyOpdId: string;
  customerId: string;
  prescriptionId: string;
  saleOrderId: string;
  requestHash: string;
  idempotencyKeyHash: string;
  sourceOrderVersion: number;
  itemVersionManifest: Prisma.InputJsonValue;
  subtotalAmount: Prisma.Decimal;
  promotionDiscountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  netTotalAmount: Prisma.Decimal;
  pricingPolicy: string;
  taxPolicy: string;
  safetySource: string;
  safetySnapshotHash: string;
  prescriberUserId: string;
  lines: OpdReleasePreparedLine[];
}

export interface DownstreamProgression {
  prescriptionStatus: string | null;
  saleOrderStatus: string | null;
  saleRecordStatus: string | null;
  receiptCount: number;
  inventoryMovementCount: number;
  customerCourseCount: number;
  saleDocumentCount: number;
  saleUserCount: number;
}

export interface OpdReleaseReconciliationResult {
  status: "RECONCILED" | "MISMATCH";
  issues: string[];
}

@Injectable()
export class OpdOrderReleaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockActiveItems(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "order_item_id"::TEXT AS id
      FROM "opd_order_item"
      WHERE "order_id" = ${orderId}::UUID
        AND "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
        AND "status" = 'ACTIVE'
      ORDER BY "display_order"
      FOR UPDATE
    `);
    return rows.map((row) => row.id);
  }

  async lockSourceProducts(
    sourceIds: string[],
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    if (sourceIds.length === 0) return 0;
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT product.product_id::TEXT AS id
      FROM product
      INNER JOIN branch ON branch.branch_id = product.branch_id
      WHERE product.product_id IN (${Prisma.join(sourceIds)})
        AND branch.clinic_id = ${scope.clinicId}
        AND (product.branch_id = ${scope.branchId} OR product.is_global = TRUE)
      FOR SHARE OF product
    `);
    return rows.length;
  }

  async findLots(
    sourceId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdReleaseLotRecord[]> {
    const rows = await client.$queryRaw<LotQueryRow[]>(Prisma.sql`
      SELECT
        inventory.lot_id,
        inventory.in_stock,
        COUNT(DISTINCT receive_order_item.expire_date)::BIGINT AS expiry_count,
        MIN(receive_order_item.expire_date) AS expiry_at
      FROM inventory
      LEFT JOIN receive_order_item
        ON receive_order_item.branch_id = inventory.branch_id
       AND receive_order_item.item_id = inventory.item_id
       AND receive_order_item.lot_id = inventory.lot_id
      WHERE inventory.branch_id = ${scope.branchId}
        AND inventory.item_id = ${sourceId}
      GROUP BY inventory.lot_id, inventory.in_stock
      ORDER BY inventory.lot_id
    `);
    return rows.map((row) => ({
      lotId: row.lot_id,
      inStock: row.in_stock ?? new Prisma.Decimal(0),
      expiryCount: Number(row.expiry_count),
      expiryAt: row.expiry_at,
    }));
  }

  findAllergyText(
    customerId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<{ allergy: string | null } | null> {
    return client.customer_info.findUnique({
      where: {
        customer_id_clinic_id: {
          customer_id: customerId,
          clinic_id: scope.clinicId,
        },
      },
      select: { allergy: true },
    });
  }

  findLegacyOpd(
    legacyOpdId: string,
    customerId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd | null> {
    return client.opd.findFirst({
      where: {
        opd_id: legacyOpdId,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: customerId,
      },
    });
  }

  async isValidAttendingDoctor(
    attendingUserId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<boolean> {
    const count = await client.user.count({
      where: {
        user_id: attendingUserId,
        clinic_id: scope.clinicId,
        status: record_status.ACTIVE,
        user_branch: {
          some: {
            branch_id: scope.branchId,
            role_id: "DOCTOR",
            status: record_status.ACTIVE,
          },
        },
      },
    });
    return count === 1;
  }

  async hasExistingLegacyPrescription(
    legacyOpdId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<boolean> {
    const count = await client.prescription.count({
      where: {
        opd_id: legacyOpdId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
    return count > 0;
  }

  findReleaseByOrder(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdOrderReleaseRecord | null> {
    return client.opd_order_release.findFirst({
      where: {
        encounter_id: encounterId,
        order_id: orderId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: {
        order: true,
        items: { orderBy: { display_order: "asc" } },
        prescription_link: true,
        sale_link: true,
      },
    });
  }

  async lockRelease(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "release_id"::TEXT AS id
      FROM "opd_order_release"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "order_id" = ${orderId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
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
      where: {
        api_idempotency_id: idempotencyId,
        state: "IN_PROGRESS",
      },
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
      throw new Error("Unable to complete OPD order release idempotency claim");
    }
  }

  async allocateSaleOrderNumber(
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const format = await tx.document_format.findFirst({
      where: {
        document_key: document_key.SALE_ORDER,
        branch_id: scope.branchId,
      },
    });
    if (!format) {
      throw new Error(
        "Sale-order document format is not configured for this branch",
      );
    }

    const date = bangkokBusinessDate(now);
    const middle = await this.documentNumberMiddle(
      format.format_type,
      scope,
      date,
      tx,
    );
    const prefix = `${format.prefix}${middle}`;
    const rows = await tx.$queryRaw<AllocatedNumberRow[]>(Prisma.sql`
      INSERT INTO document_format_number (
        format_id,
        prefix,
        current_number,
        created_at,
        updated_at
      ) VALUES (
        ${format.format_id},
        ${prefix},
        1,
        ${now},
        ${now}
      )
      ON CONFLICT (format_id, prefix)
      DO UPDATE SET
        current_number = document_format_number.current_number + 1,
        updated_at = EXCLUDED.updated_at
      RETURNING current_number
    `);
    const currentNumber = rows[0]?.current_number;
    if (!Number.isInteger(currentNumber) || currentNumber < 1) {
      throw new Error("Sale-order document number could not be allocated");
    }
    const saleOrderId = `${prefix}${String(currentNumber).padStart(
      format.digit_number,
      "0",
    )}`;
    if (saleOrderId.length > 50) {
      throw new Error(
        "Allocated sale-order document number exceeds 50 characters",
      );
    }
    return saleOrderId;
  }

  async createRelease(
    input: CreateOpdReleaseInput,
    scope: RequestScope,
    now: Date,
    tx: OpdReleaseCreateClient,
  ): Promise<string> {
    const release = await tx.opd_order_release.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        order_id: input.orderId,
        request_hash: input.requestHash,
        idempotency_key_hash: input.idempotencyKeyHash,
        source_order_version: input.sourceOrderVersion,
        result_order_version: input.sourceOrderVersion + 1,
        item_version_manifest: input.itemVersionManifest,
        currency: "THB",
        subtotal_amount: input.subtotalAmount,
        promotion_discount_amount: input.promotionDiscountAmount,
        tax_amount: input.taxAmount,
        net_total_amount: input.netTotalAmount,
        pricing_policy: input.pricingPolicy,
        tax_policy: input.taxPolicy,
        safety_source: input.safetySource,
        safety_snapshot_hash: input.safetySnapshotHash,
        safety_acknowledged_by: scope.userId,
        safety_acknowledged_at: now,
        prescriber_user_id: input.prescriberUserId,
        released_by: scope.userId,
        released_at: now,
        created_at: now,
      },
    });

    await tx.opd_order_release_item.createMany({
      data: input.lines.map((line) => ({
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        order_id: input.orderId,
        release_id: release.release_id,
        order_item_id: line.orderItemId,
        legacy_prescription_item_id: line.legacyPrescriptionItemId,
        legacy_sale_order_item_id: line.legacySaleOrderItemId,
        display_order: line.displayOrder,
        source_type: "PRODUCT",
        source_id: line.sourceId,
        source_code: line.sourceCode,
        category: line.category,
        name_snapshot: line.name,
        unit_snapshot: line.unit,
        quantity: line.quantity,
        base_unit_price_amount: line.baseUnitPrice,
        unit_price_amount: line.unitPrice,
        pricing_source: line.pricingSource,
        gross_amount: line.grossAmount,
        discount_amount: line.discountAmount,
        tax_type: "NO_VAT",
        tax_amount: line.taxAmount,
        net_amount: line.netAmount,
        order_item_note: line.orderItemNote,
        dose: line.dose,
        route: line.route,
        frequency: line.frequency,
        timing: line.timing,
        duration_value: line.durationValue,
        duration_unit: line.durationUnit,
        sig_text: line.sigText,
        medication_note: line.medicationNote,
        lot_id: line.lotId,
        expiry_at: line.expiryAt,
        stock_observed_quantity: line.stockObservedQuantity,
        stock_observed_at: now,
        created_at: now,
      })),
    });

    await tx.sale_order.create({
      data: {
        sale_order_id: input.saleOrderId,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: input.customerId,
        adviser: null,
        percent_commision: 0,
        voucher_id: null,
        total: input.subtotalAmount,
        promotion_discount: input.promotionDiscountAmount,
        customer_discount: 0,
        voucher_discount: 0,
        extra_discount: 0,
        subtotal: input.netTotalAmount,
        round_decimal: false,
        totalDue: input.netTotalAmount,
        remark: null,
        extra_remark: null,
        sale_order_status: sale_order_status.PENDING,
        status: record_status.ACTIVE,
        date: now,
        created_by: scope.userId,
        updated_by: scope.userId,
        updated_at: now,
        created_at: now,
      },
    });
    await tx.sale_order_item.createMany({
      data: input.lines.map((line) => ({
        sale_order_item_id: line.legacySaleOrderItemId,
        sale_order_id: input.saleOrderId,
        branch_id: scope.branchId,
        item_id: line.sourceId,
        course_item_id: null,
        bundle_set_id: null,
        item_name: line.name,
        is_free: false,
        price_per_unit: line.baseUnitPrice,
        quantity: line.quantity,
        discount: line.baseUnitPrice.sub(line.unitPrice),
        total: line.netAmount,
        net: line.unitPrice,
        updated_at: now,
        created_at: now,
        lot_id: line.lotId,
        promotion_price:
          line.pricingSource === "PROMOTION" ? line.unitPrice : 0,
        amount_per_course: null,
      })),
    });

    await tx.prescription.create({
      data: {
        prescribe_id: input.prescriptionId,
        customer_id: input.customerId,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        opd_id: input.legacyOpdId,
        sale_order_id: input.saleOrderId,
        status: statusPrescription.WAITING,
        user_create: input.prescriberUserId,
        updated_at: now,
        created_at: now,
      },
    });
    await tx.prescription_item.createMany({
      data: input.lines.map((line) => ({
        prescribe_id: input.prescriptionId,
        drug_id: line.sourceId,
        drug_name: line.name,
        price: line.baseUnitPrice,
        detail: line.sigText,
        qty: line.quantity,
        total_price: line.netAmount,
        created_at: now,
        date_exp: line.expiryAt,
        lot_id: line.lotId,
        id: line.legacyPrescriptionItemId,
        is_free: false,
      })),
    });

    await tx.opd_order_prescription_link.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        order_id: input.orderId,
        release_id: release.release_id,
        legacy_prescribe_id: input.prescriptionId,
        legacy_opd_id: input.legacyOpdId,
        customer_id: input.customerId,
        prescription_status_snapshot: "WAITING",
        created_at: now,
      },
    });
    await tx.opd_order_sale_link.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        order_id: input.orderId,
        release_id: release.release_id,
        legacy_sale_order_id: input.saleOrderId,
        customer_id: input.customerId,
        sale_order_status_snapshot: "PENDING",
        created_at: now,
      },
    });
    return release.release_id;
  }

  async markOrderReleased(
    input: CreateOpdReleaseInput,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const updated = await tx.opd_order.updateMany({
      where: {
        order_id: input.orderId,
        encounter_id: input.encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
        version: input.sourceOrderVersion,
      },
      data: {
        status: "RELEASED",
        subtotal_amount: input.subtotalAmount,
        discount_total_amount: input.promotionDiscountAmount,
        tax_total_amount: input.taxAmount,
        net_total_amount: input.netTotalAmount,
        version: { increment: 1 },
        released_by: scope.userId,
        released_at: now,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return updated.count === 1;
  }

  async lockLegacyDownstream(
    prescriptionId: string,
    saleOrderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const prescriptions = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT prescribe_id::TEXT AS id
      FROM prescription
      WHERE prescribe_id = ${prescriptionId}
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
      FOR UPDATE
    `);
    const saleOrders = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT sale_order_id::TEXT AS id
      FROM sale_order
      WHERE sale_order_id = ${saleOrderId}
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
      FOR UPDATE
    `);
    if (prescriptions.length !== 1 || saleOrders.length !== 1) {
      throw new Error(
        "Released OPD downstream rows are missing or out of scope",
      );
    }
  }

  async downstreamProgression(
    prescriptionId: string,
    saleOrderId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<DownstreamProgression> {
    const [
      prescription,
      saleOrder,
      receiptCount,
      inventoryMovementCount,
      customerCourseCount,
      saleDocumentCount,
      saleUserCount,
    ] = await Promise.all([
      client.prescription.findFirst({
        where: {
          prescribe_id: prescriptionId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
        select: { status: true },
      }),
      client.sale_order.findFirst({
        where: {
          sale_order_id: saleOrderId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
        select: { sale_order_status: true, status: true },
      }),
      client.receipt.count({
        where: { sale_order_id: saleOrderId, branch_id: scope.branchId },
      }),
      client.inventory_log.count({
        where: { document_id: saleOrderId, branch_id: scope.branchId },
      }),
      client.customer_coures.count({
        where: {
          sale_order_id: saleOrderId,
          branch_id: scope.branchId,
          clinic_id: scope.clinicId,
        },
      }),
      client.sale_order_document_signed.count({
        where: { sale_order_id: saleOrderId, branch_id: scope.branchId },
      }),
      client.sale_user.count({
        where: { sale_order_id: saleOrderId, branch_id: scope.branchId },
      }),
    ]);
    return {
      prescriptionStatus: prescription?.status ?? null,
      saleOrderStatus: saleOrder?.sale_order_status ?? null,
      saleRecordStatus: saleOrder?.status ?? null,
      receiptCount,
      inventoryMovementCount,
      customerCourseCount,
      saleDocumentCount,
      saleUserCount,
    };
  }

  async voidDownstreamAndOrder(
    input: {
      encounterId: string;
      orderId: string;
      prescriptionId: string;
      saleOrderId: string;
      expectedOrderVersion: number;
      reason: string;
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prescription = await tx.prescription.updateMany({
      where: {
        prescribe_id: input.prescriptionId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: statusPrescription.WAITING,
      },
      data: { status: statusPrescription.CANCEL, updated_at: now },
    });
    const saleOrder = await tx.sale_order.updateMany({
      where: {
        sale_order_id: input.saleOrderId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        sale_order_status: sale_order_status.PENDING,
        status: record_status.ACTIVE,
      },
      data: {
        sale_order_status: sale_order_status.DELETED,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    const order = await tx.opd_order.updateMany({
      where: {
        order_id: input.orderId,
        encounter_id: input.encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "RELEASED",
        version: input.expectedOrderVersion,
      },
      data: {
        status: "VOIDED",
        version: { increment: 1 },
        voided_by: scope.userId,
        voided_at: now,
        void_reason: input.reason,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return (
      prescription.count === 1 && saleOrder.count === 1 && order.count === 1
    );
  }

  async reconcileRelease(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdReleaseReconciliationResult> {
    const release = await this.findReleaseByOrder(
      encounterId,
      orderId,
      scope,
      client,
    );
    if (!release) {
      return { status: "MISMATCH", issues: ["MISSING_RELEASE"] };
    }
    const issues: string[] = [];
    if (!release.prescription_link) issues.push("MISSING_PRESCRIPTION_LINK");
    if (!release.sale_link) issues.push("MISSING_SALE_LINK");
    if (release.items.length === 0) issues.push("MISSING_RELEASE_ITEMS");
    if (
      release.order.status !== "RELEASED" &&
      release.order.status !== "VOIDED"
    ) {
      issues.push("ORDER_STATUS_MISMATCH");
    }
    if (!release.prescription_link || !release.sale_link) {
      return { status: "MISMATCH", issues };
    }

    const [prescription, prescriptionItems, saleOrder, saleItems] =
      await Promise.all([
        client.prescription.findFirst({
          where: {
            prescribe_id: release.prescription_link.legacy_prescribe_id,
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
            opd_id: release.prescription_link.legacy_opd_id,
          },
        }),
        client.prescription_item.findMany({
          where: {
            prescribe_id: release.prescription_link.legacy_prescribe_id,
          },
        }),
        client.sale_order.findFirst({
          where: {
            sale_order_id: release.sale_link.legacy_sale_order_id,
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
          },
        }),
        client.sale_order_item.findMany({
          where: {
            sale_order_id: release.sale_link.legacy_sale_order_id,
            branch_id: scope.branchId,
          },
        }),
      ]);
    if (!prescription) issues.push("MISSING_PRESCRIPTION");
    if (!saleOrder) issues.push("MISSING_SALE_ORDER");
    if (prescriptionItems.length !== release.items.length) {
      issues.push("PRESCRIPTION_ITEM_COUNT_MISMATCH");
    }
    if (saleItems.length !== release.items.length) {
      issues.push("SALE_ITEM_COUNT_MISMATCH");
    }
    if (
      saleOrder &&
      (!saleOrder.total?.equals(release.subtotal_amount) ||
        !saleOrder.promotion_discount.equals(
          release.promotion_discount_amount,
        ) ||
        !saleOrder.totalDue.equals(release.net_total_amount))
    ) {
      issues.push("SALE_TOTAL_MISMATCH");
    }
    for (const item of release.items) {
      const prescriptionItem = prescriptionItems.find(
        (candidate) => candidate.id === item.legacy_prescription_item_id,
      );
      const saleItem = saleItems.find(
        (candidate) =>
          candidate.sale_order_item_id === item.legacy_sale_order_item_id,
      );
      if (
        !prescriptionItem ||
        !prescriptionItem.qty.equals(item.quantity) ||
        !prescriptionItem.total_price.equals(item.net_amount) ||
        prescriptionItem.lot_id !== item.lot_id ||
        prescriptionItem.date_exp?.getTime() !== item.expiry_at.getTime()
      ) {
        issues.push(`PRESCRIPTION_ITEM_MISMATCH:${item.order_item_id}`);
      }
      if (
        !saleItem ||
        !saleItem.quantity.equals(item.quantity) ||
        !saleItem.total.equals(item.net_amount) ||
        saleItem.lot_id !== item.lot_id
      ) {
        issues.push(`SALE_ITEM_MISMATCH:${item.order_item_id}`);
      }
    }
    return {
      status: issues.length === 0 ? "RECONCILED" : "MISMATCH",
      issues,
    };
  }

  releaseBlockerSummary(blockers: OpdReleaseBlocker[]): Prisma.InputJsonValue {
    return blockers.map((blocker) => ({
      code: blocker.code,
      orderItemId: blocker.orderItemId,
    }));
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
        if (!branch) throw new Error("Sale-order branch is unavailable");
        return `${String(branch.branch_no ?? "")
          .trim()
          .toUpperCase()
          .padStart(2, "0")}-`;
      }
    }
  }
}

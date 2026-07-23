import { Injectable } from "@nestjs/common";
import {
  Prisma,
  approved_status,
  inventory_log_type,
  record_status,
  service_usage_status,
  usage_log_status,
  type api_idempotency,
  type customer_file,
  type inventory_log,
  type opd_course_compensation_request,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import type { OpdCourseReservationRecord } from "./opd-course-reservation.mapper";
import type { OpdCourseVerificationRecord } from "./opd-course-verification.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

interface LockedIdRow {
  id: string;
}

interface InventorySnapshotRow {
  item_id: string;
  lot_id: string;
  in_stock: Prisma.Decimal | null;
  total_stock: Prisma.Decimal | null;
  expiry_count: bigint;
  expiry_at: Date | null;
  inventory_updated_at: Date | null;
}

export interface CourseVerificationInventorySnapshot {
  productId: string;
  lotId: string;
  inStock: Prisma.Decimal;
  totalStock: Prisma.Decimal;
  expiryCount: number;
  expiryAt: Date | null;
  inventoryUpdatedAt: Date | null;
}

export interface CourseVerificationDisplayContext {
  clinicName: string;
  branchName: string;
  customerDisplayName: string;
  operatorDisplayNames: Map<string, string>;
}

export interface StoredCourseVerificationEvidence {
  signatureFileId: string;
  signatureOriginalName: string;
  signatureBytes: number;
  signatureHash: string;
  signatureStorageProvider: string;
  signatureBucketName: string;
  signatureObjectKey: string;
  pdfFileId: string;
  pdfOriginalName: string;
  pdfBytes: number;
  pdfHash: string;
  pdfStorageProvider: string;
  pdfBucketName: string;
  pdfObjectKey: string;
}

export interface CourseVerificationComponentEffect {
  verificationComponentId: string;
  reservationComponentId: string;
  productId: string;
  originalLotId: string;
  actualLotId: string;
  replacementReason: string | null;
  expiryAt: Date;
  quantity: Prisma.Decimal;
  beforeLotStock: Prisma.Decimal;
  afterLotStock: Prisma.Decimal;
  beforeTotalStock: Prisma.Decimal;
  afterTotalStock: Prisma.Decimal;
  inventoryLogId: string;
  inventorySourceUpdatedAt: Date | null;
  snapshotHash: string;
}

export interface CreateCourseVerificationInput {
  verificationId: string;
  record: OpdCourseReservationRecord;
  sourceReservationVersion: number;
  resultReservationVersion: number;
  verificationManifest: Prisma.InputJsonObject;
  manifestHash: string;
  acknowledgementVersion: string;
  acknowledgementLocale: "th-TH" | "en-US";
  acknowledgementHash: string;
  requestHash: string;
  idempotencyKeyHash: string;
  verifiedAt: Date;
  legacyDocumentUrl: string;
  clientIp: string | null;
  userAgentHash: string | null;
  evidence: StoredCourseVerificationEvidence;
  components: CourseVerificationComponentEffect[];
}

export interface CourseCompensationComponentEffect {
  compensationComponentId: string;
  verificationComponentId: string;
  productId: string;
  lotId: string;
  quantity: Prisma.Decimal;
  originalInventoryLogId: string;
  inverseInventoryLogId: string;
  beforeLotStock: Prisma.Decimal;
  afterLotStock: Prisma.Decimal;
  beforeTotalStock: Prisma.Decimal;
  afterTotalStock: Prisma.Decimal;
  snapshotHash: string;
}

const verificationInclude = {
  components: true,
  compensation_requests: {
    include: { components: true },
    orderBy: { requested_at: "desc" as const },
  },
} satisfies Prisma.opd_course_verificationInclude;

@Injectable()
export class OpdCourseVerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findVerification(
    reservationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdCourseVerificationRecord | null> {
    return client.opd_course_verification.findFirst({
      where: {
        reservation_id: reservationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: verificationInclude,
    });
  }

  findCompensationRequest(
    requestId: string,
    verificationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<Prisma.opd_course_compensation_requestGetPayload<{
    include: { components: true };
  }> | null> {
    return client.opd_course_compensation_request.findFirst({
      where: {
        compensation_request_id: requestId,
        verification_id: verificationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { components: true },
    });
  }

  findCompensationRequestById(
    requestId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<Prisma.opd_course_compensation_requestGetPayload<{
    include: { components: true };
  }> | null> {
    return client.opd_course_compensation_request.findFirst({
      where: {
        compensation_request_id: requestId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { components: true },
    });
  }

  findInventoryLog(
    inventoryLogId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<inventory_log | null> {
    return client.inventory_log.findFirst({
      where: {
        inventory_log_id: inventoryLogId,
        branch_id: scope.branchId,
      },
    });
  }

  async displayContext(
    record: OpdCourseReservationRecord,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<CourseVerificationDisplayContext> {
    const operatorIds = [
      ...new Set(
        record.items.flatMap((item) =>
          item.operators.map((operator) => operator.user_id),
        ),
      ),
    ];
    const [clinic, branch, customer, operators] = await Promise.all([
      client.clinic.findFirst({
        where: { clinic_id: scope.clinicId },
        select: { clinic_name: true },
      }),
      client.branch.findFirst({
        where: { branch_id: scope.branchId, clinic_id: scope.clinicId },
        select: { branch_name: true },
      }),
      client.customer.findFirst({
        where: {
          customer_id: record.customer_id,
          clinic_id: scope.clinicId,
        },
        select: { title: true, name: true, lastname: true, nickname: true },
      }),
      operatorIds.length === 0
        ? Promise.resolve([])
        : client.user.findMany({
            where: {
              user_id: { in: operatorIds },
              clinic_id: scope.clinicId,
            },
            select: {
              user_id: true,
              name: true,
              lastname: true,
              nickname: true,
            },
          }),
    ]);
    const customerDisplayName = customer
      ? [customer.title, customer.name, customer.lastname]
          .filter((part) => part.trim())
          .join(" ")
      : "Customer";
    return {
      clinicName: clinic?.clinic_name?.trim() || "HealthX clinic",
      branchName: branch?.branch_name.trim() || "HealthX branch",
      customerDisplayName,
      operatorDisplayNames: new Map(
        operators.map((operator) => [
          operator.user_id,
          [operator.name, operator.lastname]
            .filter((part): part is string => Boolean(part?.trim()))
            .join(" ") ||
            operator.nickname?.trim() ||
            "Assigned staff",
        ]),
      ),
    };
  }

  async inventoryLots(
    productId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<CourseVerificationInventorySnapshot[]> {
    const rows = await client.$queryRaw<InventorySnapshotRow[]>(Prisma.sql`
      SELECT
        inventory.item_id,
        inventory.lot_id,
        inventory.in_stock,
        totals.total_stock,
        COUNT(DISTINCT receive_order_item.expire_date)::BIGINT AS expiry_count,
        MIN(receive_order_item.expire_date) AS expiry_at,
        inventory.updated_at AS inventory_updated_at
      FROM inventory
      INNER JOIN (
        SELECT
          branch_id,
          item_id,
          COALESCE(SUM(in_stock), 0::DECIMAL) AS total_stock
        FROM inventory
        WHERE branch_id = ${scope.branchId}
          AND item_id = ${productId}
        GROUP BY branch_id, item_id
      ) AS totals
        ON totals.branch_id = inventory.branch_id
       AND totals.item_id = inventory.item_id
      LEFT JOIN receive_order_item
        ON receive_order_item.branch_id = inventory.branch_id
       AND receive_order_item.item_id = inventory.item_id
       AND receive_order_item.lot_id = inventory.lot_id
      WHERE inventory.branch_id = ${scope.branchId}
        AND inventory.item_id = ${productId}
      GROUP BY
        inventory.item_id,
        inventory.lot_id,
        inventory.in_stock,
        totals.total_stock,
        inventory.updated_at
      ORDER BY inventory.item_id, inventory.lot_id
    `);
    return rows.map((row) => ({
      productId: row.item_id,
      lotId: row.lot_id,
      inStock: row.in_stock ?? new Prisma.Decimal(0),
      totalStock: row.total_stock ?? new Prisma.Decimal(0),
      expiryCount: Number(row.expiry_count),
      expiryAt: row.expiry_at,
      inventoryUpdatedAt: row.inventory_updated_at,
    }));
  }

  async lockVerificationState(
    record: OpdCourseReservationRecord,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT service_usage_item_id AS id
      FROM service_usage_item
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
      ORDER BY service_usage_item_id
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT id::TEXT AS id
      FROM service_usage_item_product
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
      ORDER BY service_usage_item_id, item_id, id
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT service_usage_item_id AS id
      FROM service_usage_item_commission
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
      ORDER BY service_usage_item_id, role, operator_type
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT user_id AS id
      FROM course_operator_user
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
      ORDER BY user_id, operator_type
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT service_usage_id AS id
      FROM service_usage_request_cancel
      WHERE service_usage_id = ${record.legacy_service_usage_id}
        AND branch_id = ${scope.branchId}
      FOR UPDATE
    `);
  }

  async lockInventory(
    keys: Array<{ productId: string; lotId: string }>,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const ordered = keys
      .slice()
      .sort((left, right) =>
        `${left.productId}|${left.lotId}`.localeCompare(
          `${right.productId}|${right.lotId}`,
        ),
      );
    if (ordered.length === 0) return 0;
    const conditions = ordered.map(
      (key) =>
        Prisma.sql`(item_id = ${key.productId} AND lot_id = ${key.lotId})`,
    );
    const inventoryRows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT item_id || '|' || lot_id AS id
      FROM inventory
      WHERE branch_id = ${scope.branchId}
        AND (${Prisma.join(conditions, " OR ")})
      ORDER BY item_id, lot_id
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT receive_order_id || '|' || item_id || '|' || lot_id AS id
      FROM receive_order_item
      WHERE branch_id = ${scope.branchId}
        AND (${Prisma.join(conditions, " OR ")})
      ORDER BY item_id, lot_id, receive_order_id
      FOR UPDATE
    `);
    return inventoryRows.length;
  }

  async lockIdempotencyClaim(
    claimId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT api_idempotency_id::TEXT AS id
      FROM api_idempotency
      WHERE api_idempotency_id = ${claimId}::UUID
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

  createVerificationClaim(
    operation: string,
    idempotencyKey: string,
    requestHash: string,
    verificationId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<api_idempotency> {
    return tx.api_idempotency.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        operation,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        state: "IN_PROGRESS",
        locked_at: now,
        lock_expires_at: new Date(now.getTime() + 5 * 60_000),
        resource_type: "OPD_COURSE_VERIFICATION",
        resource_id: verificationId,
        expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
        created_at: now,
        updated_at: now,
      },
    });
  }

  async reclaimVerificationClaim(
    claimId: string,
    requestHash: string,
    verificationId: string,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<api_idempotency | null> {
    const updated = await tx.api_idempotency.updateMany({
      where: {
        api_idempotency_id: claimId,
        request_hash: requestHash,
        OR: [
          { state: "FAILED" },
          { state: "IN_PROGRESS", lock_expires_at: { lte: now } },
        ],
      },
      data: {
        state: "IN_PROGRESS",
        locked_at: now,
        lock_expires_at: new Date(now.getTime() + 5 * 60_000),
        resource_type: "OPD_COURSE_VERIFICATION",
        resource_id: verificationId,
        result_snapshot: Prisma.DbNull,
        response_code: null,
        completed_at: null,
        updated_at: now,
      },
    });
    if (updated.count !== 1) return null;
    return tx.api_idempotency.findUnique({
      where: { api_idempotency_id: claimId },
    });
  }

  async failVerificationClaim(
    claimId: string,
    requestHash: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.api_idempotency.updateMany({
      where: {
        api_idempotency_id: claimId,
        request_hash: requestHash,
        state: "IN_PROGRESS",
      },
      data: {
        state: "FAILED",
        response_code: 500,
        completed_at: now,
        lock_expires_at: new Date(now.getTime() + 1),
        updated_at: now,
      },
    });
  }

  async completeIdempotency(
    claimId: string,
    resourceId: string,
    result: Prisma.InputJsonValue,
    responseCode: number,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: {
        api_idempotency_id: claimId,
        state: "IN_PROGRESS",
      },
      data: {
        state: "COMPLETED",
        resource_id: resourceId,
        result_snapshot: result,
        response_code: responseCode,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Unable to complete OPD course command idempotency");
    }
  }

  async findLegacyComponent(
    legacyServiceUsageId: string,
    legacyServiceUsageItemId: string,
    productId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<{
    id: number;
    lotId: string | null;
    quantity: Prisma.Decimal;
  } | null> {
    const row = await client.service_usage_item_product.findFirst({
      where: {
        service_usage_id: legacyServiceUsageId,
        service_usage_item_id: legacyServiceUsageItemId,
        branch_id: scope.branchId,
        item_id: productId,
      },
      select: { id: true, lot_id: true, quantity: true },
    });
    return row
      ? { id: row.id, lotId: row.lot_id, quantity: row.quantity }
      : null;
  }

  async changeLegacyComponentLot(
    legacyComponentId: number,
    expectedLotId: string,
    actualLotId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (expectedLotId === actualLotId) return;
    const updated = await tx.service_usage_item_product.updateMany({
      where: { id: legacyComponentId, lot_id: expectedLotId },
      data: { lot_id: actualLotId },
    });
    if (updated.count !== 1) {
      throw new Error(
        "Legacy service-usage component lot changed concurrently",
      );
    }
  }

  async deductInventory(
    productId: string,
    lotId: string,
    quantity: Prisma.Decimal,
    now: Date,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.inventory.updateMany({
      where: {
        branch_id: scope.branchId,
        item_id: productId,
        lot_id: lotId,
        in_stock: { gte: quantity },
      },
      data: {
        in_stock: { decrement: quantity },
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("COURSE_COMPONENT_STOCK_CHANGED");
    }
  }

  async restoreInventory(
    productId: string,
    lotId: string,
    quantity: Prisma.Decimal,
    now: Date,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.inventory.updateMany({
      where: {
        branch_id: scope.branchId,
        item_id: productId,
        lot_id: lotId,
      },
      data: {
        in_stock: { increment: quantity },
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
  }

  createInventoryLog(
    input: {
      inventoryLogId: string;
      documentId: string;
      productId: string;
      lotId: string;
      stockIn: Prisma.Decimal;
      stockOut: Prisma.Decimal;
      currentStock: Prisma.Decimal;
      remark: string;
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<unknown> {
    return tx.inventory_log.create({
      data: {
        inventory_log_id: input.inventoryLogId,
        branch_id: scope.branchId,
        document_id: input.documentId,
        item_id: input.productId,
        lot_id: input.lotId,
        stock_in: input.stockIn,
        stock_out: input.stockOut,
        date: now,
        type: inventory_log_type.SYSTEM,
        remark: input.remark,
        create_by: scope.userId,
        current_stock: input.currentStock,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async applyLegacyVerification(
    record: OpdCourseReservationRecord,
    expectedVersion: number,
    legacyDocumentUrl: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const item of record.items) {
      const updated = await tx.customer_course_usage_log.updateMany({
        where: {
          id: item.legacy_usage_log_id,
          service_usage_id: record.legacy_service_usage_id,
          customer_id: record.customer_id,
          branch_id: scope.branchId,
          clinic_id: scope.clinicId,
          item_id: item.course_item_id,
          amount: item.reserved_amount,
          expire_date: item.entitlement_expire_at,
          status: usage_log_status.RESERVED,
        },
        data: {
          status: usage_log_status.USED,
          updated_at: now,
        },
      });
      if (updated.count !== 1) {
        throw new Error("COURSE_USAGE_LOG_MISMATCH");
      }
    }
    const usage = await tx.service_usage.updateMany({
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
        service_usage_status: service_usage_status.APPROVED,
        verify_at: now,
        verify_by: scope.userId,
        document_url: legacyDocumentUrl,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (usage.count !== 1) {
      throw new Error("COURSE_LEGACY_STATE_MISMATCH");
    }
    const reservation = await tx.opd_course_reservation.updateMany({
      where: {
        reservation_id: record.reservation_id,
        encounter_id: record.encounter_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "RESERVED",
        version: expectedVersion,
      },
      data: {
        status: "USED",
        version: { increment: 1 },
        used_by_user_id: scope.userId,
        used_at: now,
        updated_at: now,
      },
    });
    if (reservation.count !== 1) {
      throw new Error("COURSE_RESERVATION_VERSION_CONFLICT");
    }
  }

  async createVerification(
    input: CreateCourseVerificationInput,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const now = input.verifiedAt;
    const files: Prisma.customer_fileCreateManyInput[] = [
      {
        file_id: input.evidence.signatureFileId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.record.customer_id,
        display_name: "Course verification customer signature",
        original_name: input.evidence.signatureOriginalName,
        mime_type: "image/png",
        file_size: input.evidence.signatureBytes,
        storage_provider: input.evidence.signatureStorageProvider,
        bucket_name: input.evidence.signatureBucketName,
        object_key: input.evidence.signatureObjectKey,
        public_url: null,
        status: record_status.ACTIVE,
        uploaded_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
      {
        file_id: input.evidence.pdfFileId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.record.customer_id,
        display_name: "Signed course-use verification",
        original_name: input.evidence.pdfOriginalName,
        mime_type: "application/pdf",
        file_size: input.evidence.pdfBytes,
        storage_provider: input.evidence.pdfStorageProvider,
        bucket_name: input.evidence.pdfBucketName,
        object_key: input.evidence.pdfObjectKey,
        public_url: null,
        status: record_status.ACTIVE,
        uploaded_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    ];
    await tx.customer_file.createMany({ data: files });
    await tx.opd_course_verification.create({
      data: {
        verification_id: input.verificationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.record.encounter_id,
        reservation_id: input.record.reservation_id,
        customer_id: input.record.customer_id,
        legacy_opd_id: input.record.legacy_opd_id,
        legacy_service_usage_id: input.record.legacy_service_usage_id,
        legacy_service_usage_branch_id: scope.branchId,
        source_reservation_version: input.sourceReservationVersion,
        result_reservation_version: input.resultReservationVersion,
        source_legacy_status: "PENDING",
        result_legacy_status: "APPROVED",
        manifest_schema: "opd-course-verification-v1",
        verification_manifest: input.verificationManifest,
        manifest_hash: input.manifestHash,
        signer_customer_id: input.record.customer_id,
        acknowledgement_version: input.acknowledgementVersion,
        acknowledgement_locale: input.acknowledgementLocale,
        acknowledgement_hash: input.acknowledgementHash,
        request_hash: input.requestHash,
        idempotency_key_hash: input.idempotencyKeyHash,
        verified_by_user_id: scope.userId,
        verified_at: now,
        signature_file_id: input.evidence.signatureFileId,
        signature_mime_type: "image/png",
        signature_bytes: input.evidence.signatureBytes,
        signature_hash: input.evidence.signatureHash,
        pdf_file_id: input.evidence.pdfFileId,
        pdf_mime_type: "application/pdf",
        pdf_bytes: input.evidence.pdfBytes,
        pdf_hash: input.evidence.pdfHash,
        render_template: "opd-course-use-verification-v1",
        render_version: 1,
        legacy_document_url: input.legacyDocumentUrl,
        client_ip: input.clientIp,
        user_agent_hash: input.userAgentHash,
        created_at: now,
      },
    });
    if (input.components.length > 0) {
      await tx.opd_course_verification_component.createMany({
        data: input.components.map((component) => ({
          verification_component_id: component.verificationComponentId,
          verification_id: input.verificationId,
          reservation_component_id: component.reservationComponentId,
          reservation_id: input.record.reservation_id,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          encounter_id: input.record.encounter_id,
          product_id: component.productId,
          original_lot_id: component.originalLotId,
          actual_lot_id: component.actualLotId,
          replacement_reason: component.replacementReason,
          expiry_at: component.expiryAt,
          quantity: component.quantity,
          before_lot_stock: component.beforeLotStock,
          after_lot_stock: component.afterLotStock,
          before_total_stock: component.beforeTotalStock,
          after_total_stock: component.afterTotalStock,
          inventory_log_id: component.inventoryLogId,
          inventory_source_updated_at: component.inventorySourceUpdatedAt,
          snapshot_hash: component.snapshotHash,
          created_at: now,
        })),
      });
    }
  }

  findDocumentFile(
    verification: OpdCourseVerificationRecord,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<customer_file | null> {
    return client.customer_file.findFirst({
      where: {
        file_id: verification.pdf_file_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: verification.customer_id,
        status: record_status.ACTIVE,
      },
    });
  }

  reasonExists(
    reasonCode: string,
    client: DatabaseClient = this.prisma,
  ): Promise<boolean> {
    return client.service_usage_request_cancel_reason
      .count({ where: { id: reasonCode } })
      .then((count) => count === 1);
  }

  async createCompensationRequest(
    input: {
      requestId: string;
      verification: OpdCourseVerificationRecord;
      reasonCode: string;
      description: string;
      sourceReservationVersion: number;
      requestHash: string;
      idempotencyKeyHash: string;
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_course_compensation_request> {
    const existingLegacy = await tx.service_usage_request_cancel.findUnique({
      where: {
        branch_id_service_usage_id: {
          branch_id: scope.branchId,
          service_usage_id: input.verification.legacy_service_usage_id,
        },
      },
    });
    if (existingLegacy?.status === approved_status.APPROVED) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    if (existingLegacy) {
      const updated = await tx.service_usage_request_cancel.updateMany({
        where: {
          branch_id: scope.branchId,
          service_usage_id: input.verification.legacy_service_usage_id,
          status: { in: [approved_status.REJECTED, approved_status.PENDING] },
        },
        data: {
          reason_id: input.reasonCode,
          description: input.description,
          status: approved_status.PENDING,
          approve_by: null,
          approve_at: null,
          created_by: scope.userId,
          created_at: now,
          updated_at: now,
        },
      });
      if (updated.count !== 1) {
        throw new Error("COURSE_CANCELLATION_PENDING");
      }
    } else {
      await tx.service_usage_request_cancel.create({
        data: {
          service_usage_id: input.verification.legacy_service_usage_id,
          branch_id: scope.branchId,
          reason_id: input.reasonCode,
          description: input.description,
          status: approved_status.PENDING,
          approve_by: null,
          approve_at: null,
          created_by: scope.userId,
          created_at: now,
          updated_at: now,
        },
      });
    }
    return tx.opd_course_compensation_request.create({
      data: {
        compensation_request_id: input.requestId,
        verification_id: input.verification.verification_id,
        reservation_id: input.verification.reservation_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.verification.encounter_id,
        status: "PENDING",
        reason_code: input.reasonCode,
        reason_description: input.description,
        requested_by_user_id: scope.userId,
        requested_at: now,
        source_reservation_version: input.sourceReservationVersion,
        request_hash: input.requestHash,
        idempotency_key_hash: input.idempotencyKeyHash,
        legacy_service_usage_id: input.verification.legacy_service_usage_id,
        legacy_service_usage_branch_id: scope.branchId,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async lockCompensationRequest(
    requestId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT compensation_request_id::TEXT AS id
      FROM opd_course_compensation_request
      WHERE compensation_request_id = ${requestId}::UUID
        AND clinic_id = ${scope.clinicId}
        AND branch_id = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  async rejectCompensationRequest(
    request: opd_course_compensation_request,
    reviewReason: string,
    requestHash: string,
    idempotencyKeyHash: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.opd_course_compensation_request.updateMany({
      where: {
        compensation_request_id: request.compensation_request_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "PENDING",
        version: request.version,
      },
      data: {
        status: "REJECTED",
        version: { increment: 1 },
        reviewed_by_user_id: scope.userId,
        reviewed_at: now,
        review_reason: reviewReason,
        review_request_hash: requestHash,
        review_idempotency_key_hash: idempotencyKeyHash,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("COURSE_COMPENSATION_NOT_ALLOWED");
    }
    const legacy = await tx.service_usage_request_cancel.updateMany({
      where: {
        service_usage_id: request.legacy_service_usage_id,
        branch_id: scope.branchId,
        status: approved_status.PENDING,
        created_by: request.requested_by_user_id,
      },
      data: {
        status: approved_status.REJECTED,
        approve_by: scope.userId,
        approve_at: now,
        updated_at: now,
      },
    });
    if (legacy.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
  }

  async applyCompensation(
    input: {
      request: opd_course_compensation_request;
      record: OpdCourseReservationRecord;
      adjustmentDocumentId: string;
      reviewReason: string;
      reviewRequestHash: string;
      reviewIdempotencyKeyHash: string;
      reversalManifest: Prisma.InputJsonObject;
      reversalManifestHash: string;
      components: CourseCompensationComponentEffect[];
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const logIds = input.record.items.map((item) => item.legacy_usage_log_id);
    const deletedLogs = await tx.customer_course_usage_log.deleteMany({
      where: {
        id: { in: logIds },
        service_usage_id: input.record.legacy_service_usage_id,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: input.record.customer_id,
        status: usage_log_status.USED,
      },
    });
    if (deletedLogs.count !== logIds.length) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    const usage = await tx.service_usage.updateMany({
      where: {
        service_usage_id: input.record.legacy_service_usage_id,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: input.record.customer_id,
        customer_owner_id: input.record.customer_id,
        status: record_status.ACTIVE,
        service_usage_status: service_usage_status.APPROVED,
      },
      data: {
        status: record_status.DELETED,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (usage.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    const unlinked = await tx.opd.updateMany({
      where: {
        opd_id: input.record.legacy_opd_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.record.customer_id,
        management_item: input.record.legacy_service_usage_id,
      },
      data: { management_item: null, updated_at: now },
    });
    if (unlinked.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    const reservation = await tx.opd_course_reservation.updateMany({
      where: {
        reservation_id: input.record.reservation_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.record.encounter_id,
        status: "USED",
        version: 2,
      },
      data: {
        status: "COMPENSATED",
        version: { increment: 1 },
        compensated_by_user_id: scope.userId,
        compensated_at: now,
        updated_at: now,
      },
    });
    if (reservation.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    const request = await tx.opd_course_compensation_request.updateMany({
      where: {
        compensation_request_id: input.request.compensation_request_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "PENDING",
        version: input.request.version,
      },
      data: {
        status: "APPROVED",
        version: { increment: 1 },
        reviewed_by_user_id: scope.userId,
        reviewed_at: now,
        review_reason: input.reviewReason,
        review_request_hash: input.reviewRequestHash,
        review_idempotency_key_hash: input.reviewIdempotencyKeyHash,
        adjustment_document_id: input.adjustmentDocumentId,
        reversal_manifest: input.reversalManifest,
        reversal_manifest_hash: input.reversalManifestHash,
        updated_at: now,
      },
    });
    if (request.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    const legacyRequest = await tx.service_usage_request_cancel.updateMany({
      where: {
        service_usage_id: input.record.legacy_service_usage_id,
        branch_id: scope.branchId,
        status: approved_status.PENDING,
        created_by: input.request.requested_by_user_id,
      },
      data: {
        status: approved_status.APPROVED,
        approve_by: scope.userId,
        approve_at: now,
        updated_at: now,
      },
    });
    if (legacyRequest.count !== 1) {
      throw new Error("MANUAL_RECONCILIATION_REQUIRED");
    }
    if (input.components.length > 0) {
      await tx.opd_course_compensation_component.createMany({
        data: input.components.map((component) => ({
          compensation_component_id: component.compensationComponentId,
          compensation_request_id: input.request.compensation_request_id,
          verification_component_id: component.verificationComponentId,
          verification_id: input.request.verification_id,
          reservation_id: input.record.reservation_id,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          encounter_id: input.record.encounter_id,
          product_id: component.productId,
          lot_id: component.lotId,
          quantity: component.quantity,
          original_inventory_log_id: component.originalInventoryLogId,
          inverse_inventory_log_id: component.inverseInventoryLogId,
          before_lot_stock: component.beforeLotStock,
          after_lot_stock: component.afterLotStock,
          before_total_stock: component.beforeTotalStock,
          after_total_stock: component.afterTotalStock,
          snapshot_hash: component.snapshotHash,
          created_at: now,
        })),
      });
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  auditReferenceType,
  type api_idempotency,
  type opd_encounter,
} from "@prisma/client";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { backendEnv } from "../../env";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type {
  OpdOrderItemVersionDto,
  OpdOrderLotSelectionDto,
  OpdOrderReleasePreflightDto,
  ReleaseOpdOrderDto,
  VoidReleasedOpdOrderDto,
} from "./dto/opd-order-release.dto";
import { OpdOrderSourceType } from "./dto/opd-order.dto";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import {
  OPD_RELEASE_PRICING_POLICY,
  OPD_RELEASE_REQUIRED_PERMISSIONS,
  OPD_RELEASE_SAFETY_SOURCE,
  OPD_RELEASE_TAX_POLICY,
  type OpdOrderReleasePreflightResult,
  type OpdOrderReleaseResult,
  type OpdReleaseBlocker,
  type OpdReleaseBlockerCode,
  type VoidOpdOrderReleaseResult,
  toOpdOrderReleaseResult,
  toVoidOpdOrderReleaseResult,
} from "./opd-order-release.mapper";
import {
  type CreateOpdReleaseInput,
  OpdOrderReleaseRepository,
  type OpdReleaseLotRecord,
  type OpdReleasePreparedLine,
} from "./opd-order-release.repository";
import type { OpdOrderRecord } from "./opd-order.mapper";
import { OpdOrderRepository } from "./opd-order.repository";

type DatabaseClient = Prisma.TransactionClient | PrismaService;
type EvaluatedReleaseLine = Omit<
  OpdReleasePreparedLine,
  "legacyPrescriptionItemId" | "legacySaleOrderItemId"
>;

interface ReleaseEvaluation {
  encounter: opd_encounter;
  order: OpdOrderRecord;
  result: OpdOrderReleasePreflightResult;
  snapshotHash: string;
  lines: EvaluatedReleaseLine[];
  legacyOpdId: string | null;
  customerId: string;
  prescriberUserId: string | null;
  totals: {
    subtotalAmount: Prisma.Decimal;
    promotionDiscountAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    netTotalAmount: Prisma.Decimal;
  };
}

interface PreflightTokenPayload {
  version: 1;
  clinicId: string;
  branchId: string;
  encounterId: string;
  orderId: string;
  snapshotHash: string;
  safetySnapshotHash: string;
  expiresAtMs: number;
}

const RELEASE_OPERATION = "opd.order.medication.release.v1";
const VOID_OPERATION = "opd.order.medication-release.void.v1";
const PREFLIGHT_TTL_MS = 5 * 60_000;
const ZERO = new Prisma.Decimal(0);
const MAX_MONEY = new Prisma.Decimal("999999999999.99");

@Injectable()
export class OpdOrderReleaseService {
  constructor(
    private readonly repository: OpdOrderReleaseRepository,
    private readonly orderRepository: OpdOrderRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async preflight(
    encounterId: string,
    orderId: string,
    dto: OpdOrderReleasePreflightDto,
    scope: RequestScope,
  ): Promise<OpdOrderReleasePreflightResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const evaluation = await this.evaluate(
          encounterId,
          orderId,
          dto,
          scope,
          new Date(),
          tx,
        );
        return evaluation.result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  async release(
    encounterId: string,
    orderId: string,
    dto: ReleaseOpdOrderDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdOrderReleaseResult> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = this.releaseRequestHash(encounterId, orderId, dto);
    return this.releaseWithRetry(
      encounterId,
      orderId,
      dto,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  async voidRelease(
    encounterId: string,
    orderId: string,
    dto: VoidReleasedOpdOrderDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<VoidOpdOrderReleaseResult> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = this.sha256(
      JSON.stringify({
        operation: VOID_OPERATION,
        encounterId,
        orderId,
        expectedOrderVersion: dto.expectedOrderVersion,
        reason: dto.reason.trim(),
      }),
    );
    return this.voidWithRetry(
      encounterId,
      orderId,
      dto,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  private async releaseWithRetry(
    encounterId: string,
    orderId: string,
    dto: ReleaseOpdOrderDto,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<OpdOrderReleaseResult> {
    const existing = await this.repository.findIdempotency(
      RELEASE_OPERATION,
      idempotencyKey,
      scope,
    );
    if (existing) {
      return this.replayRelease(
        existing,
        requestHash,
        encounterId,
        orderId,
        scope,
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            {
              operation: RELEASE_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_ORDER_RELEASE",
              resourceId: orderId,
            },
            scope,
            now,
            tx,
          );

          const encounter = await this.lockReleaseTrigger(
            encounterId,
            orderId,
            scope,
            tx,
          );
          const order = await this.requireOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          this.assertDraftOrder(order);
          this.assertOrderVersion(order, dto.expectedOrderVersion);
          await this.repository.lockActiveItems(
            encounterId,
            orderId,
            scope,
            tx,
          );
          const activeProductIds = [
            ...new Set(
              order.items
                .filter((item) => item.status === "ACTIVE")
                .map((item) => item.source_id),
            ),
          ];
          await this.repository.lockSourceProducts(activeProductIds, scope, tx);

          const evaluation = await this.evaluateLoaded(
            encounter,
            order,
            dto,
            scope,
            now,
            tx,
          );
          this.assertReleaseVersions(evaluation);
          this.assertSafetyAcknowledgement(dto, evaluation);
          this.assertEvaluationEligible(evaluation);
          this.verifyPreflightToken(dto.preflightToken, evaluation, scope, now);
          if (
            !evaluation.legacyOpdId ||
            !evaluation.prescriberUserId ||
            evaluation.lines.length === 0
          ) {
            throw new Error("Eligible OPD release evaluation is incomplete");
          }

          const priorRelease = await this.repository.findReleaseByOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (priorRelease) {
            this.throwConflict(
              "ORDER_ALREADY_RELEASED",
              "This OPD order already has a permanent release",
            );
          }

          const saleOrderId = await this.repository.allocateSaleOrderNumber(
            scope,
            now,
            tx,
          );
          const prescriptionId = randomUUID();
          const preparedLines: OpdReleasePreparedLine[] = evaluation.lines.map(
            (line) => ({
              ...line,
              legacyPrescriptionItemId: randomUUID(),
              legacySaleOrderItemId: randomUUID(),
            }),
          );
          const createInput: CreateOpdReleaseInput = {
            encounterId,
            orderId,
            legacyOpdId: evaluation.legacyOpdId,
            customerId: evaluation.customerId,
            prescriptionId,
            saleOrderId,
            requestHash,
            idempotencyKeyHash: this.sha256(idempotencyKey),
            sourceOrderVersion: order.version,
            itemVersionManifest: this.itemVersionManifest(order.items),
            subtotalAmount: evaluation.totals.subtotalAmount,
            promotionDiscountAmount: evaluation.totals.promotionDiscountAmount,
            taxAmount: evaluation.totals.taxAmount,
            netTotalAmount: evaluation.totals.netTotalAmount,
            pricingPolicy: OPD_RELEASE_PRICING_POLICY,
            taxPolicy: OPD_RELEASE_TAX_POLICY,
            safetySource: OPD_RELEASE_SAFETY_SOURCE,
            safetySnapshotHash: evaluation.result.safety.safetySnapshotHash,
            prescriberUserId: evaluation.prescriberUserId,
            lines: preparedLines,
          };
          const releaseId = await this.repository.createRelease(
            createInput,
            scope,
            now,
            tx,
          );
          const released = await this.repository.markOrderReleased(
            createInput,
            scope,
            now,
            tx,
          );
          if (!released) this.throwOrderConflict(order);

          await this.auditLogService.create(
            {
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              referenceType: auditReferenceType.OPD,
              referenceId: encounterId,
              action: "order.medication.release",
              actionLabel: "Release OPD medication order",
              fromStatus: "DRAFT",
              toStatus: "RELEASED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                orderId,
                releaseId,
                prescriptionId,
                saleOrderId,
                prescriberUserId: evaluation.prescriberUserId,
                sourceOrderVersion: order.version,
                resultOrderVersion: order.version + 1,
                itemCount: preparedLines.length,
                subtotalAmount: evaluation.totals.subtotalAmount.toFixed(2),
                promotionDiscountAmount:
                  evaluation.totals.promotionDiscountAmount.toFixed(2),
                taxAmount: evaluation.totals.taxAmount.toFixed(2),
                netTotalAmount: evaluation.totals.netTotalAmount.toFixed(2),
                safetySnapshotHash: evaluation.result.safety.safetySnapshotHash,
                inventoryReserved: false,
                inventoryDeducted: false,
              },
            },
            tx,
          );

          const record = await this.repository.findReleaseByOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (!record || record.release_id !== releaseId) {
            throw new Error("Released OPD order could not be reloaded");
          }
          const result = toOpdOrderReleaseResult(record);
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            releaseId,
            this.releaseResultSnapshot(result),
            201,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          RELEASE_OPERATION,
          idempotencyKey,
          scope,
        );
        if (replay) {
          return this.replayRelease(
            replay,
            requestHash,
            encounterId,
            orderId,
            scope,
          );
        }
        const release = await this.repository.findReleaseByOrder(
          encounterId,
          orderId,
          scope,
        );
        if (release) {
          this.throwConflict(
            "ORDER_ALREADY_RELEASED",
            "This OPD order was released concurrently",
          );
        }
      }
      if (
        canRetrySerialization &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.releaseWithRetry(
          encounterId,
          orderId,
          dto,
          idempotencyKey,
          requestHash,
          scope,
          principal,
          false,
        );
      }
      throw error;
    }
  }

  private async voidWithRetry(
    encounterId: string,
    orderId: string,
    dto: VoidReleasedOpdOrderDto,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<VoidOpdOrderReleaseResult> {
    const existing = await this.repository.findIdempotency(
      VOID_OPERATION,
      idempotencyKey,
      scope,
    );
    if (existing) {
      return this.replayVoid(
        existing,
        requestHash,
        encounterId,
        orderId,
        scope,
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            {
              operation: VOID_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_ORDER_RELEASE_VOID",
              resourceId: orderId,
            },
            scope,
            now,
            tx,
          );
          const orderLocked = await this.orderRepository.lockOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (!orderLocked) this.throwOrderNotFound();
          const releaseLocked = await this.repository.lockRelease(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (!releaseLocked) this.throwReleaseNotFound();
          const order = await this.requireOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (order.status !== "RELEASED") {
            this.throwConflict(
              order.status === "VOIDED"
                ? "ORDER_ALREADY_VOIDED"
                : "ORDER_NOT_RELEASED",
              order.status === "VOIDED"
                ? "This released OPD order is already voided"
                : "Only a released OPD order can be voided",
            );
          }
          this.assertOrderVersion(order, dto.expectedOrderVersion);
          const release = await this.repository.findReleaseByOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (!release?.prescription_link || !release.sale_link) {
            this.throwConflict(
              "COMPENSATION_REQUIRED",
              "The released order is missing a durable downstream link",
            );
          }
          await this.repository.lockLegacyDownstream(
            release.prescription_link.legacy_prescribe_id,
            release.sale_link.legacy_sale_order_id,
            scope,
            tx,
          );
          const progression = await this.repository.downstreamProgression(
            release.prescription_link.legacy_prescribe_id,
            release.sale_link.legacy_sale_order_id,
            scope,
            tx,
          );
          const progressionBlockers = this.progressionBlockers(progression);
          if (progressionBlockers.length > 0) {
            this.throwConflict(
              "COMPENSATION_REQUIRED",
              "This release has progressed downstream and requires manual compensation",
              { blockers: progressionBlockers },
            );
          }

          const reason = dto.reason.trim();
          if (!reason) {
            throw new BadRequestException("A void reason is required");
          }
          const voided = await this.repository.voidDownstreamAndOrder(
            {
              encounterId,
              orderId,
              prescriptionId: release.prescription_link.legacy_prescribe_id,
              saleOrderId: release.sale_link.legacy_sale_order_id,
              expectedOrderVersion: dto.expectedOrderVersion,
              reason,
            },
            scope,
            now,
            tx,
          );
          if (!voided) {
            this.throwConflict(
              "COMPENSATION_REQUIRED",
              "The release changed while compensation was being validated",
            );
          }
          await this.auditLogService.create(
            {
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              referenceType: auditReferenceType.OPD,
              referenceId: encounterId,
              action: "order.medication-release.void",
              actionLabel: "Void released OPD medication order",
              fromStatus: "RELEASED",
              toStatus: "VOIDED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                orderId,
                releaseId: release.release_id,
                prescriptionId: release.prescription_link.legacy_prescribe_id,
                saleOrderId: release.sale_link.legacy_sale_order_id,
                reason,
                sourceOrderVersion: dto.expectedOrderVersion,
                resultOrderVersion: dto.expectedOrderVersion + 1,
              },
            },
            tx,
          );
          const updated = await this.repository.findReleaseByOrder(
            encounterId,
            orderId,
            scope,
            tx,
          );
          if (!updated)
            throw new Error("Voided OPD release could not be reloaded");
          const result = toVoidOpdOrderReleaseResult(updated);
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            release.release_id,
            this.voidResultSnapshot(result),
            200,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          VOID_OPERATION,
          idempotencyKey,
          scope,
        );
        if (replay) {
          return this.replayVoid(
            replay,
            requestHash,
            encounterId,
            orderId,
            scope,
          );
        }
      }
      if (
        canRetrySerialization &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.voidWithRetry(
          encounterId,
          orderId,
          dto,
          idempotencyKey,
          requestHash,
          scope,
          principal,
          false,
        );
      }
      throw error;
    }
  }

  private async evaluate(
    encounterId: string,
    orderId: string,
    dto: OpdOrderReleasePreflightDto,
    scope: RequestScope,
    now: Date,
    client: DatabaseClient,
  ): Promise<ReleaseEvaluation> {
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
      client,
    );
    if (!encounter) this.throwEncounterNotFound();
    const order = await this.requireOrder(encounterId, orderId, scope, client);
    this.assertReleaseTrigger(encounter, order);
    return this.evaluateLoaded(encounter, order, dto, scope, now, client);
  }

  private async evaluateLoaded(
    encounter: opd_encounter,
    order: OpdOrderRecord,
    dto: OpdOrderReleasePreflightDto,
    scope: RequestScope,
    now: Date,
    client: DatabaseClient,
  ): Promise<ReleaseEvaluation> {
    const activeItems = order.items.filter((item) => item.status === "ACTIVE");
    const blockers: OpdReleaseBlocker[] = [];
    if (order.version !== dto.expectedOrderVersion) {
      blockers.push(
        this.blocker(
          "ORDER_VERSION_CONFLICT",
          "The OPD order changed after it was loaded",
          null,
          dto.expectedOrderVersion,
          order.version,
        ),
      );
    }
    this.validateItemManifest(activeItems, dto.itemVersions, blockers);
    if (activeItems.length === 0) {
      blockers.push(
        this.blocker("ORDER_EMPTY", "The OPD order has no active items"),
      );
    }

    const allergy = await this.repository.findAllergyText(
      encounter.customer_id,
      scope,
      client,
    );
    const allergyText = allergy?.allergy ?? "";
    const safetySnapshotHash = this.sha256(
      JSON.stringify({
        source: OPD_RELEASE_SAFETY_SOURCE,
        clinicId: scope.clinicId,
        customerId: encounter.customer_id,
        allergyText,
      }),
    );

    const legacyOpdId = encounter.legacy_opd_id;
    if (!legacyOpdId) {
      blockers.push(
        this.blocker(
          "LEGACY_OPD_REQUIRED",
          "The encounter has no scoped legacy OPD identity",
        ),
      );
    } else {
      const legacyOpd = await this.repository.findLegacyOpd(
        legacyOpdId,
        encounter.customer_id,
        scope,
        client,
      );
      if (!legacyOpd) {
        blockers.push(
          this.blocker(
            "LEGACY_OPD_MISMATCH",
            "The legacy OPD identity does not match this clinic, branch, and customer",
          ),
        );
      }
      if (
        await this.repository.hasExistingLegacyPrescription(
          legacyOpdId,
          scope,
          client,
        )
      ) {
        blockers.push(
          this.blocker(
            "DOWNSTREAM_ALREADY_EXISTS",
            "A legacy prescription already exists for this scoped OPD",
          ),
        );
      }
    }

    const prescriberUserId = encounter.attending_user_id;
    if (!prescriberUserId) {
      blockers.push(
        this.blocker(
          "ATTENDING_DOCTOR_REQUIRED",
          "An assigned attending doctor is required before release",
        ),
      );
    } else if (
      !(await this.repository.isValidAttendingDoctor(
        prescriberUserId,
        scope,
        client,
      ))
    ) {
      blockers.push(
        this.blocker(
          "ATTENDING_DOCTOR_INVALID",
          "The assigned attending doctor is not an active doctor in this branch",
        ),
      );
    }

    const priorRelease = await this.repository.findReleaseByOrder(
      encounter.encounter_id,
      order.order_id,
      scope,
      client,
    );
    if (priorRelease) {
      blockers.push(
        this.blocker(
          "DOWNSTREAM_ALREADY_EXISTS",
          "This OPD order already has a permanent app-owned release",
        ),
      );
    }

    const selectionMap = new Map(
      (dto.selectedLots ?? []).map((selection) => [
        selection.orderItemId,
        selection.lotId.trim(),
      ]),
    );
    const activeIds = new Set(activeItems.map((item) => item.order_item_id));
    for (const selection of dto.selectedLots ?? []) {
      if (!activeIds.has(selection.orderItemId)) {
        blockers.push(
          this.blocker(
            "LOT_UNAVAILABLE",
            "A selected lot references a non-active order item",
            selection.orderItemId,
          ),
        );
      }
    }

    const lines: EvaluatedReleaseLine[] = [];
    const priceViews: OpdOrderReleasePreflightResult["lines"] = [];
    const lotViews: OpdOrderReleasePreflightResult["lots"] = [];
    let subtotalAmount = ZERO;
    let promotionDiscountAmount = ZERO;
    let netTotalAmount = ZERO;

    for (const item of activeItems) {
      if (
        item.source_type !== "PRODUCT" ||
        (item.category !== "MEDICINE" && item.category !== "DRUG")
      ) {
        blockers.push(
          this.blocker(
            "UNSUPPORTED_ITEM",
            "Phase 3B supports PRODUCT medication lines in MEDICINE or DRUG only",
            item.order_item_id,
          ),
        );
        continue;
      }
      const instruction = item.medication_instruction;
      if (!instruction?.sig_text.trim()) {
        blockers.push(
          this.blocker(
            "MEDICATION_INSTRUCTION_REQUIRED",
            "A complete medication SIG is required",
            item.order_item_id,
          ),
        );
      }

      const source = await this.orderRepository.findCatalogItem(
        OpdOrderSourceType.PRODUCT,
        item.source_id,
        scope,
        client,
      );
      if (
        !source ||
        source.sourceType !== "PRODUCT" ||
        (source.category !== "MEDICINE" && source.category !== "DRUG")
      ) {
        blockers.push(
          this.blocker(
            "UNSUPPORTED_ITEM",
            "The current server catalog source is unavailable or no longer an eligible medication",
            item.order_item_id,
          ),
        );
        continue;
      }
      if (
        !source.basePrice ||
        !source.effectivePrice ||
        !source.basePrice.isPositive() ||
        !source.effectivePrice.isPositive() ||
        source.basePrice.greaterThan(MAX_MONEY) ||
        source.effectivePrice.greaterThan(MAX_MONEY)
      ) {
        blockers.push(
          this.blocker(
            "INVALID_PRICE",
            "The current medication price is missing, non-positive, or outside the supported range",
            item.order_item_id,
          ),
        );
        continue;
      }
      const baseUnitPrice = source.basePrice.toDecimalPlaces(2);
      const unitPrice = source.effectivePrice.toDecimalPlaces(2);
      if (
        source.pricingSource === "PROMOTION" &&
        unitPrice.greaterThan(baseUnitPrice)
      ) {
        blockers.push(
          this.blocker(
            "INVALID_PROMOTION",
            "The active promotion price is greater than the base price",
            item.order_item_id,
          ),
        );
        continue;
      }
      if (source.taxType !== "NO_VAT") {
        blockers.push(
          this.blocker(
            "TAX_UNSUPPORTED",
            "Phase 3B supports explicit NO_VAT medication rows only",
            item.order_item_id,
          ),
        );
      }

      const quantity = item.quantity;
      const grossAmount = quantity.mul(baseUnitPrice).toDecimalPlaces(2);
      const netAmount = quantity.mul(unitPrice).toDecimalPlaces(2);
      const discountAmount = grossAmount.sub(netAmount).toDecimalPlaces(2);
      if (
        grossAmount.greaterThan(MAX_MONEY) ||
        netAmount.greaterThan(MAX_MONEY) ||
        discountAmount.isNegative()
      ) {
        blockers.push(
          this.blocker(
            "INVALID_PRICE",
            "The recalculated medication amount is outside the supported range",
            item.order_item_id,
          ),
        );
        continue;
      }
      if (
        !item.unit_price_amount.equals(unitPrice) ||
        item.pricing_source !== source.pricingSource ||
        item.tax_type_snapshot !== source.taxType ||
        !item.gross_amount.equals(netAmount) ||
        item.source_code !== source.code ||
        item.name_snapshot !== source.name ||
        item.unit_snapshot !== source.unit
      ) {
        blockers.push(
          this.blocker(
            "REPRICE_REQUIRED",
            "The current server price or medication source snapshot differs from the draft",
            item.order_item_id,
          ),
        );
      }

      subtotalAmount = subtotalAmount.add(grossAmount);
      promotionDiscountAmount = promotionDiscountAmount.add(discountAmount);
      netTotalAmount = netTotalAmount.add(netAmount);
      priceViews.push({
        orderItemId: item.order_item_id,
        sourceId: item.source_id,
        itemName: source.name,
        quantity: this.decimalNumber(quantity),
        baseUnitPrice: this.decimalNumber(baseUnitPrice),
        unitPrice: this.decimalNumber(unitPrice),
        pricingSource: source.pricingSource,
        grossAmount: this.decimalNumber(grossAmount),
        discountAmount: this.decimalNumber(discountAmount),
        taxAmount: 0,
        netAmount: this.decimalNumber(netAmount),
      });

      const lots = await this.repository.findLots(
        item.source_id,
        scope,
        client,
      );
      const eligibleLots = lots.filter(
        (lot) =>
          lot.inStock.isPositive() &&
          lot.inStock.greaterThanOrEqualTo(quantity) &&
          lot.expiryCount === 1 &&
          Boolean(lot.expiryAt && lot.expiryAt.getTime() > now.getTime()),
      );
      lotViews.push({
        orderItemId: item.order_item_id,
        sourceId: item.source_id,
        itemName: source.name,
        requiredQuantity: this.decimalNumber(quantity),
        eligibleLots: eligibleLots.map((lot) => ({
          lotId: lot.lotId,
          expiryAt: this.requireExpiry(lot).toISOString(),
          availableQuantity: this.decimalNumber(lot.inStock),
        })),
      });

      const selectedLotId = selectionMap.get(item.order_item_id);
      const selectedLot = selectedLotId
        ? lots.find((lot) => lot.lotId === selectedLotId)
        : undefined;
      if (!selectedLotId) {
        blockers.push(
          this.blocker(
            "LOT_SELECTION_REQUIRED",
            "Select one server-listed lot for this medication line",
            item.order_item_id,
          ),
        );
        if (eligibleLots.length === 0) {
          blockers.push(
            this.unavailableLotBlocker(item.order_item_id, lots, now),
          );
        }
        continue;
      }
      if (!selectedLot) {
        blockers.push(
          this.blocker(
            "LOT_UNAVAILABLE",
            "The selected lot is unavailable in this branch",
            item.order_item_id,
          ),
        );
        continue;
      }
      const selectedBlocker = this.selectedLotBlocker(
        item.order_item_id,
        selectedLot,
        quantity,
        now,
      );
      if (selectedBlocker) {
        blockers.push(selectedBlocker);
        continue;
      }
      if (!instruction) continue;
      lines.push({
        orderItemId: item.order_item_id,
        displayOrder: item.display_order,
        sourceId: item.source_id,
        sourceCode: source.code,
        category: source.category,
        name: source.name,
        unit: source.unit,
        quantity,
        baseUnitPrice,
        unitPrice,
        pricingSource: source.pricingSource,
        grossAmount,
        discountAmount,
        taxAmount: ZERO,
        netAmount,
        orderItemNote: item.note,
        dose: instruction.dose,
        route: instruction.route,
        frequency: instruction.frequency,
        timing: instruction.timing,
        durationValue: instruction.duration_value,
        durationUnit: instruction.duration_unit,
        sigText: instruction.sig_text,
        medicationNote: instruction.note,
        lotId: selectedLot.lotId,
        expiryAt: this.requireExpiry(selectedLot),
        stockObservedQuantity: selectedLot.inStock,
      });
    }

    const totals = {
      subtotalAmount: subtotalAmount.toDecimalPlaces(2),
      promotionDiscountAmount: promotionDiscountAmount.toDecimalPlaces(2),
      taxAmount: ZERO,
      netTotalAmount: netTotalAmount.toDecimalPlaces(2),
    };
    const normalizedSelections = [...selectionMap.entries()]
      .map(([orderItemId, lotId]) => ({ orderItemId, lotId }))
      .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
    const itemVersions = activeItems
      .map((item) => ({
        orderItemId: item.order_item_id,
        version: item.version,
      }))
      .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
    const snapshotHash = this.sha256(
      JSON.stringify({
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        encounterId: encounter.encounter_id,
        orderId: order.order_id,
        orderVersion: order.version,
        itemVersions,
        lines: lines.map((line) => ({
          orderItemId: line.orderItemId,
          sourceId: line.sourceId,
          quantity: line.quantity.toFixed(2),
          baseUnitPrice: line.baseUnitPrice.toFixed(2),
          unitPrice: line.unitPrice.toFixed(2),
          pricingSource: line.pricingSource,
          grossAmount: line.grossAmount.toFixed(2),
          discountAmount: line.discountAmount.toFixed(2),
          netAmount: line.netAmount.toFixed(2),
          lotId: line.lotId,
          expiryAt: line.expiryAt.toISOString(),
          stockObservedQuantity: line.stockObservedQuantity.toFixed(2),
          sigText: line.sigText,
        })),
        totals: {
          subtotalAmount: totals.subtotalAmount.toFixed(2),
          promotionDiscountAmount: totals.promotionDiscountAmount.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          netTotalAmount: totals.netTotalAmount.toFixed(2),
        },
        selectedLots: normalizedSelections,
        safetySnapshotHash,
        legacyOpdId,
        prescriberUserId,
      }),
    );
    const dedupedBlockers = this.dedupeBlockers(blockers);
    const expiresAt = new Date(now.getTime() + PREFLIGHT_TTL_MS);
    const eligible = dedupedBlockers.length === 0;
    const result: OpdOrderReleasePreflightResult = {
      eligible,
      blockers: dedupedBlockers,
      lines: priceViews,
      totals: {
        currency: "THB",
        subtotalAmount: this.decimalNumber(totals.subtotalAmount),
        promotionDiscountAmount: this.decimalNumber(
          totals.promotionDiscountAmount,
        ),
        taxAmount: 0,
        netTotalAmount: this.decimalNumber(totals.netTotalAmount),
      },
      lots: lotViews,
      safety: {
        source: OPD_RELEASE_SAFETY_SOURCE,
        allergyText,
        safetySnapshotHash,
        acknowledgementRequired: true,
        isDrugInteractionCheck: false,
      },
      requiredPermissions: [...OPD_RELEASE_REQUIRED_PERMISSIONS],
      orderVersion: order.version,
      itemVersions,
      selectedLots: normalizedSelections,
      pricingPolicy: OPD_RELEASE_PRICING_POLICY,
      taxPolicy: OPD_RELEASE_TAX_POLICY,
      preflightToken: eligible
        ? this.issuePreflightToken(
            {
              version: 1,
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              encounterId: encounter.encounter_id,
              orderId: order.order_id,
              snapshotHash,
              safetySnapshotHash,
              expiresAtMs: expiresAt.getTime(),
            },
            backendEnv().JWT_SECRET,
          )
        : null,
      expiresAt: eligible ? expiresAt.toISOString() : null,
      inventoryReserved: false,
    };
    return {
      encounter,
      order,
      result,
      snapshotHash,
      lines,
      legacyOpdId,
      customerId: encounter.customer_id,
      prescriberUserId,
      totals,
    };
  }

  private async lockReleaseTrigger(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<opd_encounter> {
    const lockedEncounter = await this.clinicalRepository.lockEncounter(
      encounterId,
      scope,
      tx,
    );
    if (!lockedEncounter) this.throwEncounterNotFound();
    const lockedOrder = await this.orderRepository.lockOrder(
      encounterId,
      orderId,
      scope,
      tx,
    );
    if (!lockedOrder) this.throwOrderNotFound();
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
      tx,
    );
    if (!encounter) this.throwEncounterNotFound();
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      this.throwConflict(
        "RELEASE_TRIGGER_STATE_INVALID",
        "Medication release requires an open encounter with a draft clinical record",
      );
    }
    return encounter;
  }

  private async requireOrder(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    client: DatabaseClient,
  ): Promise<OpdOrderRecord> {
    const order = await this.orderRepository.findDraftOrder(
      encounterId,
      scope,
      client,
    );
    if (!order || order.order_id !== orderId) this.throwOrderNotFound();
    return order;
  }

  private assertReleaseTrigger(
    encounter: opd_encounter,
    order: OpdOrderRecord,
  ): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      this.throwConflict(
        "RELEASE_TRIGGER_STATE_INVALID",
        "Medication release requires an open encounter with a draft clinical record",
      );
    }
    this.assertDraftOrder(order);
  }

  private assertDraftOrder(order: OpdOrderRecord): void {
    if (order.status !== "DRAFT") {
      this.throwConflict(
        order.status === "VOIDED"
          ? "ORDER_ALREADY_VOIDED"
          : "ORDER_ALREADY_RELEASED",
        order.status === "VOIDED"
          ? "This OPD order is voided and immutable"
          : "This OPD order is already released",
      );
    }
  }

  private assertOrderVersion(
    order: OpdOrderRecord,
    expectedVersion: number,
  ): void {
    if (order.version !== expectedVersion) this.throwOrderConflict(order);
  }

  private assertReleaseVersions(evaluation: ReleaseEvaluation): void {
    const orderBlocker = evaluation.result.blockers.find(
      (blocker) => blocker.code === "ORDER_VERSION_CONFLICT",
    );
    if (orderBlocker) this.throwOrderConflict(evaluation.order);
    const itemBlocker = evaluation.result.blockers.find(
      (blocker) => blocker.code === "ITEM_VERSION_MANIFEST_MISMATCH",
    );
    if (itemBlocker) {
      const item = evaluation.order.items.find(
        (candidate) => candidate.order_item_id === itemBlocker.orderItemId,
      );
      if (item) {
        throw new VersionConflictException({
          resourceType: "OPD_ORDER_ITEM",
          resourceId: item.order_item_id,
          currentVersion: item.version,
          currentStatus: item.status,
          updatedAt: item.updated_at.toISOString(),
        });
      }
      this.throwConflict(
        "ITEM_VERSION_MANIFEST_MISMATCH",
        "The active OPD order item manifest changed after preflight",
      );
    }
  }

  private assertSafetyAcknowledgement(
    dto: ReleaseOpdOrderDto,
    evaluation: ReleaseEvaluation,
  ): void {
    if (
      dto.safetyAcknowledgement.safetySnapshotHash !==
      evaluation.result.safety.safetySnapshotHash
    ) {
      this.throwConflict(
        "SAFETY_REVIEW_REQUIRED",
        "The current legacy allergy text changed after preflight",
        {
          safetySnapshotHash: evaluation.result.safety.safetySnapshotHash,
        },
      );
    }
  }

  private assertEvaluationEligible(evaluation: ReleaseEvaluation): void {
    if (evaluation.result.eligible) return;
    const reprice = evaluation.result.blockers.some(
      (blocker) => blocker.code === "REPRICE_REQUIRED",
    );
    this.throwConflict(
      reprice ? "REPRICE_REQUIRED" : "RELEASE_BLOCKED",
      reprice
        ? "The medication order must be repriced and reviewed before release"
        : "The medication order no longer passes release preflight",
      {
        blockers: evaluation.result.blockers.map((blocker) => ({
          code: blocker.code,
          message: blocker.message,
          orderItemId: blocker.orderItemId,
          expectedVersion: blocker.expectedVersion,
          currentVersion: blocker.currentVersion,
        })),
        replacementTotals: {
          currency: evaluation.result.totals.currency,
          subtotalAmount: evaluation.result.totals.subtotalAmount,
          promotionDiscountAmount:
            evaluation.result.totals.promotionDiscountAmount,
          taxAmount: evaluation.result.totals.taxAmount,
          netTotalAmount: evaluation.result.totals.netTotalAmount,
        },
      },
    );
  }

  private validateItemManifest(
    activeItems: OpdOrderRecord["items"],
    expected: OpdOrderItemVersionDto[],
    blockers: OpdReleaseBlocker[],
  ): void {
    const expectedMap = new Map(
      expected.map((item) => [item.orderItemId, item.version]),
    );
    const activeIds = new Set(activeItems.map((item) => item.order_item_id));
    for (const item of activeItems) {
      const expectedVersion = expectedMap.get(item.order_item_id);
      if (expectedVersion !== item.version) {
        blockers.push(
          this.blocker(
            "ITEM_VERSION_MANIFEST_MISMATCH",
            "The active OPD order item manifest changed after it was loaded",
            item.order_item_id,
            expectedVersion ?? null,
            item.version,
          ),
        );
      }
    }
    for (const item of expected) {
      if (!activeIds.has(item.orderItemId)) {
        blockers.push(
          this.blocker(
            "ITEM_VERSION_MANIFEST_MISMATCH",
            "The supplied item manifest contains a non-active order item",
            item.orderItemId,
            item.version,
            null,
          ),
        );
      }
    }
  }

  private selectedLotBlocker(
    orderItemId: string,
    lot: OpdReleaseLotRecord,
    quantity: Prisma.Decimal,
    now: Date,
  ): OpdReleaseBlocker | null {
    if (!lot.inStock.isPositive() || lot.inStock.lessThan(quantity)) {
      return this.blocker(
        "INSUFFICIENT_STOCK",
        "The selected lot no longer has enough current branch stock",
        orderItemId,
      );
    }
    if (lot.expiryCount === 0 || !lot.expiryAt) {
      return this.blocker(
        "LOT_EXPIRY_MISSING",
        "The selected lot has no verified expiry date",
        orderItemId,
      );
    }
    if (lot.expiryCount !== 1) {
      return this.blocker(
        "LOT_EXPIRY_AMBIGUOUS",
        "The selected lot maps to conflicting expiry dates",
        orderItemId,
      );
    }
    if (lot.expiryAt.getTime() <= now.getTime()) {
      return this.blocker(
        "LOT_EXPIRED",
        "The selected lot is expired or expires at the release instant",
        orderItemId,
      );
    }
    return null;
  }

  private unavailableLotBlocker(
    orderItemId: string,
    lots: OpdReleaseLotRecord[],
    now: Date,
  ): OpdReleaseBlocker {
    if (lots.length === 0) {
      return this.blocker(
        "LOT_UNAVAILABLE",
        "No branch inventory lot exists for this medication",
        orderItemId,
      );
    }
    if (lots.every((lot) => lot.expiryCount === 0 || !lot.expiryAt)) {
      return this.blocker(
        "LOT_EXPIRY_MISSING",
        "No medication lot has a verified expiry date",
        orderItemId,
      );
    }
    if (lots.every((lot) => lot.expiryCount !== 1)) {
      return this.blocker(
        "LOT_EXPIRY_AMBIGUOUS",
        "Medication lot expiry data is ambiguous",
        orderItemId,
      );
    }
    if (
      lots.every(
        (lot) =>
          Boolean(lot.expiryAt) &&
          (lot.expiryAt?.getTime() ?? 0) <= now.getTime(),
      )
    ) {
      return this.blocker(
        "LOT_EXPIRED",
        "All verified medication lots are expired",
        orderItemId,
      );
    }
    return this.blocker(
      "INSUFFICIENT_STOCK",
      "No eligible medication lot has enough current stock",
      orderItemId,
    );
  }

  private verifyPreflightToken(
    token: string,
    evaluation: ReleaseEvaluation,
    scope: RequestScope,
    now: Date,
  ): void {
    const payload = this.readPreflightToken(token, backendEnv().JWT_SECRET);
    if (payload.expiresAtMs <= now.getTime()) {
      this.throwConflict(
        "PREFLIGHT_EXPIRED",
        "The release preflight token expired; run preflight again",
      );
    }
    if (
      payload.clinicId !== scope.clinicId ||
      payload.branchId !== scope.branchId ||
      payload.encounterId !== evaluation.encounter.encounter_id ||
      payload.orderId !== evaluation.order.order_id ||
      payload.snapshotHash !== evaluation.snapshotHash ||
      payload.safetySnapshotHash !== evaluation.result.safety.safetySnapshotHash
    ) {
      this.throwConflict(
        "PREFLIGHT_STALE",
        "The order, price, lot, stock, or safety snapshot changed; run preflight again",
      );
    }
  }

  private issuePreflightToken(
    payload: PreflightTokenPayload,
    secret: string,
  ): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  private readPreflightToken(
    token: string,
    secret: string,
  ): PreflightTokenPayload {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      this.throwConflict("PREFLIGHT_INVALID", "The preflight token is invalid");
    }
    const encoded = parts[0];
    const signature = Buffer.from(parts[1], "base64url");
    const expected = createHmac("sha256", secret).update(encoded).digest();
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    ) {
      this.throwConflict("PREFLIGHT_INVALID", "The preflight token is invalid");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      this.throwConflict("PREFLIGHT_INVALID", "The preflight token is invalid");
    }
    if (!this.isPreflightTokenPayload(parsed)) {
      this.throwConflict("PREFLIGHT_INVALID", "The preflight token is invalid");
    }
    return parsed;
  }

  private isPreflightTokenPayload(
    value: unknown,
  ): value is PreflightTokenPayload {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    return (
      "version" in value &&
      value.version === 1 &&
      "clinicId" in value &&
      typeof value.clinicId === "string" &&
      "branchId" in value &&
      typeof value.branchId === "string" &&
      "encounterId" in value &&
      typeof value.encounterId === "string" &&
      "orderId" in value &&
      typeof value.orderId === "string" &&
      "snapshotHash" in value &&
      typeof value.snapshotHash === "string" &&
      "safetySnapshotHash" in value &&
      typeof value.safetySnapshotHash === "string" &&
      "expiresAtMs" in value &&
      typeof value.expiresAtMs === "number"
    );
  }

  private async replayRelease(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    orderId: string,
    scope: RequestScope,
  ): Promise<OpdOrderReleaseResult> {
    this.assertReplayClaim(claim, requestHash, "release");
    const release = await this.repository.findReleaseByOrder(
      encounterId,
      orderId,
      scope,
    );
    if (!release || release.release_id !== claim.resource_id) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The saved medication release result cannot be replayed",
      );
    }
    return toOpdOrderReleaseResult(release);
  }

  private async replayVoid(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    orderId: string,
    scope: RequestScope,
  ): Promise<VoidOpdOrderReleaseResult> {
    this.assertReplayClaim(claim, requestHash, "void");
    const release = await this.repository.findReleaseByOrder(
      encounterId,
      orderId,
      scope,
    );
    if (!release || release.release_id !== claim.resource_id) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The saved medication-release void result cannot be replayed",
      );
    }
    return toVoidOpdOrderReleaseResult(release);
  }

  private assertReplayClaim(
    claim: api_idempotency,
    requestHash: string,
    operationLabel: string,
  ): void {
    if (claim.request_hash !== requestHash) {
      this.throwConflict(
        "IDEMPOTENCY_KEY_REUSED",
        `Idempotency-Key was already used with a different ${operationLabel} request`,
      );
    }
    if (claim.state !== "COMPLETED") {
      this.throwConflict(
        "IDEMPOTENCY_IN_PROGRESS",
        `The medication-release ${operationLabel} request is already in progress`,
      );
    }
  }

  private progressionBlockers(progression: {
    prescriptionStatus: string | null;
    saleOrderStatus: string | null;
    saleRecordStatus: string | null;
    receiptCount: number;
    inventoryMovementCount: number;
    customerCourseCount: number;
    saleDocumentCount: number;
    saleUserCount: number;
  }): string[] {
    const blockers: string[] = [];
    if (progression.prescriptionStatus !== "WAITING") {
      blockers.push("PRESCRIPTION_PROGRESS");
    }
    if (
      progression.saleOrderStatus !== "PENDING" ||
      progression.saleRecordStatus !== "ACTIVE"
    ) {
      blockers.push("SALE_ORDER_PROGRESS");
    }
    if (progression.receiptCount > 0)
      blockers.push("RECEIPT_OR_PAYMENT_EXISTS");
    if (progression.inventoryMovementCount > 0) {
      blockers.push("INVENTORY_MOVEMENT_EXISTS");
    }
    if (progression.customerCourseCount > 0) {
      blockers.push("COURSE_ENTITLEMENT_EXISTS");
    }
    if (progression.saleDocumentCount > 0) {
      blockers.push("SALE_DOCUMENT_EXISTS");
    }
    if (progression.saleUserCount > 0) {
      blockers.push("SALE_BENEFICIARY_EXISTS");
    }
    return blockers;
  }

  private releaseRequestHash(
    encounterId: string,
    orderId: string,
    dto: ReleaseOpdOrderDto,
  ): string {
    return this.sha256(
      JSON.stringify({
        operation: RELEASE_OPERATION,
        encounterId,
        orderId,
        expectedOrderVersion: dto.expectedOrderVersion,
        itemVersions: this.sortedItemVersions(dto.itemVersions),
        selectedLots: this.sortedLotSelections(dto.selectedLots),
        safetySnapshotHash: dto.safetyAcknowledgement.safetySnapshotHash,
        preflightTokenHash: this.sha256(dto.preflightToken),
      }),
    );
  }

  private sortedItemVersions(
    values: OpdOrderItemVersionDto[],
  ): OpdOrderItemVersionDto[] {
    return [...values].sort((left, right) =>
      left.orderItemId.localeCompare(right.orderItemId),
    );
  }

  private sortedLotSelections(
    values: OpdOrderLotSelectionDto[],
  ): OpdOrderLotSelectionDto[] {
    return values
      .map((value) => ({
        orderItemId: value.orderItemId,
        lotId: value.lotId.trim(),
      }))
      .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
  }

  private itemVersionManifest(
    items: OpdOrderRecord["items"],
  ): Prisma.InputJsonArray {
    return items
      .filter((item) => item.status === "ACTIVE")
      .map((item) => ({
        orderItemId: item.order_item_id,
        version: item.version,
      }))
      .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
  }

  private releaseResultSnapshot(
    result: OpdOrderReleaseResult,
  ): Prisma.InputJsonObject {
    return {
      releaseId: result.releaseId,
      encounterId: result.encounterId,
      orderId: result.orderId,
      orderStatus: result.orderStatus,
      orderVersion: result.orderVersion,
      prescriptionId: result.prescriptionId,
      prescriptionStatus: result.prescriptionStatus,
      saleOrderId: result.saleOrderId,
      saleOrderStatus: result.saleOrderStatus,
      subtotalAmount: result.totals.subtotalAmount,
      promotionDiscountAmount: result.totals.promotionDiscountAmount,
      taxAmount: result.totals.taxAmount,
      netTotalAmount: result.totals.netTotalAmount,
      safetySnapshotHash: result.safetySnapshotHash,
      releasedAt: result.releasedAt,
    };
  }

  private voidResultSnapshot(
    result: VoidOpdOrderReleaseResult,
  ): Prisma.InputJsonObject {
    return {
      releaseId: result.releaseId,
      encounterId: result.encounterId,
      orderId: result.orderId,
      orderStatus: result.orderStatus,
      orderVersion: result.orderVersion,
      prescriptionId: result.prescriptionId,
      prescriptionStatus: result.prescriptionStatus,
      saleOrderId: result.saleOrderId,
      saleOrderStatus: result.saleOrderStatus,
      reason: result.reason,
      voidedBy: result.voidedBy,
      voidedAt: result.voidedAt,
    };
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const key = value?.trim() ?? "";
    if (key.length < 8 || key.length > 200) {
      throw new BadRequestException(
        "Idempotency-Key header must contain 8 to 200 characters",
      );
    }
    return key;
  }

  private dedupeBlockers(blockers: OpdReleaseBlocker[]): OpdReleaseBlocker[] {
    const seen = new Set<string>();
    return blockers.filter((blocker) => {
      const key = `${blocker.code}:${blocker.orderItemId ?? "ORDER"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private blocker(
    code: OpdReleaseBlockerCode,
    message: string,
    orderItemId: string | null = null,
    expectedVersion: number | null = null,
    currentVersion: number | null = null,
  ): OpdReleaseBlocker {
    return {
      code,
      message,
      orderItemId,
      expectedVersion,
      currentVersion,
    };
  }

  private requireExpiry(lot: OpdReleaseLotRecord): Date {
    if (!lot.expiryAt) throw new Error("Eligible lot is missing its expiry");
    return lot.expiryAt;
  }

  private decimalNumber(value: Prisma.Decimal): number {
    const parsed = Number(value.toString());
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid decimal in OPD medication release");
    }
    return parsed;
  }

  private sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private actorRole(scope: RequestScope): string | undefined {
    return (
      scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined)
    );
  }

  private throwOrderConflict(order: OpdOrderRecord): never {
    throw new VersionConflictException({
      resourceType: "OPD_ORDER",
      resourceId: order.order_id,
      currentVersion: order.version,
      currentStatus: order.status,
      updatedAt: order.updated_at.toISOString(),
    });
  }

  private throwConflict(
    code: string,
    message: string,
    details?: Prisma.JsonObject,
  ): never {
    throw new ConflictException({
      message,
      code,
      ...(details ? { details } : {}),
    });
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException("OPD encounter not found in the active scope");
  }

  private throwOrderNotFound(): never {
    throw new NotFoundException("OPD order not found in the active scope");
  }

  private throwReleaseNotFound(): never {
    throw new NotFoundException(
      "OPD order release not found in the active scope",
    );
  }
}

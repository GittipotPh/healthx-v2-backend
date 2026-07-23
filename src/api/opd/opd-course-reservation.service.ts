import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  auditReferenceType,
  record_status,
  sale_order_status,
  type api_idempotency,
  type opd,
  type opd_encounter,
} from "@prisma/client";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { backendEnv } from "../../env";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type {
  CreateOpdCourseReservationDto,
  OpdCourseEntitlementSelectionDto,
  OpdCourseReservationPreflightDto,
  QueryOpdCourseEntitlementsDto,
  VoidOpdCourseReservationDto,
} from "./dto/opd-course-reservation.dto";
import {
  OPD_COURSE_RESERVATION_POLICY,
  OPD_COURSE_RESERVATION_VOID_PERMISSIONS,
  OPD_COURSE_RESERVATION_WRITE_PERMISSIONS,
  type OpdCourseEntitlementListResult,
  type OpdCourseEntitlementView,
  type OpdCourseReservationBlocker,
  type OpdCourseReservationBlockerCode,
  type OpdCourseReservationComponentView,
  type OpdCourseReservationPreflightItemView,
  type OpdCourseReservationPreflightResult,
  type OpdCourseReservationRecord,
  type OpdCourseReservationResult,
  type OpdCurrentCourseReservationResult,
  type OpdCourseOperatorSummaryView,
  toOpdCourseReservationResult,
} from "./opd-course-reservation.mapper";
import {
  type CourseComponentLotRecord,
  type CourseEntitlementIdentity,
  type CourseEntitlementRecord,
  type CourseOperatorAssignment,
  type CreateCourseReservationInput,
  type LegacyCourseReservationState,
  OpdCourseReservationRepository,
  type PreparedCourseComponent,
  type PreparedCourseOperator,
  type PreparedCourseReservationItem,
} from "./opd-course-reservation.repository";
import {
  OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS,
  OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS,
  OPD_COURSE_EVIDENCE_READ_PERMISSIONS,
  OPD_COURSE_VERIFY_PERMISSIONS,
} from "./opd-course-verification.mapper";

interface EntitlementTokenPayload {
  version: 1;
  clinicId: string;
  purchaseBranchId: string;
  customerId: string;
  saleOrderId: string;
  courseItemId: string;
  entitlementExpireAt: string;
}

interface CoursePreflightTokenPayload {
  version: 1;
  clinicId: string;
  branchId: string;
  encounterId: string;
  customerId: string;
  actorUserId: string;
  snapshotHash: string;
  expiresAtMs: number;
}

interface BaseEntitlementEvaluation {
  identity: CourseEntitlementIdentity;
  record: CourseEntitlementRecord;
  token: string;
  amount: Prisma.Decimal;
  reserved: Prisma.Decimal;
  used: Prisma.Decimal;
  remaining: Prisma.Decimal;
  blockers: OpdCourseReservationBlocker[];
}

interface EvaluatedComponent {
  prepared: Omit<PreparedCourseComponent, "reservationComponentId"> | null;
  view: OpdCourseReservationComponentView;
}

interface EvaluatedOperator {
  prepared: Omit<PreparedCourseOperator, "reservationOperatorId">;
  view: OpdCourseOperatorSummaryView;
}

interface EvaluatedReservationItem {
  base: BaseEntitlementEvaluation;
  quantity: Prisma.Decimal;
  afterRemaining: Prisma.Decimal;
  components: EvaluatedComponent[];
  operators: EvaluatedOperator[];
  view: OpdCourseReservationPreflightItemView;
  sourceSnapshotHash: string;
}

interface ReservationEvaluation {
  encounter: opd_encounter;
  legacyOpd: opd | null;
  blockers: OpdCourseReservationBlocker[];
  items: EvaluatedReservationItem[];
  snapshotHash: string;
  result: OpdCourseReservationPreflightResult;
}

const RESERVE_OPERATION = "opd.course-entitlement.reserve.v1";
const VOID_OPERATION = "opd.course-entitlement-reservation.void.v1";
const PREFLIGHT_TTL_MS = 5 * 60_000;
const ZERO = new Prisma.Decimal(0);

@Injectable()
export class OpdCourseReservationService {
  constructor(
    private readonly repository: OpdCourseReservationRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async entitlements(
    encounterId: string,
    query: QueryOpdCourseEntitlementsDto,
    scope: RequestScope,
  ): Promise<OpdCourseEntitlementListResult> {
    const encounter = await this.requireEncounter(encounterId, scope);
    const now = new Date();
    const [legacyOpd, activeReservation, page] = await Promise.all([
      this.repository.findLegacyOpd(encounter, scope),
      this.repository.findActiveReservation(encounterId, scope),
      this.repository.listEntitlements(
        encounter.customer_id,
        query.page,
        query.pageSize,
        scope,
      ),
    ]);
    const globalBlockers = this.globalBlockers(
      encounter,
      legacyOpd,
      activeReservation,
      this.capabilityEnabled(),
    );
    const items = await Promise.all(
      page.rows.map(async (record): Promise<OpdCourseEntitlementView> => {
        const token = this.issueEntitlementToken(
          record,
          backendEnv().JWT_SECRET,
        );
        const base = await this.evaluateBaseEntitlement(
          record,
          token,
          encounter,
          scope,
          now,
        );
        const blockers = this.dedupeBlockers([
          ...globalBlockers,
          ...base.blockers,
        ]);
        return {
          entitlementToken: token,
          purchaseBranchId: record.branch_id,
          saleOrderId: record.sale_order_id,
          saleOrderStatus: record.sale_order.sale_order_status,
          courseId: record.course_item.course_id,
          courseCode: record.course_item.course.course_id_display,
          courseName: record.course_item.course.course_name,
          courseItemId: record.item_id,
          itemName: record.course_item.name,
          unit: record.course_item.unit,
          entitlementExpireAt: record.expire_date.toISOString(),
          displayExpireAt: record.expire_date_display?.toISOString() ?? null,
          balance: {
            purchased: this.decimalNumber(base.amount),
            reserved: this.decimalNumber(base.reserved),
            used: this.decimalNumber(base.used),
            remaining: this.decimalNumber(base.remaining),
          },
          components: record.course_item.course_item_product.map(
            (component) => ({
              productId: component.product_id,
              productCode: component.product.product_id_display,
              productName: component.product.product_name,
              unit: component.product.unit,
              quantityPerSession: this.decimalNumber(component.quantity),
            }),
          ),
          eligible: blockers.length === 0,
          excludedByPolicy: blockers.some((blocker) =>
            [
              "COURSE_ENTITLEMENT_BRANCH_UNSUPPORTED",
              "COURSE_ENTITLEMENT_PAYMENT_REQUIRED",
            ].includes(blocker.code),
          ),
          blockers,
        };
      }),
    );
    return {
      capabilityEnabled: this.capabilityEnabled(),
      policy: OPD_COURSE_RESERVATION_POLICY,
      samePurchaseBranchOnly: true,
      fullyPaidOnly: true,
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
    };
  }

  async preflight(
    encounterId: string,
    dto: OpdCourseReservationPreflightDto,
    scope: RequestScope,
  ): Promise<OpdCourseReservationPreflightResult> {
    return this.prisma.$transaction(
      async (tx) =>
        (
          await this.evaluateSelections(
            encounterId,
            dto.selections,
            scope,
            new Date(),
            tx,
          )
        ).result,
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  async reserve(
    encounterId: string,
    dto: CreateOpdCourseReservationDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdCourseReservationResult> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = this.reserveRequestHash(encounterId, dto);
    return this.reserveWithRetry(
      encounterId,
      dto,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  async current(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdCurrentCourseReservationResult> {
    const encounter = await this.requireEncounter(encounterId, scope);
    const verificationCapabilityEnabled =
      this.capabilityEnabled() && backendEnv().OPD_COURSE_VERIFICATION_ENABLED;
    const capabilityPermissions = [
      ...new Set([
        ...OPD_COURSE_VERIFY_PERMISSIONS,
        ...OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS,
        ...OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS,
        ...OPD_COURSE_EVIDENCE_READ_PERMISSIONS,
      ]),
    ];
    const [record, effectivePermissions] = await Promise.all([
      this.repository.findLatestReservation(encounterId, scope),
      this.repository.findEffectivePermissions(capabilityPermissions, scope),
    ]);
    const hasAll = (permissions: readonly string[]): boolean =>
      permissions.every((permission) => effectivePermissions.has(permission));
    const canVerify = hasAll(OPD_COURSE_VERIFY_PERMISSIONS);
    const canRequestCompensation = hasAll(
      OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS,
    );
    const canReviewCompensation = hasAll(
      OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS,
    );
    const canReadEvidence = hasAll(OPD_COURSE_EVIDENCE_READ_PERMISSIONS);
    if (!record) {
      return {
        capabilityEnabled: this.capabilityEnabled(),
        reservation: null,
        voidAllowed: false,
        voidBlockers: ["NO_RESERVATION"],
        verificationCapabilityEnabled,
        verificationAllowed: false,
        verificationBlockers: ["NO_RESERVATION"],
        compensationRequestAllowed: false,
        compensationBlockers: ["NO_VERIFICATION"],
        compensationReviewAllowed: false,
        compensationReviewBlockers: ["NO_PENDING_COMPENSATION"],
        evidenceReadAllowed: canReadEvidence,
      };
    }
    const state = await this.repository.loadLegacyState(record, scope);
    const voidBlockers = this.voidBlockers(record, state);
    if (!this.capabilityEnabled()) {
      voidBlockers.unshift("COURSE_RESERVATION_DISABLED");
    }
    const verificationBlockers: string[] = [];
    if (!verificationCapabilityEnabled) {
      verificationBlockers.push("COURSE_VERIFICATION_DISABLED");
    }
    if (!canVerify) {
      verificationBlockers.push("COURSE_VERIFICATION_PERMISSION_REQUIRED");
    }
    if (record.status !== "RESERVED") {
      verificationBlockers.push(
        record.verification
          ? "COURSE_ALREADY_VERIFIED"
          : "COURSE_RESERVATION_NOT_RESERVED",
      );
    }
    if (
      !(
        (encounter.workflow_status === "OPEN" &&
          encounter.clinical_record_status === "DRAFT") ||
        (encounter.workflow_status === "POST_VISIT" &&
          encounter.clinical_record_status === "FINALIZED")
      )
    ) {
      verificationBlockers.push("COURSE_ENCOUNTER_STATE_UNSUPPORTED");
    }
    if (
      record.status === "RESERVED" &&
      this.voidBlockers(record, state).length > 0
    ) {
      verificationBlockers.push("COURSE_LEGACY_STATE_MISMATCH");
    }
    const compensationBlockers: string[] = [];
    if (!verificationCapabilityEnabled) {
      compensationBlockers.push("COURSE_VERIFICATION_DISABLED");
    }
    if (!canRequestCompensation) {
      compensationBlockers.push("COURSE_COMPENSATION_PERMISSION_REQUIRED");
    }
    if (record.status !== "USED" || !record.verification) {
      compensationBlockers.push("COURSE_COMPENSATION_NOT_ALLOWED");
    }
    if (
      encounter.workflow_status === "CLOSED" ||
      encounter.workflow_status === "CANCELLED"
    ) {
      compensationBlockers.push("COURSE_ENCOUNTER_STATE_UNSUPPORTED");
    }
    if (
      record.verification?.compensation_requests.some(
        (request) => request.status === "PENDING",
      )
    ) {
      compensationBlockers.push("COURSE_CANCELLATION_PENDING");
    }
    const reservation = toOpdCourseReservationResult(record);
    const pendingCompensation =
      record.verification?.compensation_requests.find(
        (request) => request.status === "PENDING",
      ) ?? null;
    const compensationReviewBlockers: string[] = [];
    if (!verificationCapabilityEnabled) {
      compensationReviewBlockers.push("COURSE_VERIFICATION_DISABLED");
    }
    if (!canReviewCompensation) {
      compensationReviewBlockers.push(
        "COURSE_COMPENSATION_REVIEW_PERMISSION_REQUIRED",
      );
    }
    if (
      record.status !== "USED" ||
      !record.verification ||
      !pendingCompensation
    ) {
      compensationReviewBlockers.push("NO_PENDING_COMPENSATION");
    }
    if (
      encounter.workflow_status === "CLOSED" ||
      encounter.workflow_status === "CANCELLED"
    ) {
      compensationReviewBlockers.push("COURSE_ENCOUNTER_STATE_UNSUPPORTED");
    }
    await Promise.all(
      record.items.map(async (item, index) => {
        const identity: CourseEntitlementIdentity = {
          clinicId: scope.clinicId,
          purchaseBranchId: item.purchase_branch_id,
          customerId: item.customer_id,
          saleOrderId: item.sale_order_id,
          courseItemId: item.course_item_id,
          entitlementExpireAt: item.entitlement_expire_at,
        };
        const balance = await this.repository.usageBalance(identity);
        const purchased = item.entitlement_amount;
        const remaining = purchased.minus(balance.reserved).minus(balance.used);
        const view = reservation.items[index];
        if (view) {
          view.currentReserved = this.decimalNumber(balance.reserved);
          view.currentUsed = this.decimalNumber(balance.used);
          view.currentRemaining = this.decimalNumber(remaining);
        }
      }),
    );
    return {
      capabilityEnabled: this.capabilityEnabled(),
      reservation,
      voidAllowed: voidBlockers.length === 0,
      voidBlockers,
      verificationCapabilityEnabled,
      verificationAllowed: verificationBlockers.length === 0,
      verificationBlockers: [...new Set(verificationBlockers)],
      compensationRequestAllowed: compensationBlockers.length === 0,
      compensationBlockers: [...new Set(compensationBlockers)],
      compensationReviewAllowed: compensationReviewBlockers.length === 0,
      compensationReviewBlockers: [...new Set(compensationReviewBlockers)],
      evidenceReadAllowed: canReadEvidence,
    };
  }

  async voidReservation(
    encounterId: string,
    reservationId: string,
    dto: VoidOpdCourseReservationDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdCourseReservationResult> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException("A void reason is required");
    const requestHash = this.sha256(
      JSON.stringify({
        operation: VOID_OPERATION,
        encounterId,
        reservationId,
        expectedVersion: dto.expectedVersion,
        reason,
      }),
    );
    return this.voidWithRetry(
      encounterId,
      reservationId,
      dto.expectedVersion,
      reason,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  private async reserveWithRetry(
    encounterId: string,
    dto: CreateOpdCourseReservationDto,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<OpdCourseReservationResult> {
    const existing = await this.repository.findIdempotency(
      RESERVE_OPERATION,
      idempotencyKey,
      scope,
    );
    if (existing) {
      return this.replayReservation(existing, requestHash, encounterId, scope);
    }
    this.assertCapabilityEnabled();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const reservationId = randomUUID();
          const claim = await this.repository.createIdempotency(
            {
              operation: RESERVE_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_COURSE_RESERVATION",
              resourceId: reservationId,
            },
            scope,
            now,
            tx,
          );
          if (!(await this.repository.lockEncounter(encounterId, scope, tx))) {
            this.throwEncounterNotFound();
          }
          const encounter = await this.requireEncounter(encounterId, scope, tx);
          if (!(await this.repository.lockLegacyOpd(encounter, scope, tx))) {
            this.throwConflict(
              "LEGACY_OPD_REQUIRED",
              "The scoped legacy OPD row is required before course reservation",
            );
          }
          const activeReservationId =
            await this.repository.lockActiveReservation(encounterId, scope, tx);
          if (activeReservationId) {
            this.throwConflict(
              "COURSE_RESERVATION_EXISTS",
              "This encounter already has an active course reservation",
              { reservationId: activeReservationId },
            );
          }
          const identities = dto.selections.map((selection) =>
            this.identityFromToken(selection.entitlementToken, scope),
          );
          const locked = await this.repository.lockEntitlements(identities, tx);
          if (locked !== identities.length) {
            this.throwConflict(
              "COURSE_ENTITLEMENT_NOT_FOUND",
              "One or more selected course entitlements are unavailable",
            );
          }
          const evaluation = await this.evaluateSelections(
            encounterId,
            dto.selections,
            scope,
            now,
            tx,
          );
          this.assertEvaluationEligible(evaluation);
          this.verifyPreflightToken(dto.preflightToken, evaluation, scope, now);
          if (!evaluation.legacyOpd) {
            throw new Error(
              "Eligible course reservation is missing its legacy OPD",
            );
          }
          const legacyServiceUsageId =
            await this.repository.allocateServiceUsageNumber(scope, now, tx);
          const preparedItems: PreparedCourseReservationItem[] =
            evaluation.items.map((item, index) => ({
              reservationItemId: randomUUID(),
              legacyServiceUsageItemId: randomUUID(),
              legacyUsageLogId: randomUUID(),
              displayOrder: index + 1,
              purchaseBranchId: item.base.record.branch_id,
              customerId: item.base.record.customer_id,
              saleOrderId: item.base.record.sale_order_id,
              courseId: item.base.record.course_item.course_id,
              courseItemId: item.base.record.item_id,
              courseCode: item.base.record.course_item.course.course_id_display,
              courseName: item.base.record.course_item.course.course_name,
              itemName: item.base.record.course_item.name,
              unit: item.base.record.course_item.unit,
              entitlementExpireAt: item.base.record.expire_date,
              displayExpireAt: this.requireDisplayExpiry(item.base.record),
              entitlementAmount: item.base.amount,
              beforeReservedAmount: item.base.reserved,
              beforeUsedAmount: item.base.used,
              beforeRemainingAmount: item.base.remaining,
              reservedAmount: item.quantity,
              afterRemainingAmount: item.afterRemaining,
              entitlementCreatedAt: item.base.record.created_at,
              entitlementUpdatedAt: item.base.record.updated_at,
              saleOrderUpdatedAt: item.base.record.sale_order.updated_at,
              courseUpdatedAt: item.base.record.course_item.course.updated_at,
              courseItemUpdatedAt: item.base.record.course_item.updated_at,
              sourceSnapshotHash: item.sourceSnapshotHash,
              components: item.components.map((component) => {
                if (!component.prepared) {
                  throw new Error(
                    "Eligible component is missing its selected lot",
                  );
                }
                return {
                  ...component.prepared,
                  reservationComponentId: randomUUID(),
                };
              }),
              operators: item.operators.map((operator) => ({
                ...operator.prepared,
                reservationOperatorId: randomUUID(),
              })),
            }));
          const input: CreateCourseReservationInput = {
            reservationId,
            encounterId,
            customerId: encounter.customer_id,
            legacyOpdId: evaluation.legacyOpd.opd_id,
            legacyServiceUsageId,
            requestHash,
            idempotencyKeyHash: this.sha256(idempotencyKey),
            sourceEncounterVersion: encounter.version,
            sourceBalanceManifest: preparedItems.map((item) => ({
              purchaseBranchId: item.purchaseBranchId,
              saleOrderId: item.saleOrderId,
              courseItemId: item.courseItemId,
              entitlementExpireAt: item.entitlementExpireAt.toISOString(),
              purchased: item.entitlementAmount.toString(),
              reservedBefore: item.beforeReservedAmount.toString(),
              usedBefore: item.beforeUsedAmount.toString(),
              remainingBefore: item.beforeRemainingAmount.toString(),
              reservedNow: item.reservedAmount.toString(),
              remainingAfter: item.afterRemainingAmount.toString(),
              sourceSnapshotHash: item.sourceSnapshotHash,
            })),
            items: preparedItems,
          };
          await this.repository.createReservation(input, scope, now, tx);
          await this.auditLogService.create(
            {
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              referenceType: auditReferenceType.OPD,
              referenceId: encounterId,
              action: "course.entitlement.reserve",
              actionLabel: "Reserve existing course entitlement",
              fromStatus: "DRAFT",
              toStatus: "RESERVED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                reservationId,
                legacyServiceUsageId,
                itemCount: preparedItems.length,
                quantities: preparedItems.map((item) => ({
                  courseItemId: item.courseItemId,
                  purchased: item.entitlementAmount.toString(),
                  reservedBefore: item.beforeReservedAmount.toString(),
                  usedBefore: item.beforeUsedAmount.toString(),
                  remainingBefore: item.beforeRemainingAmount.toString(),
                  reservedNow: item.reservedAmount.toString(),
                  remainingAfter: item.afterRemainingAmount.toString(),
                })),
                permissionPath: [...OPD_COURSE_RESERVATION_WRITE_PERMISSIONS],
                sourceSnapshotHashes: preparedItems.map(
                  (item) => item.sourceSnapshotHash,
                ),
                courseUsed: false,
                componentStockReserved: false,
                componentStockDeducted: false,
              },
            },
            tx,
          );
          const record = await this.repository.findReservation(
            encounterId,
            reservationId,
            scope,
            tx,
          );
          if (!record)
            throw new Error("Course reservation could not be reloaded");
          const result = toOpdCourseReservationResult(record);
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            reservationId,
            this.resultSnapshot(result),
            201,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 20_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          RESERVE_OPERATION,
          idempotencyKey,
          scope,
        );
        if (replay) {
          return this.replayReservation(
            replay,
            requestHash,
            encounterId,
            scope,
          );
        }
        const active = await this.repository.findActiveReservation(
          encounterId,
          scope,
        );
        if (active) {
          this.throwConflict(
            "COURSE_RESERVATION_EXISTS",
            "This encounter was reserved concurrently",
          );
        }
      }
      if (
        canRetrySerialization &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.reserveWithRetry(
          encounterId,
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
    reservationId: string,
    expectedVersion: number,
    reason: string,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<OpdCourseReservationResult> {
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
        reservationId,
        scope,
      );
    }
    this.assertCapabilityEnabled();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            {
              operation: VOID_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_COURSE_RESERVATION_VOID",
              resourceId: reservationId,
            },
            scope,
            now,
            tx,
          );
          if (!(await this.repository.lockEncounter(encounterId, scope, tx))) {
            this.throwEncounterNotFound();
          }
          if (
            !(await this.repository.lockReservation(
              encounterId,
              reservationId,
              scope,
              tx,
            ))
          ) {
            this.throwReservationNotFound();
          }
          const record = await this.repository.findReservation(
            encounterId,
            reservationId,
            scope,
            tx,
          );
          if (!record) this.throwReservationNotFound();
          if (
            record.status !== "RESERVED" ||
            record.version !== expectedVersion
          ) {
            this.throwConflict(
              record.status === "VOIDED"
                ? "COURSE_RESERVATION_ALREADY_VOIDED"
                : "COURSE_RESERVATION_VERSION_CONFLICT",
              record.status === "VOIDED"
                ? "This course reservation is already voided"
                : "The course reservation changed after it was loaded",
              { currentVersion: record.version, currentStatus: record.status },
            );
          }
          await this.repository.lockLegacyState(record, scope, tx);
          const state = await this.repository.loadLegacyState(
            record,
            scope,
            tx,
          );
          const blockers = this.voidBlockers(record, state);
          if (blockers.length > 0) {
            this.throwConflict(
              "COMPENSATION_REQUIRED",
              "This reservation has progressed or diverged and requires manual compensation",
              { blockers },
            );
          }
          await this.repository.voidReservation(
            record,
            expectedVersion,
            reason,
            scope,
            now,
            tx,
          );
          await this.auditLogService.create(
            {
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              referenceType: auditReferenceType.OPD,
              referenceId: encounterId,
              action: "course.entitlement-reservation.void",
              actionLabel: "Void existing course reservation",
              fromStatus: "RESERVED",
              toStatus: "VOIDED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                reservationId,
                legacyServiceUsageId: record.legacy_service_usage_id,
                reason,
                restoredReservedLogs: record.items.length,
                sourceVersion: expectedVersion,
                resultVersion: expectedVersion + 1,
                permissionPath: [...OPD_COURSE_RESERVATION_VOID_PERMISSIONS],
                courseUsed: false,
                inventoryChanged: false,
              },
            },
            tx,
          );
          const voided = await this.repository.findReservation(
            encounterId,
            reservationId,
            scope,
            tx,
          );
          if (!voided)
            throw new Error("Voided course reservation could not be reloaded");
          const result = toOpdCourseReservationResult(voided);
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            reservationId,
            this.resultSnapshot(result),
            200,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 20_000,
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
            reservationId,
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
          reservationId,
          expectedVersion,
          reason,
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

  private async evaluateSelections(
    encounterId: string,
    selections: OpdCourseEntitlementSelectionDto[],
    scope: RequestScope,
    now: Date,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<ReservationEvaluation> {
    const encounter = await this.requireEncounter(encounterId, scope, client);
    const [legacyOpd, activeReservation, assignments] = await Promise.all([
      this.repository.findLegacyOpd(encounter, scope, client),
      this.repository.findActiveReservation(encounterId, scope, client),
      this.repository.operatorAssignments(encounter, scope, client),
    ]);
    const blockers = this.globalBlockers(
      encounter,
      legacyOpd,
      activeReservation,
      this.capabilityEnabled(),
    );
    const items: EvaluatedReservationItem[] = [];
    for (const selection of selections) {
      let identity: CourseEntitlementIdentity;
      try {
        identity = this.identityFromToken(selection.entitlementToken, scope);
      } catch {
        blockers.push(
          this.blocker(
            "COURSE_ENTITLEMENT_NOT_FOUND",
            "The selected entitlement token is invalid or out of scope",
            selection.entitlementToken,
          ),
        );
        continue;
      }
      if (identity.customerId !== encounter.customer_id) {
        blockers.push(
          this.blocker(
            "COURSE_ENTITLEMENT_CUSTOMER_MISMATCH",
            "The selected entitlement does not belong to this encounter customer",
            selection.entitlementToken,
          ),
        );
        continue;
      }
      const record = await this.repository.findEntitlement(identity, client);
      if (!record) {
        blockers.push(
          this.blocker(
            "COURSE_ENTITLEMENT_NOT_FOUND",
            "The selected entitlement no longer exists",
            selection.entitlementToken,
          ),
        );
        continue;
      }
      const base = await this.evaluateBaseEntitlement(
        record,
        selection.entitlementToken,
        encounter,
        scope,
        now,
        client,
      );
      blockers.push(...base.blockers);
      const quantity = new Prisma.Decimal(selection.quantity);
      if (
        !Number.isInteger(selection.quantity) ||
        selection.quantity <= 0 ||
        !quantity.equals(quantity.floor())
      ) {
        blockers.push(
          this.blocker(
            "COURSE_QUANTITY_INVALID",
            "Course quantity must be a positive whole number",
            selection.entitlementToken,
          ),
        );
      }
      if (quantity.greaterThan(base.remaining)) {
        blockers.push(
          this.blocker(
            "COURSE_BALANCE_INSUFFICIENT",
            "The requested sessions exceed the authoritative remaining balance",
            selection.entitlementToken,
          ),
        );
      }
      const components = await this.evaluateComponents(
        record,
        quantity,
        selection,
        scope,
        now,
        client,
        blockers,
      );
      const operators = this.evaluateOperators(
        record,
        assignments,
        selection.entitlementToken,
        blockers,
      );
      const afterRemaining = base.remaining.minus(quantity);
      const sourceSnapshot = {
        identity: this.identityJson(base.identity),
        entitlementAmount: base.amount.toString(),
        reserved: base.reserved.toString(),
        used: base.used.toString(),
        remaining: base.remaining.toString(),
        quantity: quantity.toString(),
        afterRemaining: afterRemaining.toString(),
        entitlementUpdatedAt: record.updated_at?.toISOString() ?? null,
        saleOrderUpdatedAt: record.sale_order.updated_at?.toISOString() ?? null,
        courseUpdatedAt: record.course_item.course.updated_at.toISOString(),
        courseItemUpdatedAt: record.course_item.updated_at.toISOString(),
        components: components.map((component) => ({
          productId: component.view.productId,
          configuredQuantity: component.view.quantityPerSession,
          requiredQuantity: component.view.requiredQuantity,
          selectedLotId: component.view.selectedLotId,
          selectedExpiryAt: component.view.selectedExpiryAt,
          stock: component.prepared?.stockObservedQuantity.toString() ?? null,
        })),
        operators: operators.map((operator) => ({
          userId: operator.prepared.userId,
          roleId: operator.prepared.roleId,
          operatorType: operator.prepared.operatorType,
          commissionAmount: operator.prepared.commissionAmount.toString(),
          commissionUnit: operator.prepared.commissionUnit,
        })),
      };
      const sourceSnapshotHash = this.sha256(this.stableJson(sourceSnapshot));
      const view: OpdCourseReservationPreflightItemView = {
        entitlementToken: selection.entitlementToken,
        courseCode: record.course_item.course.course_id_display,
        courseName: record.course_item.course.course_name,
        itemName: record.course_item.name,
        quantity: selection.quantity,
        before: {
          purchased: this.decimalNumber(base.amount),
          reserved: this.decimalNumber(base.reserved),
          used: this.decimalNumber(base.used),
          remaining: this.decimalNumber(base.remaining),
        },
        remainingAfterReservation: this.decimalNumber(afterRemaining),
        components: components.map((component) => component.view),
        operators: operators.map((operator) => operator.view),
      };
      items.push({
        base,
        quantity,
        afterRemaining,
        components,
        operators,
        view,
        sourceSnapshotHash,
      });
    }
    const dedupedBlockers = this.dedupeBlockers(blockers);
    const snapshotHash = this.sha256(
      this.stableJson({
        policy: OPD_COURSE_RESERVATION_POLICY,
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        encounterId,
        customerId: encounter.customer_id,
        actorUserId: scope.userId,
        encounterVersion: encounter.version,
        legacyOpdId: legacyOpd?.opd_id ?? null,
        legacyManagementItem: legacyOpd?.management_item ?? null,
        items: items
          .map((item) => ({
            tokenHash: this.sha256(item.base.token),
            sourceSnapshotHash: item.sourceSnapshotHash,
          }))
          .sort((left, right) => left.tokenHash.localeCompare(right.tokenHash)),
      }),
    );
    const eligible =
      dedupedBlockers.length === 0 && items.length === selections.length;
    const expiresAt = eligible
      ? new Date(now.getTime() + PREFLIGHT_TTL_MS)
      : null;
    const preflightToken = expiresAt
      ? this.issueSignedToken(
          {
            version: 1,
            clinicId: scope.clinicId,
            branchId: scope.branchId,
            encounterId,
            customerId: encounter.customer_id,
            actorUserId: scope.userId,
            snapshotHash,
            expiresAtMs: expiresAt.getTime(),
          } satisfies CoursePreflightTokenPayload,
          backendEnv().JWT_SECRET,
        )
      : null;
    return {
      encounter,
      legacyOpd,
      blockers: dedupedBlockers,
      items,
      snapshotHash,
      result: {
        capabilityEnabled: this.capabilityEnabled(),
        eligible,
        blockers: dedupedBlockers,
        items: items.map((item) => item.view),
        requiredPermissions: [...OPD_COURSE_RESERVATION_WRITE_PERMISSIONS],
        preflightToken,
        expiresAt: expiresAt?.toISOString() ?? null,
        courseBalanceReserved: false,
        componentStockReserved: false,
      },
    };
  }

  private async evaluateBaseEntitlement(
    record: CourseEntitlementRecord,
    token: string,
    encounter: opd_encounter,
    scope: RequestScope,
    now: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<BaseEntitlementEvaluation> {
    const identity = this.identityFromRecord(record);
    const [logicalCount, usage] = await Promise.all([
      this.repository.countLogicalEntitlements(identity, client),
      this.repository.usageBalance(identity, client),
    ]);
    const amount = record.amount ?? ZERO;
    const remaining = amount.minus(usage.reserved).minus(usage.used);
    const blockers: OpdCourseReservationBlocker[] = [];
    if (
      record.clinic_id !== scope.clinicId ||
      record.sale_order.clinic_id !== scope.clinicId
    ) {
      blockers.push(
        this.blocker(
          "COURSE_ENTITLEMENT_SCOPE_MISMATCH",
          "The entitlement is outside the active clinic scope",
          token,
        ),
      );
    }
    if (
      record.customer_id !== encounter.customer_id ||
      record.sale_order.customer_id !== encounter.customer_id
    ) {
      blockers.push(
        this.blocker(
          "COURSE_ENTITLEMENT_CUSTOMER_MISMATCH",
          "The entitlement owner and encounter customer must match",
          token,
        ),
      );
    }
    if (record.branch_id !== scope.branchId) {
      blockers.push(
        this.blocker(
          "COURSE_ENTITLEMENT_BRANCH_UNSUPPORTED",
          "This first release supports only the entitlement purchase branch",
          token,
        ),
      );
    }
    if (
      record.sale_order.status !== record_status.ACTIVE ||
      record.sale_order.sale_order_status !== sale_order_status.PAID
    ) {
      blockers.push(
        this.blocker(
          "COURSE_ENTITLEMENT_PAYMENT_REQUIRED",
          "Only ACTIVE, fully PAID course entitlements are eligible",
          token,
        ),
      );
    }
    if (
      !record.expire_date_display ||
      record.expire_date_display.getTime() <= now.getTime()
    ) {
      blockers.push(
        this.blocker(
          "COURSE_ENTITLEMENT_EXPIRED",
          "The display expiry must be present and later than the reservation time",
          token,
        ),
      );
    }
    if (
      logicalCount !== 1 ||
      !amount.isPositive() ||
      !amount.equals(amount.floor()) ||
      usage.reserved.isNegative() ||
      usage.used.isNegative() ||
      remaining.isNegative()
    ) {
      blockers.push(
        this.blocker(
          "COURSE_BALANCE_INCONSISTENT",
          "The legacy entitlement identity or balance is ambiguous or inconsistent",
          token,
        ),
      );
    }
    return {
      identity,
      record,
      token,
      amount,
      reserved: usage.reserved,
      used: usage.used,
      remaining,
      blockers,
    };
  }

  private async evaluateComponents(
    record: CourseEntitlementRecord,
    quantity: Prisma.Decimal,
    selection: OpdCourseEntitlementSelectionDto,
    scope: RequestScope,
    now: Date,
    client: Prisma.TransactionClient | PrismaService,
    blockers: OpdCourseReservationBlocker[],
  ): Promise<EvaluatedComponent[]> {
    const selected = new Map(
      (selection.components ?? []).map((component) => [
        component.productId.trim(),
        component.lotId.trim(),
      ]),
    );
    const configuredIds = new Set(
      record.course_item.course_item_product.map(
        (component) => component.product_id,
      ),
    );
    for (const productId of selected.keys()) {
      if (!configuredIds.has(productId)) {
        blockers.push(
          this.blocker(
            "COURSE_COMPONENT_LOT_INVALID",
            "A selected component is not configured for this course item",
            selection.entitlementToken,
            productId,
          ),
        );
      }
    }
    const evaluations: EvaluatedComponent[] = [];
    const configured = [...record.course_item.course_item_product].sort(
      (left, right) => left.product_id.localeCompare(right.product_id),
    );
    for (const component of configured) {
      const required = component.quantity.mul(quantity);
      const lots = await this.repository.findLots(
        component.product_id,
        scope,
        client,
      );
      const selectedLotId = selected.get(component.product_id) ?? null;
      const selectedLot = selectedLotId
        ? (lots.find((lot) => lot.lotId === selectedLotId) ?? null)
        : null;
      if (!component.quantity.isPositive() || !required.isPositive()) {
        blockers.push(
          this.blocker(
            "COURSE_BALANCE_INCONSISTENT",
            "A configured course component has a non-positive quantity",
            selection.entitlementToken,
            component.product_id,
          ),
        );
      } else if (!selectedLotId) {
        blockers.push(
          this.blocker(
            "COURSE_COMPONENT_LOT_REQUIRED",
            "Select one current-branch lot for every configured component",
            selection.entitlementToken,
            component.product_id,
          ),
        );
      } else if (
        component.product.status !== record_status.ACTIVE ||
        !selectedLot ||
        selectedLot.expiryCount !== 1 ||
        !selectedLot.expiryAt ||
        selectedLot.expiryAt.getTime() <= now.getTime()
      ) {
        blockers.push(
          this.blocker(
            "COURSE_COMPONENT_LOT_INVALID",
            "The selected component lot or expiry is unavailable",
            selection.entitlementToken,
            component.product_id,
          ),
        );
      } else if (selectedLot.inStock.lessThan(required)) {
        blockers.push(
          this.blocker(
            "COURSE_COMPONENT_STOCK_CHANGED",
            "The selected component lot no longer has enough observed stock",
            selection.entitlementToken,
            component.product_id,
          ),
        );
      }
      const prepared =
        selectedLot &&
        selectedLot.expiryCount === 1 &&
        selectedLot.expiryAt &&
        selectedLot.expiryAt.getTime() > now.getTime() &&
        selectedLot.inStock.greaterThanOrEqualTo(required)
          ? {
              productId: component.product_id,
              productCode: component.product.product_id_display,
              productName: component.product.product_name,
              unit: component.product.unit,
              configuredQuantity: component.quantity,
              totalQuantity: required,
              lotId: selectedLot.lotId,
              expiryAt: selectedLot.expiryAt,
              stockObservedQuantity: selectedLot.inStock,
              sourceUpdatedAt:
                selectedLot.inventoryUpdatedAt ?? component.product.updated_at,
            }
          : null;
      evaluations.push({
        prepared,
        view: {
          productId: component.product_id,
          productCode: component.product.product_id_display,
          productName: component.product.product_name,
          unit: component.product.unit,
          quantityPerSession: this.decimalNumber(component.quantity),
          requiredQuantity: this.decimalNumber(required),
          selectedLotId,
          selectedExpiryAt: selectedLot?.expiryAt?.toISOString() ?? null,
          candidateLots: lots.map((lot) => ({
            lotId: lot.lotId,
            expiryAt: lot.expiryAt?.toISOString() ?? null,
            availableQuantity: this.decimalNumber(lot.inStock),
            eligible: this.lotEligible(lot, required, now),
          })),
        },
      });
    }
    return evaluations;
  }

  private evaluateOperators(
    record: CourseEntitlementRecord,
    assignments: CourseOperatorAssignment[],
    token: string,
    blockers: OpdCourseReservationBlocker[],
  ): EvaluatedOperator[] {
    const rules = [...record.course_item.course.course_operator].sort(
      (left, right) =>
        `${left.role_id}|${left.operator_type}`.localeCompare(
          `${right.role_id}|${right.operator_type}`,
        ),
    );
    return rules.flatMap((rule) => {
      const matches = assignments.filter(
        (assignment) =>
          assignment.roleId === rule.role_id &&
          assignment.operatorType === rule.operator_type,
      );
      if (matches.length !== 1) {
        blockers.push(
          this.blocker(
            "COURSE_OPERATOR_UNRESOLVED",
            "Each configured course operator rule must resolve to exactly one active appointment assignment",
            token,
          ),
        );
        return [];
      }
      const assignment = matches[0];
      return [
        {
          prepared: {
            userId: assignment.userId,
            roleId: rule.role_id,
            operatorType: rule.operator_type,
            commissionAmount: rule.commission,
            commissionUnit: rule.commission_unit,
            sourceUserUpdatedAt: assignment.userUpdatedAt,
          },
          view: {
            userId: assignment.userId,
            displayName: assignment.displayName,
            roleId: rule.role_id,
            operatorType: rule.operator_type,
          },
        },
      ];
    });
  }

  private globalBlockers(
    encounter: opd_encounter,
    legacyOpd: opd | null,
    activeReservation: OpdCourseReservationRecord | null,
    capabilityEnabled: boolean,
  ): OpdCourseReservationBlocker[] {
    const blockers: OpdCourseReservationBlocker[] = [];
    if (!capabilityEnabled) {
      blockers.push(
        this.blocker(
          "COURSE_RESERVATION_DISABLED",
          "Existing-course reservation is disabled by the server rollout gate",
        ),
      );
    }
    if (encounter.workflow_status !== "OPEN") {
      blockers.push(
        this.blocker("ENCOUNTER_NOT_OPEN", "The encounter must remain OPEN"),
      );
    }
    if (encounter.clinical_record_status !== "DRAFT") {
      blockers.push(
        this.blocker(
          "CLINICAL_RECORD_NOT_DRAFT",
          "The clinical record must remain DRAFT",
        ),
      );
    }
    if (!legacyOpd) {
      blockers.push(
        this.blocker(
          "LEGACY_OPD_REQUIRED",
          "A scoped legacy OPD compatibility row is required",
        ),
      );
    } else {
      if (
        legacyOpd.status_opd !== "PENDING" ||
        legacyOpd.customer_id !== encounter.customer_id
      ) {
        blockers.push(
          this.blocker(
            "LEGACY_OPD_MISMATCH",
            "The legacy OPD state does not match this open encounter",
          ),
        );
      }
      if (
        legacyOpd.management_item &&
        legacyOpd.management_item !== activeReservation?.legacy_service_usage_id
      ) {
        blockers.push(
          this.blocker(
            "LEGACY_SERVICE_USAGE_EXISTS",
            "The legacy OPD already points to another service usage",
          ),
        );
      }
    }
    if (activeReservation) {
      blockers.push(
        this.blocker(
          "COURSE_RESERVATION_EXISTS",
          "This encounter already has an active course reservation",
        ),
      );
    }
    return blockers;
  }

  private voidBlockers(
    record: OpdCourseReservationRecord,
    state: LegacyCourseReservationState,
  ): string[] {
    const blockers: string[] = [];
    if (record.status !== "RESERVED") blockers.push("RESERVATION_NOT_ACTIVE");
    const usage = state.serviceUsage;
    if (!usage) return [...blockers, "MISSING_SERVICE_USAGE"];
    if (
      usage.status !== "ACTIVE" ||
      usage.service_usage_status !== "PENDING" ||
      usage.customer_id !== record.customer_id ||
      usage.customer_owner_id !== record.customer_id ||
      usage.verify_at ||
      usage.verify_by ||
      usage.document_url
    ) {
      blockers.push("SERVICE_USAGE_PROGRESSED_OR_MISMATCHED");
    }
    if (usage.service_usage_request_cancel) {
      blockers.push("CANCELLATION_REQUEST_EXISTS");
    }
    if (state.inventoryMovementCount > 0) {
      blockers.push("INVENTORY_MOVEMENT_EXISTS");
    }
    if (state.legacyOpd?.management_item !== record.legacy_service_usage_id) {
      blockers.push("OPD_LINK_MISMATCH");
    }
    if (state.usageLogs.length !== record.items.length) {
      blockers.push("USAGE_LOG_COUNT_MISMATCH");
    }
    for (const item of record.items) {
      const log = state.usageLogs.find(
        (candidate) => candidate.id === item.legacy_usage_log_id,
      );
      if (
        !log ||
        log.status !== "RESERVED" ||
        log.service_usage_id !== record.legacy_service_usage_id ||
        log.customer_id !== record.customer_id ||
        log.item_id !== item.course_item_id ||
        !log.amount?.equals(item.reserved_amount) ||
        log.expire_date.getTime() !== item.entitlement_expire_at.getTime() ||
        log.course_usage_type !== "SERVICE_USAGE"
      ) {
        blockers.push(`USAGE_LOG_MISMATCH:${item.reservation_item_id}`);
      }
      const legacyItem = usage.service_usage_item.find(
        (candidate) =>
          candidate.service_usage_item_id === item.legacy_service_usage_item_id,
      );
      if (
        !legacyItem ||
        legacyItem.course_id !== item.course_item_id ||
        legacyItem.item_id !== null ||
        !legacyItem.quantity?.equals(item.reserved_amount) ||
        legacyItem.expire_date?.getTime() !==
          item.entitlement_expire_at.getTime()
      ) {
        blockers.push(
          `SERVICE_USAGE_ITEM_MISMATCH:${item.reservation_item_id}`,
        );
        continue;
      }
      if (
        legacyItem.service_usage_item_product.length !== item.components.length
      ) {
        blockers.push(`COMPONENT_COUNT_MISMATCH:${item.reservation_item_id}`);
      }
      for (const component of item.components) {
        const legacyComponent = legacyItem.service_usage_item_product.find(
          (candidate) => candidate.item_id === component.product_id,
        );
        if (
          !legacyComponent ||
          legacyComponent.lot_id !== component.lot_id ||
          !legacyComponent.quantity.equals(component.total_quantity)
        ) {
          blockers.push(
            `COMPONENT_MISMATCH:${component.reservation_component_id}`,
          );
        }
      }
      if (
        legacyItem.service_usage_item_commission.length !==
        item.operators.length
      ) {
        blockers.push(`COMMISSION_COUNT_MISMATCH:${item.reservation_item_id}`);
      }
      for (const operator of item.operators) {
        const commission = legacyItem.service_usage_item_commission.find(
          (candidate) =>
            candidate.role === operator.role_id &&
            candidate.operator_type === operator.operator_type,
        );
        if (
          !commission ||
          !commission.commission.equals(operator.commission_amount) ||
          commission.unit !== operator.commission_unit
        ) {
          blockers.push(
            `COMMISSION_MISMATCH:${operator.reservation_operator_id}`,
          );
        }
      }
    }
    if (usage.service_usage_item.length !== record.items.length) {
      blockers.push("SERVICE_USAGE_ITEM_COUNT_MISMATCH");
    }
    const expectedOperatorUsers = new Set(
      record.items.flatMap((item) =>
        item.operators.map(
          (operator) => `${operator.user_id}|${operator.operator_type}`,
        ),
      ),
    );
    const actualOperatorUsers = new Set(
      usage.course_operator_user.map(
        (operator) => `${operator.user_id}|${operator.operator_type}`,
      ),
    );
    if (
      expectedOperatorUsers.size !== actualOperatorUsers.size ||
      [...expectedOperatorUsers].some(
        (value) => !actualOperatorUsers.has(value),
      )
    ) {
      blockers.push("OPERATOR_ASSIGNMENT_MISMATCH");
    }
    return [...new Set(blockers)];
  }

  private assertEvaluationEligible(evaluation: ReservationEvaluation): void {
    if (evaluation.result.eligible) return;
    this.throwConflict(
      "COURSE_REPREFLIGHT_REQUIRED",
      "The course entitlement, balance, component, or operator snapshot no longer passes preflight",
      {
        blockers: evaluation.blockers.map((blocker) => ({
          code: blocker.code,
          entitlementTokenHash: blocker.entitlementToken
            ? this.sha256(blocker.entitlementToken)
            : null,
          productId: blocker.productId,
        })),
      },
    );
  }

  private verifyPreflightToken(
    token: string,
    evaluation: ReservationEvaluation,
    scope: RequestScope,
    now: Date,
  ): void {
    let payload: unknown;
    try {
      payload = this.readSignedToken(token, backendEnv().JWT_SECRET);
    } catch {
      this.throwConflict(
        "COURSE_REPREFLIGHT_REQUIRED",
        "The preflight token is invalid",
      );
    }
    if (!this.isPreflightTokenPayload(payload)) {
      this.throwConflict(
        "COURSE_REPREFLIGHT_REQUIRED",
        "The preflight token is invalid",
      );
    }
    if (payload.expiresAtMs <= now.getTime()) {
      this.throwConflict(
        "COURSE_REPREFLIGHT_REQUIRED",
        "The course preflight token expired; run preflight again",
      );
    }
    if (
      payload.clinicId !== scope.clinicId ||
      payload.branchId !== scope.branchId ||
      payload.encounterId !== evaluation.encounter.encounter_id ||
      payload.customerId !== evaluation.encounter.customer_id ||
      payload.actorUserId !== scope.userId ||
      payload.snapshotHash !== evaluation.snapshotHash
    ) {
      this.throwConflict(
        "COURSE_REPREFLIGHT_REQUIRED",
        "The course balance, component lot, stock, operator, or source snapshot changed",
      );
    }
  }

  private async replayReservation(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdCourseReservationResult> {
    this.assertReplayClaim(claim, requestHash, "reservation");
    if (!claim.resource_id) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The saved course reservation result cannot be replayed",
      );
    }
    const record = await this.repository.findReservation(
      encounterId,
      claim.resource_id,
      scope,
    );
    if (!record) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The saved course reservation result cannot be replayed",
      );
    }
    return toOpdCourseReservationResult(record);
  }

  private async replayVoid(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    reservationId: string,
    scope: RequestScope,
  ): Promise<OpdCourseReservationResult> {
    this.assertReplayClaim(claim, requestHash, "void");
    const record = await this.repository.findReservation(
      encounterId,
      reservationId,
      scope,
    );
    if (!record || record.reservation_id !== claim.resource_id) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The saved course-reservation void result cannot be replayed",
      );
    }
    return toOpdCourseReservationResult(record);
  }

  private assertReplayClaim(
    claim: api_idempotency,
    requestHash: string,
    label: string,
  ): void {
    if (claim.request_hash !== requestHash) {
      this.throwConflict(
        "IDEMPOTENCY_KEY_REUSED",
        `Idempotency-Key was already used with a different ${label} request`,
      );
    }
    if (claim.state !== "COMPLETED") {
      this.throwConflict(
        "IDEMPOTENCY_IN_PROGRESS",
        `The course-reservation ${label} request is already in progress`,
      );
    }
  }

  private identityFromRecord(
    record: CourseEntitlementRecord,
  ): CourseEntitlementIdentity {
    return {
      clinicId: record.clinic_id,
      purchaseBranchId: record.branch_id,
      customerId: record.customer_id,
      saleOrderId: record.sale_order_id,
      courseItemId: record.item_id,
      entitlementExpireAt: record.expire_date,
    };
  }

  private identityFromToken(
    token: string,
    scope: RequestScope,
  ): CourseEntitlementIdentity {
    const value = this.readSignedToken(token, backendEnv().JWT_SECRET);
    if (
      !this.isEntitlementTokenPayload(value) ||
      value.clinicId !== scope.clinicId
    ) {
      throw new Error("Invalid entitlement token");
    }
    const entitlementExpireAt = new Date(value.entitlementExpireAt);
    if (Number.isNaN(entitlementExpireAt.getTime())) {
      throw new Error("Invalid entitlement expiry");
    }
    return {
      clinicId: value.clinicId,
      purchaseBranchId: value.purchaseBranchId,
      customerId: value.customerId,
      saleOrderId: value.saleOrderId,
      courseItemId: value.courseItemId,
      entitlementExpireAt,
    };
  }

  private issueEntitlementToken(
    record: CourseEntitlementRecord,
    secret: string,
  ): string {
    return this.issueSignedToken(
      {
        version: 1,
        clinicId: record.clinic_id,
        purchaseBranchId: record.branch_id,
        customerId: record.customer_id,
        saleOrderId: record.sale_order_id,
        courseItemId: record.item_id,
        entitlementExpireAt: record.expire_date.toISOString(),
      } satisfies EntitlementTokenPayload,
      secret,
    );
  }

  private issueSignedToken(payload: object, secret: string): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  private readSignedToken(token: string, secret: string): unknown {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error("Invalid signed token");
    }
    const signature = Buffer.from(parts[1], "base64url");
    const expected = createHmac("sha256", secret).update(parts[0]).digest();
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    ) {
      throw new Error("Invalid signed token");
    }
    return JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as unknown;
  }

  private isEntitlementTokenPayload(
    value: unknown,
  ): value is EntitlementTokenPayload {
    return (
      this.isRecord(value) &&
      value.version === 1 &&
      typeof value.clinicId === "string" &&
      typeof value.purchaseBranchId === "string" &&
      typeof value.customerId === "string" &&
      typeof value.saleOrderId === "string" &&
      typeof value.courseItemId === "string" &&
      typeof value.entitlementExpireAt === "string"
    );
  }

  private isPreflightTokenPayload(
    value: unknown,
  ): value is CoursePreflightTokenPayload {
    return (
      this.isRecord(value) &&
      value.version === 1 &&
      typeof value.clinicId === "string" &&
      typeof value.branchId === "string" &&
      typeof value.encounterId === "string" &&
      typeof value.customerId === "string" &&
      typeof value.actorUserId === "string" &&
      typeof value.snapshotHash === "string" &&
      typeof value.expiresAtMs === "number"
    );
  }

  private reserveRequestHash(
    encounterId: string,
    dto: CreateOpdCourseReservationDto,
  ): string {
    return this.sha256(
      this.stableJson({
        operation: RESERVE_OPERATION,
        encounterId,
        selections: dto.selections
          .map((selection) => ({
            entitlementTokenHash: this.sha256(selection.entitlementToken),
            quantity: selection.quantity,
            components: (selection.components ?? [])
              .map((component) => ({
                productId: component.productId.trim(),
                lotId: component.lotId.trim(),
              }))
              .sort((left, right) =>
                left.productId.localeCompare(right.productId),
              ),
          }))
          .sort((left, right) =>
            left.entitlementTokenHash.localeCompare(right.entitlementTokenHash),
          ),
        preflightTokenHash: this.sha256(dto.preflightToken),
      }),
    );
  }

  private resultSnapshot(
    result: OpdCourseReservationResult,
  ): Prisma.InputJsonObject {
    return {
      reservationId: result.reservationId,
      encounterId: result.encounterId,
      status: result.status,
      version: result.version,
      legacyServiceUsageId: result.legacyServiceUsageId,
      legacyServiceUsageStatus: result.legacyServiceUsageStatus,
      itemCount: result.items.length,
      reservedAt: result.reservedAt,
      voidedAt: result.voidedAt,
    };
  }

  private identityJson(identity: CourseEntitlementIdentity): object {
    return {
      clinicId: identity.clinicId,
      purchaseBranchId: identity.purchaseBranchId,
      customerId: identity.customerId,
      saleOrderId: identity.saleOrderId,
      courseItemId: identity.courseItemId,
      entitlementExpireAt: identity.entitlementExpireAt.toISOString(),
    };
  }

  private lotEligible(
    lot: CourseComponentLotRecord,
    required: Prisma.Decimal,
    now: Date,
  ): boolean {
    return (
      lot.expiryCount === 1 &&
      Boolean(lot.expiryAt && lot.expiryAt.getTime() > now.getTime()) &&
      lot.inStock.greaterThanOrEqualTo(required)
    );
  }

  private requireDisplayExpiry(record: CourseEntitlementRecord): Date {
    if (!record.expire_date_display) {
      throw new Error("Eligible entitlement is missing its display expiry");
    }
    return record.expire_date_display;
  }

  private async requireEncounter(
    encounterId: string,
    scope: RequestScope,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_encounter> {
    const encounter = await this.repository.findEncounter(
      encounterId,
      scope,
      client,
    );
    if (!encounter) this.throwEncounterNotFound();
    return encounter;
  }

  private capabilityEnabled(): boolean {
    return backendEnv().OPD_COURSE_RESERVATION_ENABLED;
  }

  private assertCapabilityEnabled(): void {
    if (this.capabilityEnabled()) return;
    this.throwConflict(
      "COURSE_RESERVATION_DISABLED",
      "Existing-course reservation is disabled by the server rollout gate",
    );
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

  private blocker(
    code: OpdCourseReservationBlockerCode,
    message: string,
    entitlementToken: string | null = null,
    productId: string | null = null,
  ): OpdCourseReservationBlocker {
    return { code, message, entitlementToken, productId };
  }

  private dedupeBlockers(
    blockers: OpdCourseReservationBlocker[],
  ): OpdCourseReservationBlocker[] {
    const seen = new Set<string>();
    return blockers.filter((blocker) => {
      const key = `${blocker.code}|${blocker.entitlementToken ?? ""}|${blocker.productId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private stableJson(value: unknown): string {
    if (value === null || typeof value !== "object")
      return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`)
      .join(",")}}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private decimalNumber(value: Prisma.Decimal): number {
    const parsed = Number(value.toString());
    if (!Number.isFinite(parsed))
      throw new Error("Invalid course balance decimal");
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

  private throwReservationNotFound(): never {
    throw new NotFoundException(
      "OPD course reservation not found in the active scope",
    );
  }
}

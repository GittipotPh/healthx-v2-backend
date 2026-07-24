import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  auditReferenceType,
  document_key,
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
import {
  StorageService,
  type StorageProvider,
  type StoredObject,
} from "../../common/storage/storage.service";
import { backendEnv } from "../../env";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type {
  OpdCourseVerificationLotSelectionDto,
  OpdCourseVerificationPreflightDto,
  RequestOpdCourseCompensationDto,
  ReviewOpdCourseCompensationDto,
  VerifyOpdCourseReservationDto,
} from "./dto/opd-course-verification.dto";
import {
  normalizeCourseVerificationSignature,
  renderCourseVerificationPdf,
  type CourseVerificationPdfInput,
  type NormalizedSignature,
} from "./opd-course-verification-evidence";
import {
  OPD_COURSE_ACKNOWLEDGEMENT_TEXT,
  OPD_COURSE_ACKNOWLEDGEMENT_VERSION,
  OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS,
  OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS,
  OPD_COURSE_VERIFICATION_MANIFEST_SCHEMA,
  OPD_COURSE_VERIFICATION_RENDER_TEMPLATE,
  OPD_COURSE_VERIFY_PERMISSIONS,
  type OpdCourseCompensationResult,
  type OpdCourseVerificationBlockerCode,
  type OpdCourseVerificationBlockerView,
  type OpdCourseVerificationComponentView,
  type OpdCourseVerificationDocumentResult,
  type OpdCourseVerificationItemView,
  type OpdCourseVerificationOperatorView,
  type OpdCourseVerificationPreflightResult,
  type OpdCourseVerificationRecord,
  type OpdCourseVerificationResult,
  toOpdCourseCompensationRequestView,
  toOpdCourseVerificationSummary,
} from "./opd-course-verification.mapper";
import type { OpdCourseReservationRecord } from "./opd-course-reservation.mapper";
import {
  type CourseEntitlementIdentity,
  type LegacyCourseReservationState,
  OpdCourseReservationRepository,
} from "./opd-course-reservation.repository";
import {
  type CourseCompensationComponentEffect,
  type CourseVerificationComponentEffect,
  type CourseVerificationDisplayContext,
  type CourseVerificationInventorySnapshot,
  OpdCourseVerificationRepository,
  type StoredCourseVerificationEvidence,
} from "./opd-course-verification.repository";

function requireStorageProvider(value: string): StorageProvider {
  if (value === "minio" || value === "azure") {
    return value;
  }
  throw new Error(`Unsupported course evidence storage provider: ${value}`);
}

type DatabaseClient = Prisma.TransactionClient | PrismaService;
type ReservationItem = OpdCourseReservationRecord["items"][number];
type ReservationComponent = ReservationItem["components"][number];

interface VerificationTokenSelection {
  reservationComponentId: string;
  lotId: string;
  replacementReason: string | null;
}

interface VerificationPreflightTokenPayload {
  version: 1;
  clinicId: string;
  branchId: string;
  actorUserId: string;
  encounterId: string;
  reservationId: string;
  customerId: string;
  expectedVersion: number;
  snapshotHash: string;
  selections: VerificationTokenSelection[];
  issuedAtMs: number;
  expiresAtMs: number;
}

interface EvaluatedVerificationComponent {
  item: ReservationItem;
  component: ReservationComponent;
  legacyComponentId: number | null;
  selected: CourseVerificationInventorySnapshot | null;
  selection: VerificationTokenSelection;
  blockers: OpdCourseVerificationBlockerView[];
  view: OpdCourseVerificationComponentView;
}

interface VerificationEvaluation {
  encounter: opd_encounter;
  record: OpdCourseReservationRecord;
  state: LegacyCourseReservationState;
  display: CourseVerificationDisplayContext;
  components: EvaluatedVerificationComponent[];
  itemViews: OpdCourseVerificationItemView[];
  operatorViews: OpdCourseVerificationOperatorView[];
  blockers: OpdCourseVerificationBlockerView[];
  snapshot: Prisma.InputJsonObject;
  snapshotHash: string;
  result: OpdCourseVerificationPreflightResult;
}

interface VerificationClaimAcquired {
  kind: "acquired";
  claim: api_idempotency;
  verificationId: string;
}

interface VerificationClaimReplay {
  kind: "replay";
  result: OpdCourseVerificationResult;
}

type VerificationClaimResult =
  | VerificationClaimAcquired
  | VerificationClaimReplay;

interface StagedEvidence {
  evidence: StoredCourseVerificationEvidence;
  signatureObject: StoredObject;
  pdfObject: StoredObject;
}

interface VerificationCommandContext {
  token: VerificationPreflightTokenPayload;
  evaluation: VerificationEvaluation;
  signature: NormalizedSignature;
  requestHash: string;
  acknowledgementHash: string;
  verifiedAt: Date;
  verificationManifest: Prisma.InputJsonObject;
  manifestHash: string;
}

const VERIFY_OPERATION = "opd.course-verification.verify.v1";
const COMPENSATION_REQUEST_OPERATION =
  "opd.course-verification.compensation-request.v1";
const COMPENSATION_REJECT_OPERATION =
  "opd.course-verification.compensation-reject.v1";
const COMPENSATION_APPROVE_OPERATION =
  "opd.course-verification.compensation-approve.v1";
const PREFLIGHT_TTL_MS = 5 * 60_000;
const SIGNATURE_LIMIT_BYTES = 1024 * 1024;
const ZERO = new Prisma.Decimal(0);

@Injectable()
export class OpdCourseVerificationService {
  private readonly logger = new Logger(OpdCourseVerificationService.name);

  constructor(
    private readonly repository: OpdCourseVerificationRepository,
    private readonly reservationRepository: OpdCourseReservationRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly storageService: StorageService,
  ) {}

  async preflight(
    encounterId: string,
    reservationId: string,
    dto: OpdCourseVerificationPreflightDto,
    scope: RequestScope,
  ): Promise<OpdCourseVerificationPreflightResult> {
    return this.prisma.$transaction(
      async (tx) =>
        (
          await this.evaluate(
            encounterId,
            reservationId,
            dto.expectedVersion,
            this.normalizeSelections(dto.componentSelections),
            scope,
            new Date(),
            tx,
            true,
          )
        ).result,
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 20_000,
      },
    );
  }

  async verify(
    encounterId: string,
    reservationId: string,
    dto: VerifyOpdCourseReservationDto,
    signatureFile: Express.Multer.File | undefined,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
    network: { clientIp?: string; userAgent?: string },
  ): Promise<OpdCourseVerificationResult> {
    this.assertCapabilityEnabled();
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const token = this.verifyPreflightToken(dto.preflightToken, {
      encounterId,
      reservationId,
      expectedVersion: dto.expectedVersion,
      scope,
    });
    if (dto.acknowledgementVersion !== OPD_COURSE_ACKNOWLEDGEMENT_VERSION) {
      this.throwConflict(
        "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED",
        "The acknowledgement version changed; run a fresh preflight",
      );
    }
    const signature = this.normalizeSignature(signatureFile);
    const acknowledgementText =
      OPD_COURSE_ACKNOWLEDGEMENT_TEXT[dto.acknowledgementLocale];
    const acknowledgementHash = this.sha256(
      this.stableJson({
        version: dto.acknowledgementVersion,
        locale: dto.acknowledgementLocale,
        text: acknowledgementText,
      }),
    );
    const requestHash = this.sha256(
      this.stableJson({
        operation: VERIFY_OPERATION,
        encounterId,
        reservationId,
        expectedVersion: dto.expectedVersion,
        preflightSnapshotHash: token.snapshotHash,
        acknowledgementVersion: dto.acknowledgementVersion,
        acknowledgementLocale: dto.acknowledgementLocale,
        acknowledgementHash,
        signatureHash: signature.hash,
      }),
    );
    const claim = await this.acquireVerificationClaim(
      idempotencyKey,
      requestHash,
      reservationId,
      scope,
    );
    if (claim.kind === "replay") return claim.result;

    let staged: StagedEvidence | null = null;
    try {
      const verifiedAt = new Date();
      const evaluation = await this.prisma.$transaction(
        (tx) =>
          this.evaluate(
            encounterId,
            reservationId,
            dto.expectedVersion,
            token.selections,
            scope,
            verifiedAt,
            tx,
            false,
          ),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 5_000,
          timeout: 20_000,
        },
      );
      if (evaluation.record.verification) {
        throw new ConflictException({
          code: "COURSE_ALREADY_VERIFIED",
          message: "This reservation already has one committed verification",
          current: this.verificationResult(
            evaluation.record,
            evaluation.record.verification,
          ),
        });
      }
      if (token.expiresAtMs <= Date.now()) {
        this.throwConflict(
          "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED",
          "The verification preflight token expired",
        );
      }
      if (
        evaluation.snapshotHash !== token.snapshotHash ||
        !evaluation.result.eligible
      ) {
        this.throwConflict(
          "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED",
          "The course, lot, stock, balance, or operator state changed",
          { blockers: evaluation.blockers },
        );
      }
      const verificationManifest = this.verificationManifest(
        evaluation,
        verifiedAt,
        signature.hash,
        acknowledgementHash,
        dto.acknowledgementVersion,
        dto.acknowledgementLocale,
      );
      const manifestHash = this.sha256(this.stableJson(verificationManifest));
      const context: VerificationCommandContext = {
        token,
        evaluation,
        signature,
        requestHash,
        acknowledgementHash,
        verifiedAt,
        verificationManifest,
        manifestHash,
      };
      const pdf = this.renderPdf(
        context,
        claim.verificationId,
        principal,
        acknowledgementText,
      );
      staged = await this.stageEvidence(
        claim.verificationId,
        context,
        pdf,
        scope,
      );
      return await this.commitVerificationWithRetry(
        claim,
        context,
        staged.evidence,
        idempotencyKey,
        scope,
        principal,
        {
          clientIp: network.clientIp?.slice(0, 64) ?? null,
          userAgentHash: network.userAgent
            ? this.sha256(network.userAgent.slice(0, 2000))
            : null,
        },
        true,
      );
    } catch (error) {
      if (staged) await this.cleanupStagedEvidence(staged);
      await this.repository.failVerificationClaim(
        claim.claim.api_idempotency_id,
        requestHash,
        new Date(),
      );
      this.rethrowCommandError(error);
    }
  }

  async requestCompensation(
    encounterId: string,
    reservationId: string,
    dto: RequestOpdCourseCompensationDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdCourseCompensationResult> {
    this.assertCapabilityEnabled();
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const reasonCode = dto.reasonCode.trim();
    const description = dto.description.trim();
    const requestHash = this.sha256(
      this.stableJson({
        operation: COMPENSATION_REQUEST_OPERATION,
        encounterId,
        reservationId,
        expectedVersion: dto.expectedVersion,
        reasonCode,
        description,
      }),
    );
    return this.runCourseCommandWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const replay = await this.commandReplay(
            COMPENSATION_REQUEST_OPERATION,
            idempotencyKey,
            requestHash,
            scope,
            tx,
          );
          if (replay) return replay;
          await this.lockCourseAggregate(encounterId, reservationId, scope, tx);
          const encounter = await this.requireEncounter(encounterId, scope, tx);
          const record = await this.requireReservation(
            encounterId,
            reservationId,
            scope,
            tx,
          );
          const verification = record.verification;
          if (
            record.status !== "USED" ||
            record.version !== dto.expectedVersion ||
            !verification
          ) {
            this.throwConflict(
              "COURSE_COMPENSATION_NOT_ALLOWED",
              "Only the exact current USED reservation can request compensation",
            );
          }
          this.assertEncounterCompensable(encounter);
          if (
            verification.compensation_requests.some(
              (request) =>
                request.status === "PENDING" || request.status === "APPROVED",
            )
          ) {
            this.throwConflict(
              "COURSE_CANCELLATION_PENDING",
              "A compensation request already exists for this verification",
            );
          }
          const state = await this.reservationRepository.loadLegacyState(
            record,
            scope,
            tx,
          );
          this.assertUsedLegacyState(record, verification, state, false);
          if (!(await this.repository.reasonExists(reasonCode, tx))) {
            throw new BadRequestException({
              code: "COURSE_COMPENSATION_REASON_INVALID",
              message: "The selected compensation reason is unavailable",
            });
          }
          const requestId = randomUUID();
          const now = new Date();
          const claim = await this.reservationRepository.createIdempotency(
            {
              operation: COMPENSATION_REQUEST_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_COURSE_COMPENSATION_REQUEST",
              resourceId: requestId,
            },
            scope,
            now,
            tx,
          );
          await this.repository.createCompensationRequest(
            {
              requestId,
              verification,
              reasonCode,
              description,
              sourceReservationVersion: dto.expectedVersion,
              requestHash,
              idempotencyKeyHash: this.sha256(idempotencyKey),
            },
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
              action: "course.compensation.request",
              actionLabel: "Request verified course compensation",
              fromStatus: "USED",
              toStatus: "USED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                reservationId,
                verificationId: verification.verification_id,
                compensationRequestId: requestId,
                reasonCode,
                sourceVersion: dto.expectedVersion,
                permissionPath: [
                  ...OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS,
                ],
                requestHash,
                balanceChanged: false,
                inventoryChanged: false,
              },
            },
            tx,
          );
          const result = await this.compensationResult(
            encounterId,
            reservationId,
            requestId,
            scope,
            tx,
          );
          await this.reservationRepository.completeIdempotency(
            claim.api_idempotency_id,
            requestId,
            this.compensationSnapshot(result),
            201,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 25_000,
        },
      ),
    );
  }

  async rejectCompensation(
    encounterId: string,
    reservationId: string,
    requestId: string,
    dto: ReviewOpdCourseCompensationDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdCourseCompensationResult> {
    this.assertCapabilityEnabled();
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const reason = dto.reason.trim();
    const requestHash = this.reviewRequestHash(
      COMPENSATION_REJECT_OPERATION,
      encounterId,
      reservationId,
      requestId,
      dto,
      reason,
    );
    return this.runCourseCommandWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const replay = await this.commandReplay(
            COMPENSATION_REJECT_OPERATION,
            idempotencyKey,
            requestHash,
            scope,
            tx,
          );
          if (replay) return replay;
          await this.lockCourseAggregate(encounterId, reservationId, scope, tx);
          await this.repository.lockCompensationRequest(requestId, scope, tx);
          const encounter = await this.requireEncounter(encounterId, scope, tx);
          this.assertEncounterCompensable(encounter);
          const record = await this.requireReservation(
            encounterId,
            reservationId,
            scope,
            tx,
          );
          const verification = record.verification;
          const request = verification
            ? await this.repository.findCompensationRequest(
                requestId,
                verification.verification_id,
                scope,
                tx,
              )
            : null;
          if (
            record.status !== "USED" ||
            record.version !== dto.expectedReservationVersion ||
            !verification ||
            !request ||
            request.status !== "PENDING" ||
            request.version !== dto.expectedRequestVersion
          ) {
            this.throwConflict(
              "COURSE_COMPENSATION_NOT_ALLOWED",
              "The compensation request or reservation changed",
            );
          }
          this.assertSeparateActor(request.requested_by_user_id, scope.userId);
          const now = new Date();
          const claim = await this.reservationRepository.createIdempotency(
            {
              operation: COMPENSATION_REJECT_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_COURSE_COMPENSATION_REJECT",
              resourceId: requestId,
            },
            scope,
            now,
            tx,
          );
          await this.repository.rejectCompensationRequest(
            request,
            reason,
            requestHash,
            this.sha256(idempotencyKey),
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
              action: "course.compensation.reject",
              actionLabel: "Reject verified course compensation",
              fromStatus: "PENDING",
              toStatus: "REJECTED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                reservationId,
                verificationId: verification.verification_id,
                compensationRequestId: requestId,
                requestVersion: dto.expectedRequestVersion,
                permissionPath: [...OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS],
                requestHash,
                balanceChanged: false,
                inventoryChanged: false,
              },
            },
            tx,
          );
          const result = await this.compensationResult(
            encounterId,
            reservationId,
            requestId,
            scope,
            tx,
          );
          await this.reservationRepository.completeIdempotency(
            claim.api_idempotency_id,
            requestId,
            this.compensationSnapshot(result),
            200,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 25_000,
        },
      ),
    );
  }

  async approveCompensation(
    encounterId: string,
    reservationId: string,
    requestId: string,
    dto: ReviewOpdCourseCompensationDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdCourseCompensationResult> {
    this.assertCapabilityEnabled();
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const reason = dto.reason.trim();
    const requestHash = this.reviewRequestHash(
      COMPENSATION_APPROVE_OPERATION,
      encounterId,
      reservationId,
      requestId,
      dto,
      reason,
    );
    return this.runCourseCommandWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const replay = await this.commandReplay(
            COMPENSATION_APPROVE_OPERATION,
            idempotencyKey,
            requestHash,
            scope,
            tx,
          );
          if (replay) return replay;
          await this.lockCourseAggregate(encounterId, reservationId, scope, tx);
          await this.repository.lockCompensationRequest(requestId, scope, tx);
          const encounter = await this.requireEncounter(encounterId, scope, tx);
          this.assertEncounterCompensable(encounter);
          const record = await this.requireReservation(
            encounterId,
            reservationId,
            scope,
            tx,
          );
          const verification = record.verification;
          const request = verification
            ? await this.repository.findCompensationRequest(
                requestId,
                verification.verification_id,
                scope,
                tx,
              )
            : null;
          if (
            record.status !== "USED" ||
            record.version !== dto.expectedReservationVersion ||
            !verification ||
            !request ||
            request.status !== "PENDING" ||
            request.version !== dto.expectedRequestVersion
          ) {
            this.throwConflict(
              "COURSE_COMPENSATION_NOT_ALLOWED",
              "The compensation request or reservation changed",
            );
          }
          this.assertSeparateActor(request.requested_by_user_id, scope.userId);
          await this.reservationRepository.lockLegacyState(record, scope, tx);
          await this.repository.lockVerificationState(record, scope, tx);
          const state = await this.reservationRepository.loadLegacyState(
            record,
            scope,
            tx,
          );
          this.assertUsedLegacyState(record, verification, state, true);
          const groups = this.verificationComponentGroups(verification);
          const inventoryKeys = groups.map((group) => ({
            productId: group.productId,
            lotId: group.lotId,
          }));
          if (
            (await this.repository.lockInventory(inventoryKeys, scope, tx)) !==
            inventoryKeys.length
          ) {
            this.throwConflict(
              "MANUAL_RECONCILIATION_REQUIRED",
              "An original component inventory row is missing",
            );
          }
          const now = new Date();
          const adjustmentDocumentId =
            await this.reservationRepository.allocateDocumentNumber(
              document_key.ADJUST_STOCK,
              scope,
              now,
              tx,
            );
          const componentEffects: CourseCompensationComponentEffect[] = [];
          for (const group of groups) {
            const originalLog = await this.repository.findInventoryLog(
              group.inventoryLogId,
              scope,
              tx,
            );
            if (
              !originalLog ||
              originalLog.document_id !== record.legacy_service_usage_id ||
              originalLog.item_id !== group.productId ||
              originalLog.lot_id !== group.lotId ||
              !originalLog.stock_in.equals(ZERO) ||
              !originalLog.stock_out.equals(group.quantity)
            ) {
              this.throwConflict(
                "MANUAL_RECONCILIATION_REQUIRED",
                "The original component inventory movement no longer reconciles",
              );
            }
            const snapshot = await this.requireInventorySnapshot(
              group.productId,
              group.lotId,
              scope,
              tx,
            );
            const inverseInventoryLogId = randomUUID();
            const afterLot = snapshot.inStock.plus(group.quantity);
            const afterTotal = snapshot.totalStock.plus(group.quantity);
            await this.repository.restoreInventory(
              group.productId,
              group.lotId,
              group.quantity,
              now,
              scope,
              tx,
            );
            await this.repository.createInventoryLog(
              {
                inventoryLogId: inverseInventoryLogId,
                documentId: adjustmentDocumentId,
                productId: group.productId,
                lotId: group.lotId,
                stockIn: group.quantity,
                stockOut: ZERO,
                currentStock: afterTotal,
                remark: `OPD V2 course compensation ${requestId}`,
              },
              scope,
              now,
              tx,
            );
            let lotCursor = snapshot.inStock;
            let totalCursor = snapshot.totalStock;
            for (const component of group.components) {
              const componentAfterLot = lotCursor.plus(component.quantity);
              const componentAfterTotal = totalCursor.plus(component.quantity);
              componentEffects.push({
                compensationComponentId: randomUUID(),
                verificationComponentId: component.verification_component_id,
                productId: component.product_id,
                lotId: component.actual_lot_id,
                quantity: component.quantity,
                originalInventoryLogId: group.inventoryLogId,
                inverseInventoryLogId,
                beforeLotStock: lotCursor,
                afterLotStock: componentAfterLot,
                beforeTotalStock: totalCursor,
                afterTotalStock: componentAfterTotal,
                snapshotHash: this.sha256(
                  this.stableJson({
                    verificationComponentId:
                      component.verification_component_id,
                    originalInventoryLogId: group.inventoryLogId,
                    inverseInventoryLogId,
                    beforeLotStock: lotCursor.toString(),
                    afterLotStock: componentAfterLot.toString(),
                    beforeTotalStock: totalCursor.toString(),
                    afterTotalStock: componentAfterTotal.toString(),
                  }),
                ),
              });
              lotCursor = componentAfterLot;
              totalCursor = componentAfterTotal;
            }
          }
          const reversalManifest: Prisma.InputJsonObject = {
            schema: "opd-course-compensation-v1",
            reservationId,
            verificationId: verification.verification_id,
            compensationRequestId: requestId,
            adjustmentDocumentId,
            sourceReservationVersion: record.version,
            resultReservationVersion: record.version + 1,
            usageLogIds: record.items.map((item) => item.legacy_usage_log_id),
            inventory: componentEffects.map((component) => ({
              verificationComponentId: component.verificationComponentId,
              originalInventoryLogId: component.originalInventoryLogId,
              inverseInventoryLogId: component.inverseInventoryLogId,
              productId: component.productId,
              lotId: component.lotId,
              quantity: component.quantity.toString(),
              beforeLotStock: component.beforeLotStock.toString(),
              afterLotStock: component.afterLotStock.toString(),
            })),
            requestedBy: request.requested_by_user_id,
            approvedBy: scope.userId,
            approvedAt: now.toISOString(),
          };
          const reversalManifestHash = this.sha256(
            this.stableJson(reversalManifest),
          );
          const claim = await this.reservationRepository.createIdempotency(
            {
              operation: COMPENSATION_APPROVE_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_COURSE_COMPENSATION_APPROVE",
              resourceId: requestId,
            },
            scope,
            now,
            tx,
          );
          await this.repository.applyCompensation(
            {
              request,
              record,
              adjustmentDocumentId,
              reviewReason: reason,
              reviewRequestHash: requestHash,
              reviewIdempotencyKeyHash: this.sha256(idempotencyKey),
              reversalManifest,
              reversalManifestHash,
              components: componentEffects,
            },
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
              action: "course.compensation.approve",
              actionLabel: "Approve verified course compensation",
              fromStatus: "USED",
              toStatus: "COMPENSATED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                reservationId,
                verificationId: verification.verification_id,
                compensationRequestId: requestId,
                adjustmentDocumentId,
                sourceVersion: dto.expectedReservationVersion,
                resultVersion: dto.expectedReservationVersion + 1,
                restoredUsageLogIds: record.items.map(
                  (item) => item.legacy_usage_log_id,
                ),
                inventoryMovements: componentEffects.map((component) => ({
                  productId: component.productId,
                  lotId: component.lotId,
                  quantity: component.quantity.toString(),
                  originalInventoryLogId: component.originalInventoryLogId,
                  inverseInventoryLogId: component.inverseInventoryLogId,
                })),
                reversalManifestHash,
                permissionPath: [...OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS],
                requestHash,
                evidenceRetained: true,
                outboxWritten: false,
              },
            },
            tx,
          );
          const result = await this.compensationResult(
            encounterId,
            reservationId,
            requestId,
            scope,
            tx,
          );
          await this.reservationRepository.completeIdempotency(
            claim.api_idempotency_id,
            requestId,
            this.compensationSnapshot(result),
            200,
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 30_000,
        },
      ),
    );
  }

  async document(
    encounterId: string,
    reservationId: string,
    scope: RequestScope,
  ): Promise<OpdCourseVerificationDocumentResult> {
    await this.requireEncounter(encounterId, scope);
    const record = await this.requireReservation(
      encounterId,
      reservationId,
      scope,
    );
    const verification = record.verification;
    if (!verification) {
      throw new NotFoundException({
        code: "COURSE_VERIFICATION_NOT_FOUND",
        message: "Course verification evidence was not found",
      });
    }
    const file = await this.repository.findDocumentFile(verification, scope);
    if (
      !file ||
      file.mime_type !== "application/pdf" ||
      file.file_size !== verification.pdf_bytes
    ) {
      this.throwConflict(
        "MANUAL_RECONCILIATION_REQUIRED",
        "The committed verification PDF metadata does not reconcile",
      );
    }
    const expiresInSeconds = Math.min(
      15 * 60,
      backendEnv().STORAGE_READ_URL_TTL_SECONDS,
    );
    const url = await this.storageService.getReadUrl({
      provider: requireStorageProvider(file.storage_provider),
      bucketName: file.bucket_name,
      objectKey: file.object_key,
      expiresInSeconds,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      fileName: file.original_name,
      mimeType: "application/pdf",
    };
  }

  private async evaluate(
    encounterId: string,
    reservationId: string,
    expectedVersion: number,
    selections: VerificationTokenSelection[],
    scope: RequestScope,
    now: Date,
    client: DatabaseClient,
    issueToken: boolean,
  ): Promise<VerificationEvaluation> {
    const [encounter, record] = await Promise.all([
      this.requireEncounter(encounterId, scope, client),
      this.requireReservation(encounterId, reservationId, scope, client),
    ]);
    const [state, display, effectivePermissions] = await Promise.all([
      this.reservationRepository.loadLegacyState(record, scope, client),
      this.repository.displayContext(record, scope, client),
      this.reservationRepository.findEffectivePermissions(
        [...OPD_COURSE_VERIFY_PERMISSIONS],
        scope,
        client,
      ),
    ]);
    const verificationPermissionGranted = OPD_COURSE_VERIFY_PERMISSIONS.every(
      (permission) => effectivePermissions.has(permission),
    );
    const blockers: OpdCourseVerificationBlockerView[] = [];
    if (!this.capabilityEnabled()) {
      blockers.push(
        this.blocker(
          "COURSE_VERIFICATION_DISABLED",
          "Course verification is disabled by the server rollout gate",
        ),
      );
    }
    if (!verificationPermissionGranted) {
      blockers.push(
        this.blocker(
          "COURSE_VERIFICATION_PERMISSION_REQUIRED",
          "The current actor lacks the complete course verification permission set",
        ),
      );
    }
    if (record.version !== expectedVersion) {
      blockers.push(
        this.blocker(
          "COURSE_RESERVATION_VERSION_CONFLICT",
          "The course reservation version changed",
        ),
      );
    }
    if (record.status !== "RESERVED") {
      blockers.push(
        this.blocker(
          record.verification
            ? "COURSE_ALREADY_VERIFIED"
            : "COURSE_RESERVATION_NOT_RESERVED",
          record.verification
            ? "This reservation has already been verified"
            : "Only a RESERVED course use can be verified",
        ),
      );
    }
    if (!this.encounterSupportsVerification(encounter)) {
      blockers.push(
        this.blocker(
          "COURSE_ENCOUNTER_STATE_UNSUPPORTED",
          "Verification requires OPEN/DRAFT or POST_VISIT/FINALIZED",
        ),
      );
    }
    blockers.push(...this.legacyBlockers(record, state));

    const selectionMap = new Map(
      selections.map((selection) => [
        selection.reservationComponentId,
        selection,
      ]),
    );
    const knownComponentIds = new Set(
      record.items.flatMap((item) =>
        item.components.map((component) => component.reservation_component_id),
      ),
    );
    for (const selection of selections) {
      if (!knownComponentIds.has(selection.reservationComponentId)) {
        blockers.push(
          this.blocker(
            "COURSE_COMPONENT_LOT_INVALID",
            "A selected component does not belong to this reservation",
            selection.reservationComponentId,
          ),
        );
      }
    }

    const evaluatedComponents: EvaluatedVerificationComponent[] = [];
    for (const item of record.items) {
      for (const component of item.components) {
        const requested = selectionMap.get(component.reservation_component_id);
        const selection: VerificationTokenSelection = {
          reservationComponentId: component.reservation_component_id,
          lotId: requested?.lotId.trim() || component.lot_id,
          replacementReason:
            (requested?.lotId.trim() || component.lot_id) === component.lot_id
              ? null
              : requested?.replacementReason?.trim() || null,
        };
        const componentBlockers: OpdCourseVerificationBlockerView[] = [];
        if (
          selection.lotId !== component.lot_id &&
          !selection.replacementReason
        ) {
          componentBlockers.push(
            this.blocker(
              "COURSE_COMPONENT_LOT_REQUIRED",
              "A replacement-lot reason is required",
              component.reservation_component_id,
              component.product_id,
            ),
          );
        }
        const [lots, legacyComponent] = await Promise.all([
          this.repository.inventoryLots(component.product_id, scope, client),
          this.repository.findLegacyComponent(
            record.legacy_service_usage_id,
            item.legacy_service_usage_item_id,
            component.product_id,
            scope,
            client,
          ),
        ]);
        if (
          !legacyComponent ||
          legacyComponent.lotId !== component.lot_id ||
          !legacyComponent.quantity.equals(component.total_quantity)
        ) {
          componentBlockers.push(
            this.blocker(
              "COURSE_LEGACY_STATE_MISMATCH",
              "The linked legacy component changed after reservation",
              component.reservation_component_id,
              component.product_id,
            ),
          );
        }
        const selected =
          lots.find((lot) => lot.lotId === selection.lotId) ?? null;
        if (!selected) {
          componentBlockers.push(
            this.blocker(
              "COURSE_COMPONENT_LOT_INVALID",
              "The selected component lot is unavailable in this branch",
              component.reservation_component_id,
              component.product_id,
            ),
          );
        } else {
          if (selected.expiryCount !== 1 || !selected.expiryAt) {
            componentBlockers.push(
              this.blocker(
                "COURSE_COMPONENT_EXPIRY_AMBIGUOUS",
                "The selected lot does not have one unambiguous receipt expiry",
                component.reservation_component_id,
                component.product_id,
              ),
            );
          } else if (selected.expiryAt.getTime() <= now.getTime()) {
            componentBlockers.push(
              this.blocker(
                "COURSE_COMPONENT_LOT_EXPIRED",
                "The selected component lot is expired",
                component.reservation_component_id,
                component.product_id,
              ),
            );
          }
        }
        const view: OpdCourseVerificationComponentView = {
          reservationComponentId: component.reservation_component_id,
          reservationItemId: item.reservation_item_id,
          productId: component.product_id,
          productCode: component.product_code_snapshot,
          productName: component.product_name_snapshot,
          unit: component.unit_snapshot,
          requiredQuantity: this.decimalNumber(component.total_quantity),
          originalLotId: component.lot_id,
          actualLotId: selection.lotId,
          replacementReason: selection.replacementReason,
          expiryAt: selected?.expiryAt?.toISOString() ?? null,
          availableQuantity: selected
            ? this.decimalNumber(selected.inStock)
            : 0,
          totalProductStock: selected
            ? this.decimalNumber(selected.totalStock)
            : 0,
          candidateLots: lots.map((lot) => ({
            lotId: lot.lotId,
            expiryAt: lot.expiryAt?.toISOString() ?? null,
            availableQuantity: this.decimalNumber(lot.inStock),
            eligible:
              lot.expiryCount === 1 &&
              Boolean(lot.expiryAt && lot.expiryAt.getTime() > now.getTime()) &&
              lot.inStock.greaterThanOrEqualTo(component.total_quantity),
          })),
          blockers: componentBlockers,
        };
        evaluatedComponents.push({
          item,
          component,
          legacyComponentId: legacyComponent?.id ?? null,
          selected,
          selection,
          blockers: componentBlockers,
          view,
        });
      }
    }

    const componentGroups = new Map<
      string,
      {
        quantity: Prisma.Decimal;
        components: EvaluatedVerificationComponent[];
      }
    >();
    for (const component of evaluatedComponents) {
      const key = `${component.component.product_id}|${component.selection.lotId}`;
      const group = componentGroups.get(key) ?? {
        quantity: ZERO,
        components: [],
      };
      group.quantity = group.quantity.plus(component.component.total_quantity);
      group.components.push(component);
      componentGroups.set(key, group);
    }
    for (const group of componentGroups.values()) {
      const selected = group.components[0]?.selected;
      if (!selected || selected.inStock.greaterThanOrEqualTo(group.quantity)) {
        continue;
      }
      for (const component of group.components) {
        component.blockers.push(
          this.blocker(
            "COURSE_COMPONENT_STOCK_INSUFFICIENT",
            "The selected component lot has insufficient stock for the aggregate deduction",
            component.component.reservation_component_id,
            component.component.product_id,
          ),
        );
        component.view.blockers = component.blockers;
      }
    }
    blockers.push(
      ...evaluatedComponents.flatMap((component) => component.blockers),
    );

    const itemViews = await Promise.all(
      record.items.map(async (item): Promise<OpdCourseVerificationItemView> => {
        const identity: CourseEntitlementIdentity = {
          clinicId: scope.clinicId,
          purchaseBranchId: item.purchase_branch_id,
          customerId: item.customer_id,
          saleOrderId: item.sale_order_id,
          courseItemId: item.course_item_id,
          entitlementExpireAt: item.entitlement_expire_at,
        };
        const balance = await this.reservationRepository.usageBalance(
          identity,
          client,
        );
        if (balance.reserved.lessThan(item.reserved_amount)) {
          blockers.push(
            this.blocker(
              "COURSE_USAGE_LOG_MISMATCH",
              "The reserved course balance no longer contains this exact use",
            ),
          );
        }
        return {
          reservationItemId: item.reservation_item_id,
          courseCode: item.course_code_snapshot,
          courseName: item.course_name_snapshot,
          itemName: item.item_name_snapshot,
          quantity: this.decimalNumber(item.reserved_amount),
          reservedBefore: this.decimalNumber(balance.reserved),
          usedBefore: this.decimalNumber(balance.used),
          reservedAfter: this.decimalNumber(
            balance.reserved.minus(item.reserved_amount),
          ),
          usedAfter: this.decimalNumber(
            balance.used.plus(item.reserved_amount),
          ),
          remainingBefore: this.decimalNumber(
            item.entitlement_amount.minus(balance.reserved).minus(balance.used),
          ),
          remainingAfter: this.decimalNumber(
            item.entitlement_amount.minus(balance.reserved).minus(balance.used),
          ),
        };
      }),
    );
    const operatorViews = record.items.flatMap((item) =>
      item.operators.map(
        (operator): OpdCourseVerificationOperatorView => ({
          userId: operator.user_id,
          displayName:
            display.operatorDisplayNames.get(operator.user_id) ??
            "Assigned staff",
          roleId: operator.role_id,
          operatorType:
            operator.operator_type === "ASSISTANT" ? "ASSISTANT" : "OPERATOR",
        }),
      ),
    );
    const dedupedBlockers = this.dedupeBlockers(blockers);
    const snapshot: Prisma.InputJsonObject = {
      schema: "opd-course-verification-preflight-v1",
      clinicId: scope.clinicId,
      branchId: scope.branchId,
      encounterId,
      reservationId,
      customerId: record.customer_id,
      reservationVersion: record.version,
      reservationStatus: record.status,
      verificationPermissionGranted,
      legacyOpdId: record.legacy_opd_id,
      legacyServiceUsageId: record.legacy_service_usage_id,
      legacyServiceUsageStatus:
        state.serviceUsage?.service_usage_status ?? null,
      usageLogs: state.usageLogs
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((log) => ({
          id: log.id,
          status: log.status,
          itemId: log.item_id,
          amount: log.amount?.toString() ?? null,
          expiryAt: log.expire_date.toISOString(),
        })),
      items: itemViews.map((item) => ({
        reservationItemId: item.reservationItemId,
        quantity: String(item.quantity),
        reservedBefore: String(item.reservedBefore),
        usedBefore: String(item.usedBefore),
        reservedAfter: String(item.reservedAfter),
        usedAfter: String(item.usedAfter),
        remainingBefore: String(item.remainingBefore),
        remainingAfter: String(item.remainingAfter),
      })),
      components: evaluatedComponents
        .slice()
        .sort((left, right) =>
          left.component.reservation_component_id.localeCompare(
            right.component.reservation_component_id,
          ),
        )
        .map((component) => ({
          reservationComponentId: component.component.reservation_component_id,
          productId: component.component.product_id,
          originalLotId: component.component.lot_id,
          actualLotId: component.selection.lotId,
          replacementReason: component.selection.replacementReason,
          quantity: component.component.total_quantity.toString(),
          expiryAt: component.selected?.expiryAt?.toISOString() ?? null,
          availableQuantity: component.selected?.inStock.toString() ?? null,
          totalProductStock: component.selected?.totalStock.toString() ?? null,
          inventoryUpdatedAt:
            component.selected?.inventoryUpdatedAt?.toISOString() ?? null,
          legacyComponentId: component.legacyComponentId,
        })),
      operators: record.items.flatMap((item) =>
        item.operators.map((operator) => ({
          reservationOperatorId: operator.reservation_operator_id,
          reservationItemId: item.reservation_item_id,
          userId: operator.user_id,
          roleId: operator.role_id,
          operatorType: operator.operator_type,
          commissionAmount: operator.commission_amount.toString(),
          commissionUnit: operator.commission_unit,
          sourceUserUpdatedAt:
            operator.source_user_updated_at?.toISOString() ?? null,
        })),
      ),
      acknowledgementVersion: OPD_COURSE_ACKNOWLEDGEMENT_VERSION,
      renderTemplate: OPD_COURSE_VERIFICATION_RENDER_TEMPLATE,
    };
    const snapshotHash = this.sha256(this.stableJson(snapshot));
    const expiresAt = new Date(now.getTime() + PREFLIGHT_TTL_MS);
    const tokenPayload: VerificationPreflightTokenPayload = {
      version: 1,
      clinicId: scope.clinicId,
      branchId: scope.branchId,
      actorUserId: scope.userId,
      encounterId,
      reservationId,
      customerId: record.customer_id,
      expectedVersion,
      snapshotHash,
      selections: evaluatedComponents.map((component) => component.selection),
      issuedAtMs: now.getTime(),
      expiresAtMs: expiresAt.getTime(),
    };
    const eligible = dedupedBlockers.length === 0;
    const result: OpdCourseVerificationPreflightResult = {
      capabilityEnabled: this.capabilityEnabled(),
      eligible,
      reservationId,
      expectedVersion,
      blockers: dedupedBlockers,
      items: itemViews,
      components: evaluatedComponents.map((component) => component.view),
      operators: operatorViews,
      acknowledgement: {
        version: OPD_COURSE_ACKNOWLEDGEMENT_VERSION,
        textTh: OPD_COURSE_ACKNOWLEDGEMENT_TEXT["th-TH"],
        textEn: OPD_COURSE_ACKNOWLEDGEMENT_TEXT["en-US"],
      },
      requiredPermissions: [...OPD_COURSE_VERIFY_PERMISSIONS],
      preflightToken:
        issueToken && eligible
          ? this.issueSignedToken(tokenPayload, backendEnv().JWT_SECRET)
          : null,
      expiresAt: issueToken && eligible ? expiresAt.toISOString() : null,
      courseUsed: false,
      componentStockDeducted: false,
    };
    return {
      encounter,
      record,
      state,
      display,
      components: evaluatedComponents,
      itemViews,
      operatorViews,
      blockers: dedupedBlockers,
      snapshot,
      snapshotHash,
      result,
    };
  }

  private legacyBlockers(
    record: OpdCourseReservationRecord,
    state: LegacyCourseReservationState,
  ): OpdCourseVerificationBlockerView[] {
    const blockers: OpdCourseVerificationBlockerView[] = [];
    const usage = state.serviceUsage;
    if (
      !usage ||
      usage.status !== "ACTIVE" ||
      usage.service_usage_status !== "PENDING" ||
      usage.customer_id !== record.customer_id ||
      usage.customer_owner_id !== record.customer_id ||
      usage.verify_at ||
      usage.verify_by ||
      usage.document_url
    ) {
      blockers.push(
        this.blocker(
          "COURSE_LEGACY_STATE_MISMATCH",
          "The linked legacy service usage is not the exact ACTIVE/PENDING reservation",
        ),
      );
      return blockers;
    }
    if (usage.service_usage_request_cancel) {
      blockers.push(
        this.blocker(
          "COURSE_CANCELLATION_PENDING",
          "A legacy or V2 cancellation request already exists",
        ),
      );
    }
    if (
      !state.legacyOpd ||
      state.legacyOpd.management_item !== record.legacy_service_usage_id
    ) {
      blockers.push(
        this.blocker(
          "COURSE_LEGACY_STATE_MISMATCH",
          "The legacy OPD no longer points to this course reservation",
        ),
      );
    }
    if (state.inventoryMovementCount !== 0) {
      blockers.push(
        this.blocker(
          "COURSE_LEGACY_STATE_MISMATCH",
          "Inventory movement already exists for this unverified reservation",
        ),
      );
    }
    if (state.usageLogs.length !== record.items.length) {
      blockers.push(
        this.blocker(
          "COURSE_USAGE_LOG_MISMATCH",
          "The exact RESERVED usage-log set changed",
        ),
      );
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
        blockers.push(
          this.blocker(
            "COURSE_USAGE_LOG_MISMATCH",
            "A RESERVED usage log no longer matches its immutable snapshot",
          ),
        );
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
          this.blocker(
            "COURSE_LEGACY_STATE_MISMATCH",
            "A legacy service-usage item changed after reservation",
          ),
        );
        continue;
      }
      if (
        legacyItem.service_usage_item_commission.length !==
        item.operators.length
      ) {
        blockers.push(
          this.blocker(
            "COURSE_OPERATOR_SNAPSHOT_MISMATCH",
            "The operator commission row count changed",
          ),
        );
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
            this.blocker(
              "COURSE_OPERATOR_SNAPSHOT_MISMATCH",
              "An operator or commission snapshot changed",
            ),
          );
        }
      }
    }
    const expectedOperators = new Set(
      record.items.flatMap((item) =>
        item.operators.map(
          (operator) => `${operator.user_id}|${operator.operator_type}`,
        ),
      ),
    );
    const actualOperators = new Set(
      usage.course_operator_user.map(
        (operator) => `${operator.user_id}|${operator.operator_type}`,
      ),
    );
    if (
      expectedOperators.size !== actualOperators.size ||
      [...expectedOperators].some((operator) => !actualOperators.has(operator))
    ) {
      blockers.push(
        this.blocker(
          "COURSE_OPERATOR_SNAPSHOT_MISMATCH",
          "The treatment operator assignment changed",
        ),
      );
    }
    return blockers;
  }

  private async acquireVerificationClaim(
    idempotencyKey: string,
    requestHash: string,
    reservationId: string,
    scope: RequestScope,
  ): Promise<VerificationClaimResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await this.repository.findIdempotency(
          VERIFY_OPERATION,
          idempotencyKey,
          scope,
          tx,
        );
        if (existing) {
          if (existing.request_hash !== requestHash) {
            this.throwConflict(
              "IDEMPOTENCY_KEY_REUSED",
              "This idempotency key was already used for another verification payload",
            );
          }
          if (existing.state === "COMPLETED") {
            const verification = await this.repository.findVerification(
              reservationId,
              scope,
              tx,
            );
            if (
              !verification ||
              verification.verification_id !== existing.resource_id
            ) {
              this.throwConflict(
                "MANUAL_RECONCILIATION_REQUIRED",
                "The completed verification claim cannot resolve its permanent evidence",
              );
            }
            const record = await this.requireReservation(
              verification.encounter_id,
              reservationId,
              scope,
              tx,
            );
            return {
              kind: "replay",
              result: this.verificationResult(record, verification),
            };
          }
          const verificationId = randomUUID();
          const reclaimed = await this.repository.reclaimVerificationClaim(
            existing.api_idempotency_id,
            requestHash,
            verificationId,
            new Date(),
            tx,
          );
          if (!reclaimed) {
            this.throwConflict(
              "IDEMPOTENCY_IN_PROGRESS",
              "This verification attempt is still in progress",
              { retryAfterSeconds: 5 },
            );
          }
          return { kind: "acquired", claim: reclaimed, verificationId };
        }
        const verificationId = randomUUID();
        const claim = await this.repository.createVerificationClaim(
          VERIFY_OPERATION,
          idempotencyKey,
          requestHash,
          verificationId,
          scope,
          new Date(),
          tx,
        );
        return { kind: "acquired", claim, verificationId };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  private async commitVerificationWithRetry(
    claim: VerificationClaimAcquired,
    context: VerificationCommandContext,
    evidence: StoredCourseVerificationEvidence,
    idempotencyKey: string,
    scope: RequestScope,
    principal: Principal,
    network: { clientIp: string | null; userAgentHash: string | null },
    allowRetry: boolean,
  ): Promise<OpdCourseVerificationResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (
            !(await this.repository.lockIdempotencyClaim(
              claim.claim.api_idempotency_id,
              tx,
            ))
          ) {
            throw new Error("IDEMPOTENCY_IN_PROGRESS");
          }
          const activeClaim = await this.repository.findIdempotency(
            VERIFY_OPERATION,
            idempotencyKey,
            scope,
            tx,
          );
          if (
            !activeClaim ||
            activeClaim.api_idempotency_id !== claim.claim.api_idempotency_id ||
            activeClaim.state !== "IN_PROGRESS" ||
            activeClaim.request_hash !== context.requestHash ||
            activeClaim.resource_id !== claim.verificationId
          ) {
            throw new Error("IDEMPOTENCY_IN_PROGRESS");
          }
          await this.lockCourseAggregate(
            context.evaluation.record.encounter_id,
            context.evaluation.record.reservation_id,
            scope,
            tx,
          );
          const lockedRecord = await this.requireReservation(
            context.evaluation.record.encounter_id,
            context.evaluation.record.reservation_id,
            scope,
            tx,
          );
          await this.reservationRepository.lockLegacyState(
            lockedRecord,
            scope,
            tx,
          );
          await this.repository.lockVerificationState(lockedRecord, scope, tx);
          const inventoryKeys = [
            ...new Map(
              context.token.selections.map((selection) => [
                selection.reservationComponentId,
                selection,
              ]),
            ).values(),
          ].flatMap((selection) => {
            const component = lockedRecord.items
              .flatMap((item) => item.components)
              .find(
                (candidate) =>
                  candidate.reservation_component_id ===
                  selection.reservationComponentId,
              );
            return component
              ? [{ productId: component.product_id, lotId: selection.lotId }]
              : [];
          });
          const uniqueInventoryKeys = [
            ...new Map(
              inventoryKeys.map((key) => [
                `${key.productId}|${key.lotId}`,
                key,
              ]),
            ).values(),
          ];
          if (
            (await this.repository.lockInventory(
              uniqueInventoryKeys,
              scope,
              tx,
            )) !== uniqueInventoryKeys.length
          ) {
            throw new Error("COURSE_COMPONENT_LOT_INVALID");
          }
          const fresh = await this.evaluate(
            lockedRecord.encounter_id,
            lockedRecord.reservation_id,
            context.token.expectedVersion,
            context.token.selections,
            scope,
            context.verifiedAt,
            tx,
            false,
          );
          if (
            fresh.snapshotHash !== context.token.snapshotHash ||
            !fresh.result.eligible
          ) {
            throw new Error("COURSE_VERIFICATION_REPREFLIGHT_REQUIRED");
          }
          const componentEffects = await this.applyVerificationInventoryEffects(
            fresh,
            claim.verificationId,
            scope,
            context.verifiedAt,
            tx,
          );
          const legacyDocumentUrl = this.legacyDocumentUrl(
            lockedRecord.encounter_id,
            lockedRecord.reservation_id,
          );
          await this.repository.applyLegacyVerification(
            lockedRecord,
            context.token.expectedVersion,
            legacyDocumentUrl,
            scope,
            context.verifiedAt,
            tx,
          );
          await this.repository.createVerification(
            {
              verificationId: claim.verificationId,
              record: lockedRecord,
              sourceReservationVersion: context.token.expectedVersion,
              resultReservationVersion: context.token.expectedVersion + 1,
              verificationManifest: context.verificationManifest,
              manifestHash: context.manifestHash,
              acknowledgementVersion: OPD_COURSE_ACKNOWLEDGEMENT_VERSION,
              acknowledgementLocale:
                context.token.version === 1
                  ? this.manifestLocale(context.verificationManifest)
                  : "en-US",
              acknowledgementHash: context.acknowledgementHash,
              requestHash: context.requestHash,
              idempotencyKeyHash: this.sha256(idempotencyKey),
              verifiedAt: context.verifiedAt,
              legacyDocumentUrl,
              clientIp: network.clientIp,
              userAgentHash: network.userAgentHash,
              evidence,
              components: componentEffects,
            },
            scope,
            tx,
          );
          await this.auditLogService.create(
            {
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              referenceType: auditReferenceType.OPD,
              referenceId: lockedRecord.encounter_id,
              action: "course.verify",
              actionLabel: "Verify reserved course use",
              fromStatus: "RESERVED",
              toStatus: "USED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                reservationId: lockedRecord.reservation_id,
                verificationId: claim.verificationId,
                legacyServiceUsageId: lockedRecord.legacy_service_usage_id,
                sourceVersion: context.token.expectedVersion,
                resultVersion: context.token.expectedVersion + 1,
                quantities: fresh.itemViews.map((item) => ({
                  reservationItemId: item.reservationItemId,
                  quantity: String(item.quantity),
                  reservedBefore: String(item.reservedBefore),
                  reservedAfter: String(item.reservedAfter),
                  usedBefore: String(item.usedBefore),
                  usedAfter: String(item.usedAfter),
                  remaining: String(item.remainingAfter),
                })),
                inventoryMovements: componentEffects.map((component) => ({
                  reservationComponentId: component.reservationComponentId,
                  productId: component.productId,
                  actualLotId: component.actualLotId,
                  quantity: component.quantity.toString(),
                  inventoryLogId: component.inventoryLogId,
                })),
                manifestHash: context.manifestHash,
                signatureHash: context.signature.hash,
                pdfHash: evidence.pdfHash,
                renderTemplate: OPD_COURSE_VERIFICATION_RENDER_TEMPLATE,
                renderVersion: 1,
                permissionPath: [...OPD_COURSE_VERIFY_PERMISSIONS],
                requestHash: context.requestHash,
                idempotencyKeyHash: this.sha256(idempotencyKey),
                appointmentChanged: false,
                queueChanged: false,
                clinicalChanged: false,
                legacyOpdStatusChanged: false,
                outboxWritten: false,
              },
            },
            tx,
          );
          const verification = await this.repository.findVerification(
            lockedRecord.reservation_id,
            scope,
            tx,
          );
          const updatedRecord = await this.requireReservation(
            lockedRecord.encounter_id,
            lockedRecord.reservation_id,
            scope,
            tx,
          );
          if (!verification) {
            throw new Error(
              "Committed course verification could not be reloaded",
            );
          }
          const result = this.verificationResult(updatedRecord, verification);
          await this.repository.completeIdempotency(
            claim.claim.api_idempotency_id,
            claim.verificationId,
            this.verificationSnapshot(result),
            201,
            context.verifiedAt,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 30_000,
        },
      );
    } catch (error) {
      if (
        allowRetry &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.commitVerificationWithRetry(
          claim,
          context,
          evidence,
          idempotencyKey,
          scope,
          principal,
          network,
          false,
        );
      }
      throw error;
    }
  }

  private async applyVerificationInventoryEffects(
    evaluation: VerificationEvaluation,
    verificationId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<CourseVerificationComponentEffect[]> {
    const groups = new Map<
      string,
      {
        productId: string;
        lotId: string;
        quantity: Prisma.Decimal;
        components: EvaluatedVerificationComponent[];
      }
    >();
    for (const component of evaluation.components) {
      if (!component.selected || component.legacyComponentId === null) {
        throw new Error("COURSE_COMPONENT_LOT_INVALID");
      }
      const key = `${component.component.product_id}|${component.selection.lotId}`;
      const group = groups.get(key) ?? {
        productId: component.component.product_id,
        lotId: component.selection.lotId,
        quantity: ZERO,
        components: [],
      };
      group.quantity = group.quantity.plus(component.component.total_quantity);
      group.components.push(component);
      groups.set(key, group);
    }
    const effects: CourseVerificationComponentEffect[] = [];
    for (const group of [...groups.values()].sort((left, right) =>
      `${left.productId}|${left.lotId}`.localeCompare(
        `${right.productId}|${right.lotId}`,
      ),
    )) {
      const snapshot = await this.requireInventorySnapshot(
        group.productId,
        group.lotId,
        scope,
        tx,
      );
      if (
        snapshot.expiryCount !== 1 ||
        !snapshot.expiryAt ||
        snapshot.expiryAt.getTime() <= now.getTime() ||
        snapshot.inStock.lessThan(group.quantity)
      ) {
        throw new Error("COURSE_COMPONENT_STOCK_CHANGED");
      }
      const afterLot = snapshot.inStock.minus(group.quantity);
      const afterTotal = snapshot.totalStock.minus(group.quantity);
      const inventoryLogId = randomUUID();
      await this.repository.deductInventory(
        group.productId,
        group.lotId,
        group.quantity,
        now,
        scope,
        tx,
      );
      await this.repository.createInventoryLog(
        {
          inventoryLogId,
          documentId: evaluation.record.legacy_service_usage_id,
          productId: group.productId,
          lotId: group.lotId,
          stockIn: ZERO,
          stockOut: group.quantity,
          currentStock: afterTotal,
          remark: `OPD V2 course verification ${verificationId}`,
        },
        scope,
        now,
        tx,
      );
      let lotCursor = snapshot.inStock;
      let totalCursor = snapshot.totalStock;
      for (const component of group.components.sort((left, right) =>
        left.component.reservation_component_id.localeCompare(
          right.component.reservation_component_id,
        ),
      )) {
        await this.repository.changeLegacyComponentLot(
          component.legacyComponentId ?? -1,
          component.component.lot_id,
          component.selection.lotId,
          tx,
        );
        const componentAfterLot = lotCursor.minus(
          component.component.total_quantity,
        );
        const componentAfterTotal = totalCursor.minus(
          component.component.total_quantity,
        );
        effects.push({
          verificationComponentId: randomUUID(),
          reservationComponentId: component.component.reservation_component_id,
          productId: component.component.product_id,
          originalLotId: component.component.lot_id,
          actualLotId: component.selection.lotId,
          replacementReason: component.selection.replacementReason,
          expiryAt: snapshot.expiryAt,
          quantity: component.component.total_quantity,
          beforeLotStock: lotCursor,
          afterLotStock: componentAfterLot,
          beforeTotalStock: totalCursor,
          afterTotalStock: componentAfterTotal,
          inventoryLogId,
          inventorySourceUpdatedAt: snapshot.inventoryUpdatedAt,
          snapshotHash: this.sha256(
            this.stableJson({
              reservationComponentId:
                component.component.reservation_component_id,
              productId: component.component.product_id,
              originalLotId: component.component.lot_id,
              actualLotId: component.selection.lotId,
              expiryAt: snapshot.expiryAt.toISOString(),
              quantity: component.component.total_quantity.toString(),
              beforeLotStock: lotCursor.toString(),
              afterLotStock: componentAfterLot.toString(),
              beforeTotalStock: totalCursor.toString(),
              afterTotalStock: componentAfterTotal.toString(),
              inventoryLogId,
            }),
          ),
        });
        lotCursor = componentAfterLot;
        totalCursor = componentAfterTotal;
      }
      if (!lotCursor.equals(afterLot) || !totalCursor.equals(afterTotal)) {
        throw new Error("COURSE_COMPONENT_STOCK_CHANGED");
      }
    }
    return effects;
  }

  private verificationManifest(
    evaluation: VerificationEvaluation,
    verifiedAt: Date,
    signatureHash: string,
    acknowledgementHash: string,
    acknowledgementVersion: string,
    acknowledgementLocale: "th-TH" | "en-US",
  ): Prisma.InputJsonObject {
    return {
      schema: OPD_COURSE_VERIFICATION_MANIFEST_SCHEMA,
      preflightSnapshotHash: evaluation.snapshotHash,
      verifiedAt: verifiedAt.toISOString(),
      clinicId: evaluation.record.clinic_id,
      branchId: evaluation.record.branch_id,
      encounterId: evaluation.record.encounter_id,
      reservationId: evaluation.record.reservation_id,
      customerId: evaluation.record.customer_id,
      legacyOpdId: evaluation.record.legacy_opd_id,
      legacyServiceUsageId: evaluation.record.legacy_service_usage_id,
      sourceReservationVersion: evaluation.record.version,
      resultReservationVersion: evaluation.record.version + 1,
      items: evaluation.itemViews.map((item) => ({
        reservationItemId: item.reservationItemId,
        courseCode: item.courseCode,
        courseName: item.courseName,
        itemName: item.itemName,
        quantity: String(item.quantity),
        reservedBefore: String(item.reservedBefore),
        reservedAfter: String(item.reservedAfter),
        usedBefore: String(item.usedBefore),
        usedAfter: String(item.usedAfter),
        remainingBefore: String(item.remainingBefore),
        remainingAfter: String(item.remainingAfter),
      })),
      components: evaluation.components.map((component) => ({
        reservationComponentId: component.component.reservation_component_id,
        productId: component.component.product_id,
        productCode: component.component.product_code_snapshot,
        productName: component.component.product_name_snapshot,
        originalLotId: component.component.lot_id,
        actualLotId: component.selection.lotId,
        replacementReason: component.selection.replacementReason,
        expiryAt: component.selected?.expiryAt?.toISOString() ?? null,
        quantity: component.component.total_quantity.toString(),
      })),
      operators: evaluation.operatorViews.map((operator) => ({
        userId: operator.userId,
        displayName: operator.displayName,
        roleId: operator.roleId,
        operatorType: operator.operatorType,
      })),
      acknowledgementVersion,
      acknowledgementLocale,
      acknowledgementHash,
      signatureHash,
      renderTemplate: OPD_COURSE_VERIFICATION_RENDER_TEMPLATE,
      renderVersion: 1,
    };
  }

  private renderPdf(
    context: VerificationCommandContext,
    verificationId: string,
    principal: Principal,
    acknowledgementText: string,
  ): Buffer {
    try {
      const input: CourseVerificationPdfInput = {
        verificationId,
        verifiedAt: context.verifiedAt.toISOString(),
        clinicName: context.evaluation.display.clinicName,
        branchName: context.evaluation.display.branchName,
        customerDisplayName: context.evaluation.display.customerDisplayName,
        legacyServiceUsageId: context.evaluation.record.legacy_service_usage_id,
        acknowledgementVersion: OPD_COURSE_ACKNOWLEDGEMENT_VERSION,
        acknowledgementLocale: this.manifestLocale(
          context.verificationManifest,
        ),
        acknowledgementText,
        acknowledgementHash: context.acknowledgementHash,
        manifestHash: context.manifestHash,
        verificationActorName: principal.name,
        items: context.evaluation.itemViews.map((item) => ({
          courseName: item.courseName,
          itemName: item.itemName,
          quantity: String(item.quantity),
          reservedBefore: String(item.reservedBefore),
          usedBefore: String(item.usedBefore),
          reservedAfter: String(item.reservedAfter),
          usedAfter: String(item.usedAfter),
          remaining: String(item.remainingAfter),
        })),
        components: context.evaluation.components.map((component) => ({
          productName: component.component.product_name_snapshot,
          lotId: component.selection.lotId,
          expiryAt:
            component.selected?.expiryAt?.toISOString() ?? "unavailable",
          quantity: component.component.total_quantity.toString(),
        })),
        operators: context.evaluation.operatorViews.map((operator) => ({
          displayName: operator.displayName,
          roleId: operator.roleId,
          operatorType: operator.operatorType,
        })),
        signature: context.signature,
      };
      return renderCourseVerificationPdf(input);
    } catch {
      throw new ConflictException({
        code: "COURSE_EVIDENCE_RENDER_FAILED",
        message: "The immutable course verification PDF could not be rendered",
      });
    }
  }

  private async stageEvidence(
    verificationId: string,
    context: VerificationCommandContext,
    pdf: Buffer,
    scope: RequestScope,
  ): Promise<StagedEvidence> {
    const signatureFileId = randomUUID();
    const pdfFileId = randomUUID();
    const prefix = [
      "clinics",
      scope.clinicId,
      "customers",
      context.evaluation.record.customer_id,
      "opd",
      context.evaluation.record.encounter_id,
      "course-verifications",
      context.evaluation.record.reservation_id,
      verificationId,
    ]
      .map(encodeURIComponent)
      .join("/");
    const signatureObjectKey = `${prefix}/customer-signature.png`;
    const pdfObjectKey = `${prefix}/course-use-verification.pdf`;
    let signatureObject: StoredObject | null = null;
    let pdfObject: StoredObject | null = null;
    try {
      signatureObject = await this.storageService.uploadObject({
        objectKey: signatureObjectKey,
        body: context.signature.bytes,
        mimeType: "image/png",
        fileSize: context.signature.bytes.length,
      });
      await this.assertStoredObject(
        signatureObject,
        context.signature.bytes.length,
        context.signature.hash,
      );
      pdfObject = await this.storageService.uploadObject({
        objectKey: pdfObjectKey,
        body: pdf,
        mimeType: "application/pdf",
        fileSize: pdf.length,
      });
      const pdfHash = this.sha256(pdf);
      await this.assertStoredObject(pdfObject, pdf.length, pdfHash);
      return {
        signatureObject,
        pdfObject,
        evidence: {
          signatureFileId,
          signatureOriginalName: "customer-signature.png",
          signatureBytes: context.signature.bytes.length,
          signatureHash: context.signature.hash,
          signatureStorageProvider: signatureObject.provider,
          signatureBucketName: signatureObject.bucketName,
          signatureObjectKey: signatureObject.objectKey,
          pdfFileId,
          pdfOriginalName: `course-use-verification-${verificationId}.pdf`,
          pdfBytes: pdf.length,
          pdfHash,
          pdfStorageProvider: pdfObject.provider,
          pdfBucketName: pdfObject.bucketName,
          pdfObjectKey: pdfObject.objectKey,
        },
      };
    } catch (error) {
      if (pdfObject) {
        await this.deleteStagedObject(pdfObject, "pdf-stage-failed");
      }
      if (signatureObject) {
        await this.deleteStagedObject(
          signatureObject,
          "signature-stage-failed",
        );
      }
      this.logger.error({
        event: "opd.course_verification.evidence_stage_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw new ConflictException({
        code: "COURSE_EVIDENCE_STORAGE_FAILED",
        message:
          "Private course-verification evidence could not be staged and verified",
      });
    }
  }

  private async assertStoredObject(
    object: StoredObject,
    expectedBytes: number,
    expectedHash: string,
  ): Promise<void> {
    const stored = await this.storageService.readObject({
      provider: object.provider,
      bucketName: object.bucketName,
      objectKey: object.objectKey,
    });
    if (
      stored.length !== expectedBytes ||
      this.sha256(stored) !== expectedHash
    ) {
      throw new Error("Stored evidence checksum or byte count mismatch");
    }
  }

  private async cleanupStagedEvidence(staged: StagedEvidence): Promise<void> {
    await Promise.all([
      this.deleteStagedObject(staged.pdfObject, "transaction-rollback"),
      this.deleteStagedObject(staged.signatureObject, "transaction-rollback"),
    ]);
  }

  private async deleteStagedObject(
    object: StoredObject,
    reason: string,
  ): Promise<void> {
    try {
      await this.storageService.deleteObject({
        provider: object.provider,
        bucketName: object.bucketName,
        objectKey: object.objectKey,
      });
    } catch (error) {
      this.logger.error({
        event: "opd.course_verification.orphan_object",
        reason,
        provider: object.provider,
        bucketHash: this.sha256(object.bucketName),
        objectKeyHash: this.sha256(object.objectKey),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async lockCourseAggregate(
    encounterId: string,
    reservationId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (
      !(await this.reservationRepository.lockEncounter(encounterId, scope, tx))
    ) {
      this.throwEncounterNotFound();
    }
    if (
      !(await this.reservationRepository.lockReservation(
        encounterId,
        reservationId,
        scope,
        tx,
      ))
    ) {
      this.throwReservationNotFound();
    }
  }

  private assertUsedLegacyState(
    record: OpdCourseReservationRecord,
    verification: OpdCourseVerificationRecord,
    state: LegacyCourseReservationState,
    expectPendingCancellation: boolean,
  ): void {
    const usage = state.serviceUsage;
    if (
      !usage ||
      usage.status !== "ACTIVE" ||
      usage.service_usage_status !== "APPROVED" ||
      usage.customer_id !== record.customer_id ||
      usage.customer_owner_id !== record.customer_id ||
      usage.verify_by !== verification.verified_by_user_id ||
      usage.verify_at?.getTime() !== verification.verified_at.getTime() ||
      usage.document_url !== verification.legacy_document_url ||
      state.legacyOpd?.management_item !== record.legacy_service_usage_id ||
      state.usageLogs.length !== record.items.length
    ) {
      this.throwConflict(
        "MANUAL_RECONCILIATION_REQUIRED",
        "The committed course verification no longer reconciles with legacy state",
      );
    }
    if (
      expectPendingCancellation !==
      Boolean(usage.service_usage_request_cancel?.status === "PENDING")
    ) {
      this.throwConflict(
        "MANUAL_RECONCILIATION_REQUIRED",
        "The legacy compensation request state diverged",
      );
    }
    for (const item of record.items) {
      const log = state.usageLogs.find(
        (candidate) => candidate.id === item.legacy_usage_log_id,
      );
      if (
        !log ||
        log.status !== "USED" ||
        log.item_id !== item.course_item_id ||
        !log.amount?.equals(item.reserved_amount) ||
        log.expire_date.getTime() !== item.entitlement_expire_at.getTime()
      ) {
        this.throwConflict(
          "MANUAL_RECONCILIATION_REQUIRED",
          "A USED course log no longer matches verification evidence",
        );
      }
    }
  }

  private verificationComponentGroups(
    verification: OpdCourseVerificationRecord,
  ): Array<{
    productId: string;
    lotId: string;
    inventoryLogId: string;
    quantity: Prisma.Decimal;
    components: OpdCourseVerificationRecord["components"];
  }> {
    const groups = new Map<
      string,
      {
        productId: string;
        lotId: string;
        inventoryLogId: string;
        quantity: Prisma.Decimal;
        components: OpdCourseVerificationRecord["components"];
      }
    >();
    for (const component of verification.components) {
      const key = `${component.product_id}|${component.actual_lot_id}|${component.inventory_log_id}`;
      const group = groups.get(key) ?? {
        productId: component.product_id,
        lotId: component.actual_lot_id,
        inventoryLogId: component.inventory_log_id,
        quantity: ZERO,
        components: [],
      };
      group.quantity = group.quantity.plus(component.quantity);
      group.components.push(component);
      groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) =>
      `${left.productId}|${left.lotId}`.localeCompare(
        `${right.productId}|${right.lotId}`,
      ),
    );
  }

  private async requireInventorySnapshot(
    productId: string,
    lotId: string,
    scope: RequestScope,
    client: DatabaseClient,
  ): Promise<CourseVerificationInventorySnapshot> {
    const lots = await this.repository.inventoryLots(productId, scope, client);
    const selected = lots.find((lot) => lot.lotId === lotId);
    if (!selected) throw new Error("COURSE_COMPONENT_LOT_INVALID");
    return selected;
  }

  private async runCourseCommandWithRetry<T>(
    command: () => Promise<T>,
    allowRetry = true,
  ): Promise<T> {
    try {
      return await command();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002")
      ) {
        if (allowRetry) {
          return this.runCourseCommandWithRetry(command, false);
        }
        this.throwConflict(
          "IDEMPOTENCY_IN_PROGRESS",
          "A concurrent course compensation command is still settling; retry with the same key",
          { retryAfterSeconds: 1 },
        );
      }
      throw error;
    }
  }

  private async commandReplay(
    operation: string,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<OpdCourseCompensationResult | null> {
    const existing = await this.reservationRepository.findIdempotency(
      operation,
      idempotencyKey,
      scope,
      tx,
    );
    if (!existing) return null;
    if (existing.request_hash !== requestHash) {
      this.throwConflict(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used with another payload",
      );
    }
    if (existing.state !== "COMPLETED" || !existing.resource_id) {
      this.throwConflict(
        "IDEMPOTENCY_IN_PROGRESS",
        "This course compensation command is still in progress",
      );
    }
    const request = await this.repository.findCompensationRequestById(
      existing.resource_id,
      scope,
      tx,
    );
    if (!request) {
      this.throwConflict(
        "MANUAL_RECONCILIATION_REQUIRED",
        "The completed command cannot resolve its compensation request",
      );
    }
    const record = await this.requireReservation(
      request.encounter_id,
      request.reservation_id,
      scope,
      tx,
    );
    return {
      reservationId: record.reservation_id,
      reservationStatus:
        record.status === "COMPENSATED" ? "COMPENSATED" : "USED",
      reservationVersion: record.version,
      request: toOpdCourseCompensationRequestView(request),
    };
  }

  private async compensationResult(
    encounterId: string,
    reservationId: string,
    requestId: string,
    scope: RequestScope,
    client: DatabaseClient,
  ): Promise<OpdCourseCompensationResult> {
    const record = await this.requireReservation(
      encounterId,
      reservationId,
      scope,
      client,
    );
    const request = await this.repository.findCompensationRequestById(
      requestId,
      scope,
      client,
    );
    if (!request) {
      throw new Error("Course compensation request could not be reloaded");
    }
    return {
      reservationId,
      reservationStatus:
        record.status === "COMPENSATED" ? "COMPENSATED" : "USED",
      reservationVersion: record.version,
      request: toOpdCourseCompensationRequestView(request),
    };
  }

  private verificationResult(
    record: OpdCourseReservationRecord,
    verification: OpdCourseVerificationRecord,
  ): OpdCourseVerificationResult {
    return {
      ...toOpdCourseVerificationSummary(
        verification,
        record.status === "COMPENSATED",
      ),
      reservationId: record.reservation_id,
      encounterId: record.encounter_id,
      status: record.status === "COMPENSATED" ? "COMPENSATED" : "USED",
      version: record.version,
    };
  }

  private verificationSnapshot(
    result: OpdCourseVerificationResult,
  ): Prisma.InputJsonObject {
    return {
      verificationId: result.verificationId,
      reservationId: result.reservationId,
      encounterId: result.encounterId,
      status: result.status,
      version: result.version,
      verifiedAt: result.verifiedAt,
      manifestHash: result.manifestHash,
    };
  }

  private compensationSnapshot(
    result: OpdCourseCompensationResult,
  ): Prisma.InputJsonObject {
    return {
      reservationId: result.reservationId,
      reservationStatus: result.reservationStatus,
      reservationVersion: result.reservationVersion,
      compensationRequestId: result.request.requestId,
      compensationStatus: result.request.status,
      compensationVersion: result.request.version,
    };
  }

  private reviewRequestHash(
    operation: string,
    encounterId: string,
    reservationId: string,
    requestId: string,
    dto: ReviewOpdCourseCompensationDto,
    reason: string,
  ): string {
    return this.sha256(
      this.stableJson({
        operation,
        encounterId,
        reservationId,
        requestId,
        expectedReservationVersion: dto.expectedReservationVersion,
        expectedRequestVersion: dto.expectedRequestVersion,
        reason,
      }),
    );
  }

  private normalizeSignature(
    file: Express.Multer.File | undefined,
  ): NormalizedSignature {
    if (!file) {
      throw new BadRequestException({
        code: "COURSE_SIGNATURE_REQUIRED",
        message: "A fresh customer signature PNG is required",
      });
    }
    if (
      file.mimetype !== "image/png" ||
      file.size <= 0 ||
      file.size > SIGNATURE_LIMIT_BYTES
    ) {
      throw new BadRequestException({
        code: "COURSE_SIGNATURE_INVALID",
        message: "Signature must be a non-empty PNG no larger than 1 MiB",
      });
    }
    try {
      return normalizeCourseVerificationSignature(file.buffer);
    } catch (error) {
      throw new BadRequestException({
        code: "COURSE_SIGNATURE_INVALID",
        message:
          error instanceof Error ? error.message : "Signature PNG is invalid",
      });
    }
  }

  private normalizeSelections(
    selections: OpdCourseVerificationLotSelectionDto[] | undefined,
  ): VerificationTokenSelection[] {
    return (selections ?? [])
      .map((selection) => ({
        reservationComponentId: selection.reservationComponentId,
        lotId: selection.lotId.trim(),
        replacementReason: selection.replacementReason?.trim() || null,
      }))
      .sort((left, right) =>
        left.reservationComponentId.localeCompare(right.reservationComponentId),
      );
  }

  private verifyPreflightToken(
    token: string,
    expected: {
      encounterId: string;
      reservationId: string;
      expectedVersion: number;
      scope: RequestScope;
    },
  ): VerificationPreflightTokenPayload {
    const payload = this.readSignedToken(token, backendEnv().JWT_SECRET);
    if (
      !this.isVerificationTokenPayload(payload) ||
      payload.clinicId !== expected.scope.clinicId ||
      payload.branchId !== expected.scope.branchId ||
      payload.actorUserId !== expected.scope.userId ||
      payload.encounterId !== expected.encounterId ||
      payload.reservationId !== expected.reservationId ||
      payload.expectedVersion !== expected.expectedVersion
    ) {
      this.throwConflict(
        "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED",
        "The verification preflight token is stale or invalid",
      );
    }
    return payload;
  }

  private isVerificationTokenPayload(
    value: unknown,
  ): value is VerificationPreflightTokenPayload {
    if (!this.isRecord(value) || value.version !== 1) return false;
    return (
      typeof value.clinicId === "string" &&
      typeof value.branchId === "string" &&
      typeof value.actorUserId === "string" &&
      typeof value.encounterId === "string" &&
      typeof value.reservationId === "string" &&
      typeof value.customerId === "string" &&
      typeof value.expectedVersion === "number" &&
      typeof value.snapshotHash === "string" &&
      /^[0-9a-f]{64}$/.test(value.snapshotHash) &&
      Array.isArray(value.selections) &&
      value.selections.every(
        (selection) =>
          this.isRecord(selection) &&
          typeof selection.reservationComponentId === "string" &&
          typeof selection.lotId === "string" &&
          (selection.replacementReason === null ||
            typeof selection.replacementReason === "string"),
      ) &&
      typeof value.issuedAtMs === "number" &&
      typeof value.expiresAtMs === "number"
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
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra) return null;
    const expected = createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return null;
    }
    try {
      return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  private legacyDocumentUrl(
    encounterId: string,
    reservationId: string,
  ): string {
    const base = backendEnv().API_PUBLIC_BASE_URL.replace(/\/$/, "");
    return `${base}/api/v1/clinic/opd/${encodeURIComponent(
      encounterId,
    )}/course-reservations/${encodeURIComponent(
      reservationId,
    )}/verification/document`;
  }

  private manifestLocale(manifest: Prisma.InputJsonObject): "th-TH" | "en-US" {
    return manifest.acknowledgementLocale === "th-TH" ? "th-TH" : "en-US";
  }

  private capabilityEnabled(): boolean {
    const env = backendEnv();
    return (
      env.OPD_COURSE_RESERVATION_ENABLED && env.OPD_COURSE_VERIFICATION_ENABLED
    );
  }

  private assertCapabilityEnabled(): void {
    if (this.capabilityEnabled()) return;
    this.throwConflict(
      "COURSE_VERIFICATION_DISABLED",
      "Course verification and compensation are disabled by the rollout gate",
    );
  }

  private encounterSupportsVerification(encounter: opd_encounter): boolean {
    return (
      (encounter.workflow_status === "OPEN" &&
        encounter.clinical_record_status === "DRAFT") ||
      (encounter.workflow_status === "POST_VISIT" &&
        encounter.clinical_record_status === "FINALIZED")
    );
  }

  private assertEncounterCompensable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "CLOSED" &&
      encounter.workflow_status !== "CANCELLED"
    ) {
      return;
    }
    this.throwConflict(
      "COURSE_COMPENSATION_NOT_ALLOWED",
      "Course compensation must complete before visit close or cancellation",
    );
  }

  private assertSeparateActor(requesterId: string, reviewerId: string): void {
    if (requesterId !== reviewerId) return;
    this.throwConflict(
      "COURSE_COMPENSATION_SEPARATION_REQUIRED",
      "The compensation reviewer must be different from the requester",
    );
  }

  private async requireEncounter(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_encounter> {
    const encounter = await this.reservationRepository.findEncounter(
      encounterId,
      scope,
      client,
    );
    if (!encounter) this.throwEncounterNotFound();
    return encounter;
  }

  private async requireReservation(
    encounterId: string,
    reservationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdCourseReservationRecord> {
    const record = await this.reservationRepository.findReservation(
      encounterId,
      reservationId,
      scope,
      client,
    );
    if (!record) this.throwReservationNotFound();
    return record;
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const key = value?.trim() ?? "";
    if (key.length < 8 || key.length > 200) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key must contain 8 to 200 characters",
      });
    }
    return key;
  }

  private blocker(
    code: OpdCourseVerificationBlockerCode,
    message: string,
    reservationComponentId: string | null = null,
    productId: string | null = null,
  ): OpdCourseVerificationBlockerView {
    return { code, message, reservationComponentId, productId };
  }

  private dedupeBlockers(
    blockers: OpdCourseVerificationBlockerView[],
  ): OpdCourseVerificationBlockerView[] {
    const seen = new Set<string>();
    return blockers.filter((blocker) => {
      const key = `${blocker.code}|${blocker.reservationComponentId ?? ""}|${blocker.productId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(",")}]`;
    }
    if (this.isRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableJson(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private decimalNumber(value: Prisma.Decimal): number {
    const parsed = Number(value.toString());
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid decimal in course verification");
    }
    return parsed;
  }

  private sha256(value: string | Buffer): string {
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
    metadata?: Record<string, unknown>,
  ): never {
    throw new ConflictException({ code, message, ...(metadata ?? {}) });
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException({
      code: "OPD_ENCOUNTER_NOT_FOUND",
      message: "OPD encounter not found in the active scope",
    });
  }

  private throwReservationNotFound(): never {
    throw new NotFoundException({
      code: "COURSE_RESERVATION_NOT_FOUND",
      message: "Course reservation not found in the active scope",
    });
  }

  private rethrowCommandError(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        this.throwConflict(
          "COURSE_ALREADY_VERIFIED",
          "Another request already committed this course verification",
        );
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const stableCodes = [
      "COURSE_COMPONENT_LOT_INVALID",
      "COURSE_COMPONENT_STOCK_CHANGED",
      "COURSE_USAGE_LOG_MISMATCH",
      "COURSE_LEGACY_STATE_MISMATCH",
      "COURSE_RESERVATION_VERSION_CONFLICT",
      "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED",
      "IDEMPOTENCY_IN_PROGRESS",
      "MANUAL_RECONCILIATION_REQUIRED",
    ];
    const code =
      stableCodes.find((candidate) => message.includes(candidate)) ??
      "MANUAL_RECONCILIATION_REQUIRED";
    this.throwConflict(
      code,
      code === "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED"
        ? "The verification state changed; run a fresh preflight"
        : "Course verification could not commit without risking partial effects",
    );
  }
}

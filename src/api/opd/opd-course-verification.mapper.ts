import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";

export const OPD_COURSE_VERIFY_PERMISSIONS = [
  "OPD_EDIT",
  "TREATMENT_EDIT",
  "OPD_COURSE_VERIFY",
] as const;
export const OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS = [
  "OPD_EDIT",
  "TREATMENT_EDIT",
  "PURCHASE-COURSE_DELETE",
] as const;
export const OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS = [
  "OPD_EDIT",
  "TREATMENT_EDIT",
  "OPD_COURSE_COMPENSATE",
] as const;
export const OPD_COURSE_EVIDENCE_READ_PERMISSIONS = [
  "OPD_READ",
  "CUSTOMER_COURSE_READ",
] as const;
export const OPD_COURSE_VERIFICATION_MANIFEST_SCHEMA =
  "opd-course-verification-v1" as const;
export const OPD_COURSE_VERIFICATION_RENDER_TEMPLATE =
  "opd-course-use-verification-v1" as const;
export const OPD_COURSE_ACKNOWLEDGEMENT_VERSION =
  "opd-course-use-ack-v1" as const;
export const OPD_COURSE_ACKNOWLEDGEMENT_TEXT = {
  "th-TH":
    "ข้าพเจ้ายืนยันว่าได้รับบริการตามรายการคอร์สและรับทราบจำนวนคงเหลือกับการใช้ผลิตภัณฑ์ตามที่แสดง",
  "en-US":
    "I confirm receipt of the listed course services and acknowledge the displayed remaining balances and component use.",
} as const;

export type OpdCourseVerificationBlockerCode =
  | "COURSE_VERIFICATION_DISABLED"
  | "COURSE_VERIFICATION_PERMISSION_REQUIRED"
  | "COURSE_RESERVATION_NOT_FOUND"
  | "COURSE_RESERVATION_NOT_RESERVED"
  | "COURSE_RESERVATION_VERSION_CONFLICT"
  | "COURSE_ALREADY_VERIFIED"
  | "COURSE_ENCOUNTER_STATE_UNSUPPORTED"
  | "COURSE_LEGACY_STATE_MISMATCH"
  | "COURSE_USAGE_LOG_MISMATCH"
  | "COURSE_OPERATOR_SNAPSHOT_MISMATCH"
  | "COURSE_COMPONENT_LOT_REQUIRED"
  | "COURSE_COMPONENT_LOT_INVALID"
  | "COURSE_COMPONENT_LOT_EXPIRED"
  | "COURSE_COMPONENT_EXPIRY_AMBIGUOUS"
  | "COURSE_COMPONENT_STOCK_CHANGED"
  | "COURSE_COMPONENT_STOCK_INSUFFICIENT"
  | "COURSE_VERIFICATION_REPREFLIGHT_REQUIRED"
  | "COURSE_CANCELLATION_PENDING"
  | "MANUAL_RECONCILIATION_REQUIRED";

export class OpdCourseVerificationBlockerView {
  @ApiProperty()
  code!: OpdCourseVerificationBlockerCode;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  reservationComponentId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  productId!: string | null;
}

export class OpdCourseVerificationLotView {
  @ApiProperty()
  lotId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiryAt!: string | null;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty()
  eligible!: boolean;
}

export class OpdCourseVerificationComponentView {
  @ApiProperty({ format: "uuid" })
  reservationComponentId!: string;

  @ApiProperty({ format: "uuid" })
  reservationItemId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productCode!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  requiredQuantity!: number;

  @ApiProperty()
  originalLotId!: string;

  @ApiProperty()
  actualLotId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  replacementReason!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiryAt!: string | null;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty()
  totalProductStock!: number;

  @ApiProperty({ type: [OpdCourseVerificationLotView] })
  candidateLots!: OpdCourseVerificationLotView[];

  @ApiProperty({ type: [OpdCourseVerificationBlockerView] })
  blockers!: OpdCourseVerificationBlockerView[];
}

export class OpdCourseVerificationItemView {
  @ApiProperty({ format: "uuid" })
  reservationItemId!: string;

  @ApiProperty()
  courseCode!: string;

  @ApiProperty()
  courseName!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  reservedBefore!: number;

  @ApiProperty()
  usedBefore!: number;

  @ApiProperty()
  reservedAfter!: number;

  @ApiProperty()
  usedAfter!: number;

  @ApiProperty()
  remainingBefore!: number;

  @ApiProperty()
  remainingAfter!: number;
}

export class OpdCourseVerificationOperatorView {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty({ enum: ["OPERATOR", "ASSISTANT"] })
  operatorType!: "OPERATOR" | "ASSISTANT";
}

export class OpdCourseAcknowledgementView {
  @ApiProperty({ enum: [OPD_COURSE_ACKNOWLEDGEMENT_VERSION] })
  version!: typeof OPD_COURSE_ACKNOWLEDGEMENT_VERSION;

  @ApiProperty()
  textTh!: string;

  @ApiProperty()
  textEn!: string;
}

export class OpdCourseVerificationPreflightResult {
  @ApiProperty()
  capabilityEnabled!: boolean;

  @ApiProperty()
  eligible!: boolean;

  @ApiProperty({ format: "uuid" })
  reservationId!: string;

  @ApiProperty()
  expectedVersion!: number;

  @ApiProperty({ type: [OpdCourseVerificationBlockerView] })
  blockers!: OpdCourseVerificationBlockerView[];

  @ApiProperty({ type: [OpdCourseVerificationItemView] })
  items!: OpdCourseVerificationItemView[];

  @ApiProperty({ type: [OpdCourseVerificationComponentView] })
  components!: OpdCourseVerificationComponentView[];

  @ApiProperty({ type: [OpdCourseVerificationOperatorView] })
  operators!: OpdCourseVerificationOperatorView[];

  @ApiProperty({ type: OpdCourseAcknowledgementView })
  acknowledgement!: OpdCourseAcknowledgementView;

  @ApiProperty({ enum: OPD_COURSE_VERIFY_PERMISSIONS, isArray: true })
  requiredPermissions!: Array<(typeof OPD_COURSE_VERIFY_PERMISSIONS)[number]>;

  @ApiPropertyOptional({ type: String, nullable: true })
  preflightToken!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiresAt!: string | null;

  @ApiProperty({ default: false })
  courseUsed!: false;

  @ApiProperty({ default: false })
  componentStockDeducted!: false;
}

export class OpdCourseVerifiedComponentView {
  @ApiProperty({ format: "uuid" })
  verificationComponentId!: string;

  @ApiProperty({ format: "uuid" })
  reservationComponentId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  originalLotId!: string;

  @ApiProperty()
  actualLotId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  replacementReason!: string | null;

  @ApiProperty()
  expiryAt!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  beforeLotStock!: number;

  @ApiProperty()
  afterLotStock!: number;

  @ApiProperty()
  beforeTotalStock!: number;

  @ApiProperty()
  afterTotalStock!: number;

  @ApiProperty()
  inventoryLogId!: string;
}

export class OpdCourseCompensationRequestView {
  @ApiProperty({ format: "uuid" })
  requestId!: string;

  @ApiProperty({ enum: ["PENDING", "REJECTED", "APPROVED"] })
  status!: "PENDING" | "REJECTED" | "APPROVED";

  @ApiProperty()
  version!: number;

  @ApiProperty()
  reasonCode!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  requestedBy!: string;

  @ApiProperty()
  requestedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  reviewedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  reviewedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  reviewReason!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  adjustmentDocumentId!: string | null;
}

export class OpdCourseVerificationSummaryView {
  @ApiProperty({ format: "uuid" })
  verificationId!: string;

  @ApiProperty()
  verifiedBy!: string;

  @ApiProperty()
  verifiedAt!: string;

  @ApiProperty()
  manifestHash!: string;

  @ApiProperty()
  acknowledgementVersion!: string;

  @ApiProperty()
  acknowledgementLocale!: string;

  @ApiProperty()
  renderTemplate!: string;

  @ApiProperty()
  renderVersion!: number;

  @ApiProperty()
  documentAvailable!: boolean;

  @ApiProperty()
  documentHash!: string;

  @ApiProperty()
  evidenceSuperseded!: boolean;

  @ApiProperty({ type: [OpdCourseVerifiedComponentView] })
  components!: OpdCourseVerifiedComponentView[];

  @ApiPropertyOptional({
    type: OpdCourseCompensationRequestView,
    nullable: true,
  })
  compensation!: OpdCourseCompensationRequestView | null;
}

export class OpdCourseVerificationResult extends OpdCourseVerificationSummaryView {
  @ApiProperty({ format: "uuid" })
  reservationId!: string;

  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty({ enum: ["USED", "COMPENSATED"] })
  status!: "USED" | "COMPENSATED";

  @ApiProperty()
  version!: number;
}

export class OpdCourseCompensationResult {
  @ApiProperty({ format: "uuid" })
  reservationId!: string;

  @ApiProperty({ enum: ["USED", "COMPENSATED"] })
  reservationStatus!: "USED" | "COMPENSATED";

  @ApiProperty()
  reservationVersion!: number;

  @ApiProperty({ type: OpdCourseCompensationRequestView })
  request!: OpdCourseCompensationRequestView;
}

export class OpdCourseVerificationDocumentResult {
  @ApiProperty()
  url!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  mimeType!: "application/pdf";
}

export type OpdCourseVerificationRecord =
  Prisma.opd_course_verificationGetPayload<{
    include: {
      components: true;
      compensation_requests: {
        include: { components: true };
        orderBy: { requested_at: "desc" };
      };
    };
  }>;

function decimalNumber(value: Prisma.Decimal): number {
  const parsed = Number(value.toString());
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid decimal in OPD course verification evidence");
  }
  return parsed;
}

export function toOpdCourseCompensationRequestView(
  request: OpdCourseVerificationRecord["compensation_requests"][number],
): OpdCourseCompensationRequestView {
  const status =
    request.status === "APPROVED"
      ? "APPROVED"
      : request.status === "REJECTED"
        ? "REJECTED"
        : "PENDING";
  return {
    requestId: request.compensation_request_id,
    status,
    version: request.version,
    reasonCode: request.reason_code,
    description: request.reason_description,
    requestedBy: request.requested_by_user_id,
    requestedAt: request.requested_at.toISOString(),
    reviewedBy: request.reviewed_by_user_id,
    reviewedAt: request.reviewed_at?.toISOString() ?? null,
    reviewReason: request.review_reason,
    adjustmentDocumentId: request.adjustment_document_id,
  };
}

export function toOpdCourseVerificationSummary(
  verification: OpdCourseVerificationRecord,
  compensated: boolean,
): OpdCourseVerificationSummaryView {
  return {
    verificationId: verification.verification_id,
    verifiedBy: verification.verified_by_user_id,
    verifiedAt: verification.verified_at.toISOString(),
    manifestHash: verification.manifest_hash,
    acknowledgementVersion: verification.acknowledgement_version,
    acknowledgementLocale: verification.acknowledgement_locale,
    renderTemplate: verification.render_template,
    renderVersion: verification.render_version,
    documentAvailable: true,
    documentHash: verification.pdf_hash,
    evidenceSuperseded: compensated,
    components: verification.components.map((component) => ({
      verificationComponentId: component.verification_component_id,
      reservationComponentId: component.reservation_component_id,
      productId: component.product_id,
      originalLotId: component.original_lot_id,
      actualLotId: component.actual_lot_id,
      replacementReason: component.replacement_reason,
      expiryAt: component.expiry_at.toISOString(),
      quantity: decimalNumber(component.quantity),
      beforeLotStock: decimalNumber(component.before_lot_stock),
      afterLotStock: decimalNumber(component.after_lot_stock),
      beforeTotalStock: decimalNumber(component.before_total_stock),
      afterTotalStock: decimalNumber(component.after_total_stock),
      inventoryLogId: component.inventory_log_id,
    })),
    compensation: verification.compensation_requests[0]
      ? toOpdCourseCompensationRequestView(
          verification.compensation_requests[0],
        )
      : null,
  };
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import {
  OpdCourseVerificationSummaryView,
  toOpdCourseVerificationSummary,
} from "./opd-course-verification.mapper";

export const OPD_COURSE_RESERVATION_READ_PERMISSIONS = [
  "OPD_READ",
  "TREATMENT_READ",
  "CUSTOMER_COURSE_READ",
] as const;
export const OPD_COURSE_RESERVATION_WRITE_PERMISSIONS = [
  "OPD_EDIT",
  "TREATMENT_EDIT",
  "PURCHASE-COURSE_CREATE",
] as const;
export const OPD_COURSE_RESERVATION_VOID_PERMISSIONS = [
  "OPD_EDIT",
  "TREATMENT_EDIT",
  "PURCHASE-COURSE_DELETE",
] as const;
export const OPD_COURSE_RESERVATION_POLICY =
  "opd-existing-course-reservation-v1" as const;

export type OpdCourseReservationBlockerCode =
  | "COURSE_RESERVATION_DISABLED"
  | "ENCOUNTER_NOT_OPEN"
  | "CLINICAL_RECORD_NOT_DRAFT"
  | "LEGACY_OPD_REQUIRED"
  | "LEGACY_OPD_MISMATCH"
  | "LEGACY_SERVICE_USAGE_EXISTS"
  | "COURSE_RESERVATION_EXISTS"
  | "COURSE_ENTITLEMENT_NOT_FOUND"
  | "COURSE_ENTITLEMENT_SCOPE_MISMATCH"
  | "COURSE_ENTITLEMENT_CUSTOMER_MISMATCH"
  | "COURSE_ENTITLEMENT_PAYMENT_REQUIRED"
  | "COURSE_ENTITLEMENT_BRANCH_UNSUPPORTED"
  | "COURSE_ENTITLEMENT_EXPIRED"
  | "COURSE_BALANCE_INCONSISTENT"
  | "COURSE_BALANCE_INSUFFICIENT"
  | "COURSE_QUANTITY_INVALID"
  | "COURSE_COMPONENT_LOT_REQUIRED"
  | "COURSE_COMPONENT_LOT_INVALID"
  | "COURSE_COMPONENT_STOCK_CHANGED"
  | "COURSE_OPERATOR_UNRESOLVED";

export interface OpdCourseReservationBlocker {
  code: OpdCourseReservationBlockerCode;
  message: string;
  entitlementToken: string | null;
  productId: string | null;
}

export class OpdCourseReservationBlockerView {
  @ApiProperty()
  code!: OpdCourseReservationBlockerCode;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  entitlementToken!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  productId!: string | null;
}

export class OpdCourseBalanceView {
  @ApiProperty()
  purchased!: number;

  @ApiProperty()
  reserved!: number;

  @ApiProperty()
  used!: number;

  @ApiProperty()
  remaining!: number;
}

export class OpdCourseComponentSummaryView {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productCode!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  quantityPerSession!: number;
}

export class OpdCourseEntitlementView {
  @ApiProperty()
  entitlementToken!: string;

  @ApiProperty()
  purchaseBranchId!: string;

  @ApiProperty()
  saleOrderId!: string;

  @ApiProperty()
  saleOrderStatus!: string;

  @ApiProperty()
  courseId!: string;

  @ApiProperty()
  courseCode!: string;

  @ApiProperty()
  courseName!: string;

  @ApiProperty()
  courseItemId!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  entitlementExpireAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  displayExpireAt!: string | null;

  @ApiProperty({ type: OpdCourseBalanceView })
  balance!: OpdCourseBalanceView;

  @ApiProperty({ type: [OpdCourseComponentSummaryView] })
  components!: OpdCourseComponentSummaryView[];

  @ApiProperty()
  eligible!: boolean;

  @ApiProperty()
  excludedByPolicy!: boolean;

  @ApiProperty({ type: [OpdCourseReservationBlockerView] })
  blockers!: OpdCourseReservationBlockerView[];
}

export class OpdCourseEntitlementListResult {
  @ApiProperty()
  capabilityEnabled!: boolean;

  @ApiProperty({ enum: [OPD_COURSE_RESERVATION_POLICY] })
  policy!: typeof OPD_COURSE_RESERVATION_POLICY;

  @ApiProperty({ default: true })
  samePurchaseBranchOnly!: true;

  @ApiProperty({ default: true })
  fullyPaidOnly!: true;

  @ApiProperty({ type: [OpdCourseEntitlementView] })
  items!: OpdCourseEntitlementView[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class OpdCourseComponentLotView {
  @ApiProperty()
  lotId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiryAt!: string | null;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty()
  eligible!: boolean;
}

export class OpdCourseReservationComponentView extends OpdCourseComponentSummaryView {
  @ApiProperty()
  requiredQuantity!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  selectedLotId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  selectedExpiryAt!: string | null;

  @ApiProperty({ type: [OpdCourseComponentLotView] })
  candidateLots!: OpdCourseComponentLotView[];
}

export class OpdCourseOperatorSummaryView {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty({ enum: ["OPERATOR", "ASSISTANT"] })
  operatorType!: "OPERATOR" | "ASSISTANT";
}

export class OpdCourseReservationPreflightItemView {
  @ApiProperty()
  entitlementToken!: string;

  @ApiProperty()
  courseCode!: string;

  @ApiProperty()
  courseName!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ type: OpdCourseBalanceView })
  before!: OpdCourseBalanceView;

  @ApiProperty()
  remainingAfterReservation!: number;

  @ApiProperty({ type: [OpdCourseReservationComponentView] })
  components!: OpdCourseReservationComponentView[];

  @ApiProperty({ type: [OpdCourseOperatorSummaryView] })
  operators!: OpdCourseOperatorSummaryView[];
}

export class OpdCourseReservationPreflightResult {
  @ApiProperty()
  capabilityEnabled!: boolean;

  @ApiProperty()
  eligible!: boolean;

  @ApiProperty({ type: [OpdCourseReservationBlockerView] })
  blockers!: OpdCourseReservationBlockerView[];

  @ApiProperty({ type: [OpdCourseReservationPreflightItemView] })
  items!: OpdCourseReservationPreflightItemView[];

  @ApiProperty({
    enum: OPD_COURSE_RESERVATION_WRITE_PERMISSIONS,
    isArray: true,
  })
  requiredPermissions!: Array<
    (typeof OPD_COURSE_RESERVATION_WRITE_PERMISSIONS)[number]
  >;

  @ApiPropertyOptional({ type: String, nullable: true })
  preflightToken!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiresAt!: string | null;

  @ApiProperty({ default: false })
  courseBalanceReserved!: false;

  @ApiProperty({ default: false })
  componentStockReserved!: false;
}

export class OpdCourseReservedItemView {
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
  beforeRemaining!: number;

  @ApiProperty()
  afterRemaining!: number;

  @ApiProperty()
  purchased!: number;

  @ApiProperty()
  currentReserved!: number;

  @ApiProperty()
  currentUsed!: number;

  @ApiProperty()
  currentRemaining!: number;

  @ApiProperty()
  entitlementExpireAt!: string;
}

export class OpdCourseReservationResult {
  @ApiProperty({ format: "uuid" })
  reservationId!: string;

  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty({ enum: ["RESERVED", "VOIDED", "USED", "COMPENSATED"] })
  status!: "RESERVED" | "VOIDED" | "USED" | "COMPENSATED";

  @ApiProperty()
  version!: number;

  @ApiProperty()
  legacyServiceUsageId!: string;

  @ApiProperty({ enum: ["PENDING", "APPROVED"] })
  legacyServiceUsageStatus!: "PENDING" | "APPROVED";

  @ApiProperty({ type: [OpdCourseReservedItemView] })
  items!: OpdCourseReservedItemView[];

  @ApiProperty()
  reservedBy!: string;

  @ApiProperty()
  reservedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  voidedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  voidedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  voidReason!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  usedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  usedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  compensatedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  compensatedAt!: string | null;

  @ApiProperty()
  courseUsed!: boolean;

  @ApiProperty({ default: false })
  componentStockReserved!: false;

  @ApiProperty()
  componentStockDeducted!: boolean;

  @ApiPropertyOptional({
    type: OpdCourseVerificationSummaryView,
    nullable: true,
  })
  verification!: OpdCourseVerificationSummaryView | null;
}

export class OpdCurrentCourseReservationResult {
  @ApiProperty()
  capabilityEnabled!: boolean;

  @ApiPropertyOptional({ type: OpdCourseReservationResult, nullable: true })
  reservation!: OpdCourseReservationResult | null;

  @ApiProperty()
  voidAllowed!: boolean;

  @ApiProperty({ type: [String] })
  voidBlockers!: string[];

  @ApiProperty()
  verificationCapabilityEnabled!: boolean;

  @ApiProperty()
  verificationAllowed!: boolean;

  @ApiProperty({ type: [String] })
  verificationBlockers!: string[];

  @ApiProperty()
  compensationRequestAllowed!: boolean;

  @ApiProperty({ type: [String] })
  compensationBlockers!: string[];

  @ApiProperty()
  compensationReviewAllowed!: boolean;

  @ApiProperty({ type: [String] })
  compensationReviewBlockers!: string[];

  @ApiProperty()
  evidenceReadAllowed!: boolean;
}

export type OpdCourseReservationRecord =
  Prisma.opd_course_reservationGetPayload<{
    include: {
      items: {
        include: { components: true; operators: true };
        orderBy: { display_order: "asc" };
      };
      verification: {
        include: {
          components: true;
          compensation_requests: {
            include: { components: true };
            orderBy: { requested_at: "desc" };
          };
        };
      };
    };
  }>;

function decimalNumber(value: Prisma.Decimal): number {
  const parsed = Number(value.toString());
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid decimal in OPD course reservation snapshot");
  }
  return parsed;
}

export function toOpdCourseReservationResult(
  record: OpdCourseReservationRecord,
): OpdCourseReservationResult {
  const status =
    record.status === "VOIDED"
      ? "VOIDED"
      : record.status === "USED"
        ? "USED"
        : record.status === "COMPENSATED"
          ? "COMPENSATED"
          : "RESERVED";
  return {
    reservationId: record.reservation_id,
    encounterId: record.encounter_id,
    status,
    version: record.version,
    legacyServiceUsageId: record.legacy_service_usage_id,
    legacyServiceUsageStatus:
      status === "USED" || status === "COMPENSATED" ? "APPROVED" : "PENDING",
    items: record.items.map((item) => ({
      reservationItemId: item.reservation_item_id,
      courseCode: item.course_code_snapshot,
      courseName: item.course_name_snapshot,
      itemName: item.item_name_snapshot,
      quantity: decimalNumber(item.reserved_amount),
      beforeRemaining: decimalNumber(item.before_remaining_amount),
      afterRemaining: decimalNumber(item.after_remaining_amount),
      purchased: decimalNumber(item.entitlement_amount),
      currentReserved:
        decimalNumber(item.before_reserved_amount) +
        decimalNumber(item.reserved_amount),
      currentUsed: decimalNumber(item.before_used_amount),
      currentRemaining: decimalNumber(item.after_remaining_amount),
      entitlementExpireAt: item.entitlement_expire_at.toISOString(),
    })),
    reservedBy: record.reserved_by_user_id,
    reservedAt: record.reserved_at.toISOString(),
    voidedBy: record.voided_by_user_id,
    voidedAt: record.voided_at?.toISOString() ?? null,
    voidReason: record.void_reason,
    usedBy: record.used_by_user_id,
    usedAt: record.used_at?.toISOString() ?? null,
    compensatedBy: record.compensated_by_user_id,
    compensatedAt: record.compensated_at?.toISOString() ?? null,
    courseUsed: status === "USED",
    componentStockReserved: false,
    componentStockDeducted: status === "USED",
    verification: record.verification
      ? toOpdCourseVerificationSummary(
          record.verification,
          status === "COMPENSATED",
        )
      : null,
  };
}

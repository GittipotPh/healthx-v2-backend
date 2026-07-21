import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";

export const OPD_RELEASE_PRICING_POLICY =
  "opd-medication-release-price-v1" as const;
export const OPD_RELEASE_TAX_POLICY = "opd-medication-no-vat-v1" as const;
export const OPD_RELEASE_SAFETY_SOURCE =
  "LEGACY_CUSTOMER_INFO_UNVERIFIED" as const;
export const OPD_RELEASE_REQUIRED_PERMISSIONS = [
  "OPD_EDIT",
  "TREATMENT_EDIT",
  "SALE-ORDER_CREATE",
] as const;

export type OpdReleaseBlockerCode =
  | "ORDER_VERSION_CONFLICT"
  | "ITEM_VERSION_MANIFEST_MISMATCH"
  | "ORDER_EMPTY"
  | "UNSUPPORTED_ITEM"
  | "MEDICATION_INSTRUCTION_REQUIRED"
  | "INVALID_PRICE"
  | "INVALID_PROMOTION"
  | "REPRICE_REQUIRED"
  | "TAX_UNSUPPORTED"
  | "LOT_SELECTION_REQUIRED"
  | "LOT_UNAVAILABLE"
  | "LOT_EXPIRY_MISSING"
  | "LOT_EXPIRY_AMBIGUOUS"
  | "LOT_EXPIRED"
  | "INSUFFICIENT_STOCK"
  | "ATTENDING_DOCTOR_REQUIRED"
  | "ATTENDING_DOCTOR_INVALID"
  | "LEGACY_OPD_REQUIRED"
  | "LEGACY_OPD_MISMATCH"
  | "DOWNSTREAM_ALREADY_EXISTS";

export interface OpdReleaseBlocker {
  code: OpdReleaseBlockerCode;
  message: string;
  orderItemId: string | null;
  expectedVersion: number | null;
  currentVersion: number | null;
}

export class OpdOrderReleaseBlockerView {
  @ApiProperty({
    enum: [
      "ORDER_VERSION_CONFLICT",
      "ITEM_VERSION_MANIFEST_MISMATCH",
      "ORDER_EMPTY",
      "UNSUPPORTED_ITEM",
      "MEDICATION_INSTRUCTION_REQUIRED",
      "INVALID_PRICE",
      "INVALID_PROMOTION",
      "REPRICE_REQUIRED",
      "TAX_UNSUPPORTED",
      "LOT_SELECTION_REQUIRED",
      "LOT_UNAVAILABLE",
      "LOT_EXPIRY_MISSING",
      "LOT_EXPIRY_AMBIGUOUS",
      "LOT_EXPIRED",
      "INSUFFICIENT_STOCK",
      "ATTENDING_DOCTOR_REQUIRED",
      "ATTENDING_DOCTOR_INVALID",
      "LEGACY_OPD_REQUIRED",
      "LEGACY_OPD_MISMATCH",
      "DOWNSTREAM_ALREADY_EXISTS",
    ],
  })
  code!: OpdReleaseBlockerCode;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  orderItemId!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  expectedVersion!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  currentVersion!: number | null;
}

export class OpdOrderReleaseItemVersionView {
  @ApiProperty({ format: "uuid" })
  orderItemId!: string;

  @ApiProperty()
  version!: number;
}

export class OpdOrderReleaseLotSelectionView {
  @ApiProperty({ format: "uuid" })
  orderItemId!: string;

  @ApiProperty()
  lotId!: string;
}

export class OpdOrderReleaseLotView {
  @ApiProperty()
  lotId!: string;

  @ApiProperty()
  expiryAt!: string;

  @ApiProperty()
  availableQuantity!: number;
}

export class OpdOrderReleaseLineLotsView {
  @ApiProperty({ format: "uuid" })
  orderItemId!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty()
  requiredQuantity!: number;

  @ApiProperty({ type: [OpdOrderReleaseLotView] })
  eligibleLots!: OpdOrderReleaseLotView[];
}

export class OpdOrderReleaseLinePriceView {
  @ApiProperty({ format: "uuid" })
  orderItemId!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  baseUnitPrice!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({ enum: ["BASE", "PROMOTION"] })
  pricingSource!: "BASE" | "PROMOTION";

  @ApiProperty()
  grossAmount!: number;

  @ApiProperty()
  discountAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty()
  netAmount!: number;
}

export class OpdOrderReleaseTotalsView {
  @ApiProperty({ enum: ["THB"] })
  currency!: "THB";

  @ApiProperty()
  subtotalAmount!: number;

  @ApiProperty()
  promotionDiscountAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty()
  netTotalAmount!: number;
}

export class OpdOrderReleaseSafetyView {
  @ApiProperty({ enum: [OPD_RELEASE_SAFETY_SOURCE] })
  source!: typeof OPD_RELEASE_SAFETY_SOURCE;

  @ApiProperty({
    description: "Exact current legacy customer_info.allergy text",
  })
  allergyText!: string;

  @ApiProperty()
  safetySnapshotHash!: string;

  @ApiProperty({ default: true })
  acknowledgementRequired!: true;

  @ApiProperty({ default: false })
  isDrugInteractionCheck!: false;
}

export class OpdOrderReleasePreflightResult {
  @ApiProperty()
  eligible!: boolean;

  @ApiProperty({ type: [OpdOrderReleaseBlockerView] })
  blockers!: OpdOrderReleaseBlockerView[];

  @ApiProperty({ type: [OpdOrderReleaseLinePriceView] })
  lines!: OpdOrderReleaseLinePriceView[];

  @ApiProperty({ type: OpdOrderReleaseTotalsView })
  totals!: OpdOrderReleaseTotalsView;

  @ApiProperty({ type: [OpdOrderReleaseLineLotsView] })
  lots!: OpdOrderReleaseLineLotsView[];

  @ApiProperty({ type: OpdOrderReleaseSafetyView })
  safety!: OpdOrderReleaseSafetyView;

  @ApiProperty({
    enum: OPD_RELEASE_REQUIRED_PERMISSIONS,
    isArray: true,
  })
  requiredPermissions!: Array<
    (typeof OPD_RELEASE_REQUIRED_PERMISSIONS)[number]
  >;

  @ApiProperty()
  orderVersion!: number;

  @ApiProperty({ type: [OpdOrderReleaseItemVersionView] })
  itemVersions!: OpdOrderReleaseItemVersionView[];

  @ApiProperty({ type: [OpdOrderReleaseLotSelectionView] })
  selectedLots!: OpdOrderReleaseLotSelectionView[];

  @ApiProperty({ enum: [OPD_RELEASE_PRICING_POLICY] })
  pricingPolicy!: typeof OPD_RELEASE_PRICING_POLICY;

  @ApiProperty({ enum: [OPD_RELEASE_TAX_POLICY] })
  taxPolicy!: typeof OPD_RELEASE_TAX_POLICY;

  @ApiPropertyOptional({ type: String, nullable: true })
  preflightToken!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiresAt!: string | null;

  @ApiProperty({ default: false })
  inventoryReserved!: false;
}

export type OpdOrderReleaseRecord = Prisma.opd_order_releaseGetPayload<{
  include: {
    order: true;
    items: { orderBy: { display_order: "asc" } };
    prescription_link: true;
    sale_link: true;
  };
}>;

export class OpdOrderReleaseResult {
  @ApiProperty({ format: "uuid" })
  releaseId!: string;

  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty({ format: "uuid" })
  orderId!: string;

  @ApiProperty({ enum: ["RELEASED"] })
  orderStatus!: "RELEASED";

  @ApiProperty()
  orderVersion!: number;

  @ApiProperty()
  prescriptionId!: string;

  @ApiProperty({ enum: ["WAITING"] })
  prescriptionStatus!: "WAITING";

  @ApiProperty()
  saleOrderId!: string;

  @ApiProperty({ enum: ["PENDING"] })
  saleOrderStatus!: "PENDING";

  @ApiProperty({ type: OpdOrderReleaseTotalsView })
  totals!: OpdOrderReleaseTotalsView;

  @ApiProperty()
  safetySnapshotHash!: string;

  @ApiProperty()
  prescriberUserId!: string;

  @ApiProperty()
  releasedBy!: string;

  @ApiProperty()
  releasedAt!: string;

  @ApiProperty({ default: false })
  inventoryReserved!: false;

  @ApiProperty({ default: false })
  inventoryDeducted!: false;
}

export class VoidOpdOrderReleaseResult {
  @ApiProperty({ format: "uuid" })
  releaseId!: string;

  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty({ format: "uuid" })
  orderId!: string;

  @ApiProperty({ enum: ["VOIDED"] })
  orderStatus!: "VOIDED";

  @ApiProperty()
  orderVersion!: number;

  @ApiProperty()
  prescriptionId!: string;

  @ApiProperty({ enum: ["CANCEL"] })
  prescriptionStatus!: "CANCEL";

  @ApiProperty()
  saleOrderId!: string;

  @ApiProperty({ enum: ["DELETED"] })
  saleOrderStatus!: "DELETED";

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  voidedBy!: string;

  @ApiProperty()
  voidedAt!: string;
}

function decimalNumber(value: Prisma.Decimal): number {
  const parsed = Number(value.toString());
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid decimal in OPD release snapshot");
  }
  return parsed;
}

export function toOpdOrderReleaseResult(
  record: OpdOrderReleaseRecord,
): OpdOrderReleaseResult {
  if (!record.prescription_link || !record.sale_link) {
    throw new Error("Released OPD order is missing a durable downstream link");
  }
  return {
    releaseId: record.release_id,
    encounterId: record.encounter_id,
    orderId: record.order_id,
    orderStatus: "RELEASED",
    orderVersion: record.result_order_version,
    prescriptionId: record.prescription_link.legacy_prescribe_id,
    prescriptionStatus: "WAITING",
    saleOrderId: record.sale_link.legacy_sale_order_id,
    saleOrderStatus: "PENDING",
    totals: {
      currency: "THB",
      subtotalAmount: decimalNumber(record.subtotal_amount),
      promotionDiscountAmount: decimalNumber(
        record.promotion_discount_amount,
      ),
      taxAmount: decimalNumber(record.tax_amount),
      netTotalAmount: decimalNumber(record.net_total_amount),
    },
    safetySnapshotHash: record.safety_snapshot_hash,
    prescriberUserId: record.prescriber_user_id,
    releasedBy: record.released_by,
    releasedAt: record.released_at.toISOString(),
    inventoryReserved: false,
    inventoryDeducted: false,
  };
}

export function toVoidOpdOrderReleaseResult(
  record: OpdOrderReleaseRecord,
): VoidOpdOrderReleaseResult {
  if (!record.prescription_link || !record.sale_link) {
    throw new Error("Voided OPD order is missing a durable downstream link");
  }
  if (
    record.order.status !== "VOIDED" ||
    !record.order.void_reason ||
    !record.order.voided_by ||
    !record.order.voided_at
  ) {
    throw new Error("Unexpected voided OPD order lifecycle state");
  }
  return {
    releaseId: record.release_id,
    encounterId: record.encounter_id,
    orderId: record.order_id,
    orderStatus: "VOIDED",
    orderVersion: record.order.version,
    prescriptionId: record.prescription_link.legacy_prescribe_id,
    prescriptionStatus: "CANCEL",
    saleOrderId: record.sale_link.legacy_sale_order_id,
    saleOrderStatus: "DELETED",
    reason: record.order.void_reason,
    voidedBy: record.order.voided_by,
    voidedAt: record.order.voided_at.toISOString(),
  };
}

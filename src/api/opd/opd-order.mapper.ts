import { ApiProperty } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import {
  OpdClinicalCatalogCategory,
  OpdOrderSourceType,
} from "./dto/opd-order.dto";

export type OpdOrderRecord = Prisma.opd_orderGetPayload<{
  include: {
    items: { include: { medication_instruction: true } };
  };
}>;

export interface OpdCatalogRecord {
  sourceType: OpdOrderSourceType;
  sourceId: string;
  sourceParentId: string | null;
  code: string;
  category: OpdClinicalCatalogCategory;
  name: string;
  description: string | null;
  unit: string;
  basePrice: Prisma.Decimal | null;
  effectivePrice: Prisma.Decimal | null;
  pricingSource: "BASE" | "PROMOTION";
  taxType: "INCLUDE_VAT" | "EXCLUDE_VAT" | "NO_VAT" | null;
  stockQuantity: Prisma.Decimal | null;
  stockAlertAt: number | null;
  categoryName: string | null;
  subCategoryName: string | null;
  maximumDiscount: Prisma.Decimal | null;
  maximumDiscountUnit: "AMOUNT" | "PERCENT" | null;
  isGlobal: boolean;
  updatedAt: Date | null;
}

export class OpdClinicalCatalogItemView {
  @ApiProperty({ enum: ["PRODUCT", "COURSE_ITEM"] })
  sourceType!: OpdOrderSourceType;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty({ type: String, nullable: true })
  sourceParentId!: string | null;

  @ApiProperty()
  code!: string;

  @ApiProperty({
    enum: ["MEDICINE", "DRUG", "TOOL", "PRODUCT", "CONSUMABLES", "COURSE"],
  })
  category!: OpdClinicalCatalogCategory;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  unit!: string;

  @ApiProperty({ type: Number, nullable: true })
  basePrice!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  effectivePrice!: number | null;

  @ApiProperty({ enum: ["BASE", "PROMOTION"] })
  pricingSource!: "BASE" | "PROMOTION";

  @ApiProperty({
    enum: ["INCLUDE_VAT", "EXCLUDE_VAT", "NO_VAT"],
    nullable: true,
  })
  taxType!: "INCLUDE_VAT" | "EXCLUDE_VAT" | "NO_VAT" | null;

  @ApiProperty({ type: Number, nullable: true })
  stockQuantity!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  stockAlertAt!: number | null;

  @ApiProperty({ type: String, nullable: true })
  categoryName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  subCategoryName!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  maximumDiscount!: number | null;

  @ApiProperty({ enum: ["AMOUNT", "PERCENT"], nullable: true })
  maximumDiscountUnit!: "AMOUNT" | "PERCENT" | null;

  @ApiProperty()
  isGlobal!: boolean;

  @ApiProperty()
  canOrder!: boolean;

  @ApiProperty({ type: String, nullable: true })
  updatedAt!: string | null;
}

export class OpdClinicalCatalogListResult {
  @ApiProperty({ type: [OpdClinicalCatalogItemView] })
  items!: OpdClinicalCatalogItemView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty({ enum: ["catalog-snapshot-v1"] })
  pricingPolicy!: "catalog-snapshot-v1";

  @ApiProperty({ default: false })
  releaseAvailable!: false;
}

export class OpdMedicationInstructionView {
  @ApiProperty()
  medicationInstructionId!: string;

  @ApiProperty({ type: String, nullable: true })
  dose!: string | null;

  @ApiProperty({ type: String, nullable: true })
  route!: string | null;

  @ApiProperty({ type: String, nullable: true })
  frequency!: string | null;

  @ApiProperty({ type: String, nullable: true })
  timing!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationValue!: number | null;

  @ApiProperty({ type: String, nullable: true })
  durationUnit!: string | null;

  @ApiProperty()
  sigText!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OpdOrderItemView {
  @ApiProperty()
  orderItemId!: string;

  @ApiProperty()
  displayOrder!: number;

  @ApiProperty({ enum: ["PRODUCT", "COURSE_ITEM"] })
  sourceType!: OpdOrderSourceType;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty({ type: String, nullable: true })
  sourceParentId!: string | null;

  @ApiProperty()
  sourceCode!: string;

  @ApiProperty({
    enum: ["MEDICINE", "DRUG", "TOOL", "PRODUCT", "CONSUMABLES", "COURSE"],
  })
  category!: OpdClinicalCatalogCategory;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({ enum: ["BASE", "PROMOTION"] })
  pricingSource!: "BASE" | "PROMOTION";

  @ApiProperty({
    enum: ["INCLUDE_VAT", "EXCLUDE_VAT", "NO_VAT"],
    nullable: true,
  })
  taxType!: "INCLUDE_VAT" | "EXCLUDE_VAT" | "NO_VAT" | null;

  @ApiProperty()
  grossAmount!: number;

  @ApiProperty()
  discountAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty()
  netAmount!: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ enum: ["ACTIVE", "VOID"] })
  status!: "ACTIVE" | "VOID";

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: String, nullable: true })
  voidReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  voidedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  voidedAt!: string | null;

  @ApiProperty({ type: OpdMedicationInstructionView, nullable: true })
  medicationInstruction!: OpdMedicationInstructionView | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OpdDraftOrderView {
  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  encounterId!: string;

  @ApiProperty({ enum: ["DRAFT"] })
  status!: "DRAFT";

  @ApiProperty({ enum: ["THB"] })
  currency!: "THB";

  @ApiProperty()
  subtotalAmount!: number;

  @ApiProperty()
  discountTotalAmount!: number;

  @ApiProperty()
  taxTotalAmount!: number;

  @ApiProperty()
  netTotalAmount!: number;

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: [OpdOrderItemView] })
  items!: OpdOrderItemView[];

  @ApiProperty({ default: false })
  releaseAvailable!: false;

  @ApiProperty()
  releaseUnavailableReason!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OpdDraftOrderResult {
  @ApiProperty({ type: OpdDraftOrderView, nullable: true })
  order!: OpdDraftOrderView | null;
}

export class CreateOpdDraftOrderResult {
  @ApiProperty({ type: OpdDraftOrderView })
  order!: OpdDraftOrderView;

  @ApiProperty()
  resumed!: boolean;
}

function decimalNumber(value: Prisma.Decimal | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function orderStatus(value: string): "DRAFT" {
  if (value !== "DRAFT") throw new Error(`Unknown OPD order status: ${value}`);
  return value;
}

function itemStatus(value: string): "ACTIVE" | "VOID" {
  if (value !== "ACTIVE" && value !== "VOID") {
    throw new Error(`Unknown OPD order item status: ${value}`);
  }
  return value;
}

function orderSourceType(value: string): OpdOrderSourceType {
  if (value === "PRODUCT") return OpdOrderSourceType.PRODUCT;
  if (value === "COURSE_ITEM") return OpdOrderSourceType.COURSE_ITEM;
  throw new Error(`Unknown OPD order source type: ${value}`);
}

function catalogCategory(value: string): OpdClinicalCatalogCategory {
  switch (value) {
    case "MEDICINE":
      return OpdClinicalCatalogCategory.MEDICINE;
    case "DRUG":
      return OpdClinicalCatalogCategory.DRUG;
    case "TOOL":
      return OpdClinicalCatalogCategory.TOOL;
    case "PRODUCT":
      return OpdClinicalCatalogCategory.PRODUCT;
    case "CONSUMABLES":
      return OpdClinicalCatalogCategory.CONSUMABLES;
    case "COURSE":
      return OpdClinicalCatalogCategory.COURSE;
    default:
      throw new Error(`Unknown OPD order category: ${value}`);
  }
}

function pricingSource(value: string): "BASE" | "PROMOTION" {
  if (value === "BASE" || value === "PROMOTION") return value;
  throw new Error(`Unknown OPD order pricing source: ${value}`);
}

function taxType(
  value: string | null,
): "INCLUDE_VAT" | "EXCLUDE_VAT" | "NO_VAT" | null {
  if (value === null) return null;
  if (
    value === "INCLUDE_VAT" ||
    value === "EXCLUDE_VAT" ||
    value === "NO_VAT"
  ) {
    return value;
  }
  throw new Error(`Unknown OPD order tax type: ${value}`);
}

export function toOpdCatalogItemView(
  row: OpdCatalogRecord,
): OpdClinicalCatalogItemView {
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceParentId: row.sourceParentId,
    code: row.code,
    category: row.category,
    name: row.name,
    description: row.description,
    unit: row.unit,
    basePrice: decimalNumber(row.basePrice),
    effectivePrice: decimalNumber(row.effectivePrice),
    pricingSource: row.pricingSource,
    taxType: row.taxType,
    stockQuantity: decimalNumber(row.stockQuantity),
    stockAlertAt: row.stockAlertAt,
    categoryName: row.categoryName,
    subCategoryName: row.subCategoryName,
    maximumDiscount: decimalNumber(row.maximumDiscount),
    maximumDiscountUnit: row.maximumDiscountUnit,
    isGlobal: row.isGlobal,
    canOrder: row.effectivePrice !== null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export function toOpdDraftOrderView(row: OpdOrderRecord): OpdDraftOrderView {
  return {
    orderId: row.order_id,
    encounterId: row.encounter_id,
    status: orderStatus(row.status),
    currency: "THB",
    subtotalAmount: decimalNumber(row.subtotal_amount) ?? 0,
    discountTotalAmount: decimalNumber(row.discount_total_amount) ?? 0,
    taxTotalAmount: decimalNumber(row.tax_total_amount) ?? 0,
    netTotalAmount: decimalNumber(row.net_total_amount) ?? 0,
    version: row.version,
    items: row.items.map((item) => ({
      orderItemId: item.order_item_id,
      displayOrder: item.display_order,
      sourceType: orderSourceType(item.source_type),
      sourceId: item.source_id,
      sourceParentId: item.source_parent_id,
      sourceCode: item.source_code,
      category: catalogCategory(item.category),
      name: item.name_snapshot,
      description: item.description_snapshot,
      unit: item.unit_snapshot,
      quantity: decimalNumber(item.quantity) ?? 0,
      unitPrice: decimalNumber(item.unit_price_amount) ?? 0,
      pricingSource: pricingSource(item.pricing_source),
      taxType: taxType(item.tax_type_snapshot),
      grossAmount: decimalNumber(item.gross_amount) ?? 0,
      discountAmount: decimalNumber(item.discount_amount) ?? 0,
      taxAmount: decimalNumber(item.tax_amount) ?? 0,
      netAmount: decimalNumber(item.net_amount) ?? 0,
      note: item.note,
      status: itemStatus(item.status),
      version: item.version,
      voidReason: item.void_reason,
      voidedBy: item.voided_by,
      voidedAt: item.voided_at?.toISOString() ?? null,
      medicationInstruction: item.medication_instruction
        ? {
            medicationInstructionId:
              item.medication_instruction.medication_instruction_id,
            dose: item.medication_instruction.dose,
            route: item.medication_instruction.route,
            frequency: item.medication_instruction.frequency,
            timing: item.medication_instruction.timing,
            durationValue: decimalNumber(
              item.medication_instruction.duration_value,
            ),
            durationUnit: item.medication_instruction.duration_unit,
            sigText: item.medication_instruction.sig_text,
            note: item.medication_instruction.note,
            createdAt: item.medication_instruction.created_at.toISOString(),
            updatedAt: item.medication_instruction.updated_at.toISOString(),
          }
        : null,
      createdAt: item.created_at.toISOString(),
      updatedAt: item.updated_at.toISOString(),
    })),
    releaseAvailable: false,
    releaseUnavailableReason:
      "Order release and downstream commercial effects require a separately approved lifecycle",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

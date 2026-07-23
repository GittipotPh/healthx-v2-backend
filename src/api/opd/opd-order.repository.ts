import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  CreateOpdOrderItemDto,
  OpdClinicalCatalogCategory,
  OpdMedicationInstructionInputDto,
  OpdOrderSourceType,
  PatchOpdOrderItemDto,
  QueryOpdClinicalCatalogDto,
} from "./dto/opd-order.dto";
import { type OpdCatalogRecord, type OpdOrderRecord } from "./opd-order.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;
type OrderRecalculationClient = {
  opd_order_item: Pick<Prisma.TransactionClient["opd_order_item"], "aggregate">;
  opd_order: Pick<Prisma.TransactionClient["opd_order"], "updateMany">;
};

interface CatalogQueryRow {
  source_type: string | null;
  source_id: string | null;
  source_parent_id: string | null;
  code: string | null;
  category: string | null;
  name: string | null;
  description: string | null;
  unit: string | null;
  base_price: Prisma.Decimal | null;
  effective_price: Prisma.Decimal | null;
  pricing_source: string | null;
  tax_type: string | null;
  stock_quantity: Prisma.Decimal | null;
  stock_alert_at: number | null;
  category_name: string | null;
  sub_category_name: string | null;
  maximum_discount: Prisma.Decimal | null;
  maximum_discount_unit: string | null;
  is_global: boolean | null;
  updated_at: Date | null;
  total_count: bigint;
}

interface LockedIdRow {
  id: string;
}

export interface CatalogPage {
  items: OpdCatalogRecord[];
  total: number;
}

@Injectable()
export class OpdOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCatalog(
    query: QueryOpdClinicalCatalogDto,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<CatalogPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const rows = await this.queryCatalog(
      {
        search: query.search?.trim() || undefined,
        category: query.category,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
      scope,
      client,
    );
    return {
      items: rows.flatMap((row) => {
        const item = this.toCatalogRecord(row);
        return item ? [item] : [];
      }),
      total: Number(rows[0]?.total_count ?? 0n),
    };
  }

  async findCatalogItem(
    sourceType: OpdOrderSourceType,
    sourceId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdCatalogRecord | null> {
    const rows = await this.queryCatalog(
      { sourceType, sourceId, offset: 0, limit: 1 },
      scope,
      client,
    );
    return this.toCatalogRecord(rows[0]);
  }

  findDraftOrder(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdOrderRecord | null> {
    return client.opd_order.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: {
        items: {
          orderBy: { display_order: "asc" },
          include: { medication_instruction: true },
        },
        release: {
          include: { prescription_link: true, sale_link: true },
        },
      },
    });
  }

  async lockOrder(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "order_id"::TEXT AS id
      FROM "opd_order"
      WHERE "order_id" = ${orderId}::UUID
        AND "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  async createDraftOrder(
    encounterId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<OpdOrderRecord> {
    await tx.opd_order.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        status: "DRAFT",
        currency: "THB",
        subtotal_amount: 0,
        discount_total_amount: 0,
        tax_total_amount: 0,
        net_total_amount: 0,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
    const created = await this.findDraftOrder(encounterId, scope, tx);
    if (!created)
      throw new Error("Created OPD draft order could not be reloaded");
    return created;
  }

  async nextItemDisplayOrder(
    orderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const aggregate = await tx.opd_order_item.aggregate({
      where: {
        order_id: orderId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      _max: { display_order: true },
    });
    return (aggregate._max.display_order ?? 0) + 1;
  }

  async createItem(
    orderId: string,
    encounterId: string,
    displayOrder: number,
    source: OpdCatalogRecord,
    unitPrice: Prisma.Decimal,
    dto: CreateOpdOrderItemDto,
    grossAmount: Prisma.Decimal,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const item = await tx.opd_order_item.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        order_id: orderId,
        display_order: displayOrder,
        source_type: source.sourceType,
        source_id: source.sourceId,
        source_parent_id: source.sourceParentId,
        source_code: source.code,
        category: source.category,
        name_snapshot: source.name,
        description_snapshot: source.description,
        unit_snapshot: source.unit,
        quantity: dto.quantity,
        unit_price_amount: unitPrice,
        pricing_source: source.pricingSource,
        tax_type_snapshot: source.taxType,
        gross_amount: grossAmount,
        discount_amount: 0,
        tax_amount: 0,
        net_amount: grossAmount,
        note: this.nullableText(dto.note),
        status: "ACTIVE",
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
        ...(dto.medicationInstruction
          ? {
              medication_instruction: {
                create: this.medicationInstructionContent(
                  dto.medicationInstruction,
                  scope,
                  now,
                ),
              },
            }
          : {}),
      },
    });
    return item.order_item_id;
  }

  async updateItem(
    orderId: string,
    encounterId: string,
    itemId: string,
    source: OpdCatalogRecord,
    unitPrice: Prisma.Decimal,
    dto: PatchOpdOrderItemDto,
    grossAmount: Prisma.Decimal,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const updated = await tx.opd_order_item.updateMany({
      where: {
        order_item_id: itemId,
        order_id: orderId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "ACTIVE",
        version: dto.expectedItemVersion,
      },
      data: {
        source_parent_id: source.sourceParentId,
        source_code: source.code,
        category: source.category,
        name_snapshot: source.name,
        description_snapshot: source.description,
        unit_snapshot: source.unit,
        quantity: dto.quantity,
        unit_price_amount: unitPrice,
        pricing_source: source.pricingSource,
        tax_type_snapshot: source.taxType,
        gross_amount: grossAmount,
        discount_amount: 0,
        tax_amount: 0,
        net_amount: grossAmount,
        note: this.nullableText(dto.note),
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (updated.count !== 1) return false;

    if (dto.medicationInstruction) {
      await tx.opd_medication_instruction.upsert({
        where: {
          order_item_id_clinic_id_branch_id_encounter_id_order_id: {
            order_item_id: itemId,
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
            encounter_id: encounterId,
            order_id: orderId,
          },
        },
        create: {
          order_item_id: itemId,
          ...this.medicationInstructionData(
            dto.medicationInstruction,
            orderId,
            encounterId,
            scope,
            now,
          ),
        },
        update: {
          dose: this.nullableText(dto.medicationInstruction.dose),
          route: this.nullableText(dto.medicationInstruction.route),
          frequency: this.nullableText(dto.medicationInstruction.frequency),
          timing: this.nullableText(dto.medicationInstruction.timing),
          duration_value: dto.medicationInstruction.durationValue ?? null,
          duration_unit: this.nullableText(
            dto.medicationInstruction.durationUnit,
          ),
          sig_text: dto.medicationInstruction.sigText.trim(),
          note: this.nullableText(dto.medicationInstruction.note),
          updated_by: scope.userId,
          updated_at: now,
        },
      });
    } else {
      await tx.opd_medication_instruction.deleteMany({
        where: {
          order_item_id: itemId,
          order_id: orderId,
          encounter_id: encounterId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
      });
    }
    return true;
  }

  async voidItem(
    orderId: string,
    encounterId: string,
    itemId: string,
    expectedItemVersion: number,
    reason: string | null,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const updated = await tx.opd_order_item.updateMany({
      where: {
        order_item_id: itemId,
        order_id: orderId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "ACTIVE",
        version: expectedItemVersion,
      },
      data: {
        status: "VOID",
        version: { increment: 1 },
        void_reason: reason,
        voided_by: scope.userId,
        voided_at: now,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return updated.count === 1;
  }

  async recalculateAndBumpOrder(
    orderId: string,
    encounterId: string,
    expectedVersion: number,
    scope: RequestScope,
    now: Date,
    tx: OrderRecalculationClient,
  ): Promise<boolean> {
    const aggregate = await tx.opd_order_item.aggregate({
      where: {
        order_id: orderId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "ACTIVE",
      },
      _sum: { gross_amount: true },
    });
    const subtotal = aggregate._sum.gross_amount ?? new Prisma.Decimal(0);
    const updated = await tx.opd_order.updateMany({
      where: {
        order_id: orderId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        subtotal_amount: subtotal,
        discount_total_amount: 0,
        tax_total_amount: 0,
        net_total_amount: subtotal,
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return updated.count === 1;
  }

  private async queryCatalog(
    options: {
      search?: string;
      category?: OpdClinicalCatalogCategory;
      sourceType?: OpdOrderSourceType;
      sourceId?: string;
      offset: number;
      limit: number;
    },
    scope: RequestScope,
    client: DatabaseClient,
  ): Promise<CatalogQueryRow[]> {
    const categoryFilter = options.category
      ? Prisma.sql`AND catalog.category = ${options.category}`
      : Prisma.sql``;
    const searchFilter = options.search
      ? Prisma.sql`AND POSITION(
          ${options.search.toLocaleLowerCase("en-US")}
          IN LOWER(CONCAT_WS(
            ' ',
            catalog.name,
            catalog.code,
            catalog.category_name,
            catalog.sub_category_name
          ))
        ) > 0`
      : Prisma.sql``;
    const sourceTypeFilter = options.sourceType
      ? Prisma.sql`AND catalog.source_type = ${options.sourceType}`
      : Prisma.sql``;
    const sourceIdFilter = options.sourceId
      ? Prisma.sql`AND catalog.source_id = ${options.sourceId}`
      : Prisma.sql``;

    return client.$queryRaw<CatalogQueryRow[]>(Prisma.sql`
      WITH catalog AS (
        SELECT
          'PRODUCT'::TEXT AS source_type,
          product.product_id::TEXT AS source_id,
          NULL::TEXT AS source_parent_id,
          COALESCE(
            NULLIF(BTRIM(product.product_id_display), ''),
            product.product_id
          )::TEXT AS code,
          product.product_category::TEXT AS category,
          LEFT(product.product_name, 300)::TEXT AS name,
          LEFT(product.description, 1000)::TEXT AS description,
          LEFT(product.unit, 250)::TEXT AS unit,
          product.price AS base_price,
          CASE
            WHEN product.promotion_price IS NOT NULL
             AND product.start_date IS NOT NULL
             AND product.end_date IS NOT NULL
             AND CURRENT_TIMESTAMP BETWEEN product.start_date AND product.end_date
            THEN product.promotion_price
            ELSE product.price
          END AS effective_price,
          CASE
            WHEN product.promotion_price IS NOT NULL
             AND product.start_date IS NOT NULL
             AND product.end_date IS NOT NULL
             AND CURRENT_TIMESTAMP BETWEEN product.start_date AND product.end_date
            THEN 'PROMOTION'
            ELSE 'BASE'
          END::TEXT AS pricing_source,
          product.vat::TEXT AS tax_type,
          (
            SELECT COALESCE(SUM(inventory.in_stock), 0)
            FROM inventory
            WHERE inventory.item_id = product.product_id
              AND inventory.branch_id = ${scope.branchId}
          ) AS stock_quantity,
          product.out_of_stock_alert AS stock_alert_at,
          category.name::TEXT AS category_name,
          sub_category.name::TEXT AS sub_category_name,
          product.maximum_discount AS maximum_discount,
          product.maximum_discount_unit::TEXT AS maximum_discount_unit,
          product.is_global AS is_global,
          COALESCE(product.updated_at, product.created_at) AS updated_at
        FROM product
        INNER JOIN branch
          ON branch.branch_id = product.branch_id
        LEFT JOIN category
          ON category.category_id = product.category_id
         AND category.clinic_id = branch.clinic_id
        LEFT JOIN sub_category
          ON sub_category.sub_category_id = product.sub_category_id
         AND sub_category.clinic_id = branch.clinic_id
        WHERE branch.clinic_id = ${scope.clinicId}
          AND (product.branch_id = ${scope.branchId} OR product.is_global = TRUE)
          AND product.status = 'ACTIVE'
          AND (
            product.product_type IS NULL
            OR product.product_type IN ('SALE', 'BOTH')
          )

        UNION ALL

        SELECT
          'COURSE_ITEM'::TEXT AS source_type,
          course_item.course_item_id::TEXT AS source_id,
          course.course_id::TEXT AS source_parent_id,
          COALESCE(
            NULLIF(BTRIM(course.course_id_display), ''),
            course_item.course_item_id
          )::TEXT AS code,
          'COURSE'::TEXT AS category,
          LEFT(
            CONCAT_WS(' | ', course.course_name, course_item.name),
            300
          )::TEXT AS name,
          LEFT(course.description, 1000)::TEXT AS description,
          LEFT(course_item.unit, 250)::TEXT AS unit,
          course_item.price AS base_price,
          CASE
            WHEN course_item.promotion_price IS NOT NULL
             AND course_item.start_date IS NOT NULL
             AND course_item.end_date IS NOT NULL
             AND CURRENT_TIMESTAMP BETWEEN course_item.start_date AND course_item.end_date
            THEN course_item.promotion_price
            ELSE course_item.price
          END AS effective_price,
          CASE
            WHEN course_item.promotion_price IS NOT NULL
             AND course_item.start_date IS NOT NULL
             AND course_item.end_date IS NOT NULL
             AND CURRENT_TIMESTAMP BETWEEN course_item.start_date AND course_item.end_date
            THEN 'PROMOTION'
            ELSE 'BASE'
          END::TEXT AS pricing_source,
          course_item.vat::TEXT AS tax_type,
          NULL::DECIMAL AS stock_quantity,
          NULL::INTEGER AS stock_alert_at,
          category.name::TEXT AS category_name,
          sub_category.name::TEXT AS sub_category_name,
          course.maximum_discount AS maximum_discount,
          course.maximum_discount_unit::TEXT AS maximum_discount_unit,
          course.is_global AS is_global,
          GREATEST(course.updated_at, course_item.updated_at) AS updated_at
        FROM course_item
        INNER JOIN course
          ON course.course_id = course_item.course_id
        INNER JOIN branch
          ON branch.branch_id = course.branch_id
        LEFT JOIN category
          ON category.category_id = course.category_id
         AND category.clinic_id = branch.clinic_id
        LEFT JOIN sub_category
          ON sub_category.sub_category_id = course.sub_category_id
         AND sub_category.clinic_id = branch.clinic_id
        WHERE branch.clinic_id = ${scope.clinicId}
          AND (course.branch_id = ${scope.branchId} OR course.is_global = TRUE)
          AND course.status = 'ACTIVE'
          AND course_item.status = 'ACTIVE'
          AND course.product_type IN ('SALE', 'BOTH')
      ), filtered AS (
        SELECT *
        FROM catalog
        WHERE TRUE
          ${categoryFilter}
          ${searchFilter}
          ${sourceTypeFilter}
          ${sourceIdFilter}
      )
      SELECT page.*, totals.total_count
      FROM (
        SELECT COUNT(*)::BIGINT AS total_count
        FROM filtered
      ) AS totals
      LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY LOWER(filtered.name), filtered.source_type, filtered.source_id
        OFFSET ${options.offset}
        LIMIT ${options.limit}
      ) AS page ON TRUE
    `);
  }

  private toCatalogRecord(
    row: CatalogQueryRow | undefined,
  ): OpdCatalogRecord | null {
    if (
      !row?.source_type ||
      !row.source_id ||
      !row.code ||
      !row.category ||
      !row.name ||
      !row.unit ||
      !row.pricing_source
    ) {
      return null;
    }
    return {
      sourceType: this.sourceType(row.source_type),
      sourceId: row.source_id,
      sourceParentId: row.source_parent_id,
      code: row.code,
      category: this.category(row.category),
      name: row.name,
      description: row.description,
      unit: row.unit,
      basePrice: row.base_price,
      effectivePrice: row.effective_price,
      pricingSource: this.pricingSource(row.pricing_source),
      taxType: this.taxType(row.tax_type),
      stockQuantity: row.stock_quantity,
      stockAlertAt: row.stock_alert_at,
      categoryName: row.category_name,
      subCategoryName: row.sub_category_name,
      maximumDiscount: row.maximum_discount,
      maximumDiscountUnit: this.maximumDiscountUnit(row.maximum_discount_unit),
      isGlobal: row.is_global ?? false,
      updatedAt: row.updated_at,
    };
  }

  private medicationInstructionData(
    input: OpdMedicationInstructionInputDto,
    orderId: string,
    encounterId: string,
    scope: RequestScope,
    now: Date,
  ) {
    return {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
      encounter_id: encounterId,
      order_id: orderId,
      ...this.medicationInstructionContent(input, scope, now),
    };
  }

  private medicationInstructionContent(
    input: OpdMedicationInstructionInputDto,
    scope: RequestScope,
    now: Date,
  ) {
    return {
      dose: this.nullableText(input.dose),
      route: this.nullableText(input.route),
      frequency: this.nullableText(input.frequency),
      timing: this.nullableText(input.timing),
      duration_value: input.durationValue ?? null,
      duration_unit: this.nullableText(input.durationUnit),
      sig_text: input.sigText.trim(),
      note: this.nullableText(input.note),
      created_by: scope.userId,
      updated_by: scope.userId,
      created_at: now,
      updated_at: now,
    };
  }

  private sourceType(value: string): OpdOrderSourceType {
    if (value === "PRODUCT") return OpdOrderSourceType.PRODUCT;
    if (value === "COURSE_ITEM") return OpdOrderSourceType.COURSE_ITEM;
    throw new Error(`Unknown OPD catalog source type: ${value}`);
  }

  private category(value: string): OpdClinicalCatalogCategory {
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
        throw new Error(`Unknown OPD catalog category: ${value}`);
    }
  }

  private pricingSource(value: string): "BASE" | "PROMOTION" {
    if (value === "BASE" || value === "PROMOTION") return value;
    throw new Error(`Unknown OPD catalog pricing source: ${value}`);
  }

  private taxType(
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
    throw new Error(`Unknown OPD catalog tax type: ${value}`);
  }

  private maximumDiscountUnit(
    value: string | null,
  ): "AMOUNT" | "PERCENT" | null {
    if (value === null) return null;
    if (value === "AMOUNT" || value === "PERCENT") return value;
    throw new Error(`Unknown OPD catalog discount unit: ${value}`);
  }

  private nullableText(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized : null;
  }
}

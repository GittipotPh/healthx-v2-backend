-- Surgical, additive OPD V2 Phase 3A migration.
-- Creates ONLY app-owned draft-order resources. Catalog sources remain legacy
-- scalar string snapshots: no foreign key or Prisma relation is added to a
-- legacy HealthX table. Release, discount authorization, tax calculation,
-- prescription/sale/inventory/course effects, and follow-up are deliberately
-- outside this migration.

CREATE TABLE IF NOT EXISTS "opd_order" (
    "order_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'THB',
    "subtotal_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_order_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "opd_order_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_order_status_check" CHECK ("status" = 'DRAFT'),
    CONSTRAINT "opd_order_currency_check" CHECK ("currency" = 'THB'),
    CONSTRAINT "opd_order_version_check" CHECK ("version" > 0),
    CONSTRAINT "opd_order_totals_check" CHECK (
        "subtotal_amount" >= 0
        AND "discount_total_amount" = 0
        AND "tax_total_amount" = 0
        AND "net_total_amount" = "subtotal_amount"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_identity_uq"
    ON "opd_order"("order_id", "clinic_id", "branch_id", "encounter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_encounter_uq"
    ON "opd_order"("encounter_id", "clinic_id", "branch_id");
CREATE INDEX IF NOT EXISTS "opd_order_scope_idx"
    ON "opd_order"("clinic_id", "branch_id", "encounter_id", "status");

CREATE TABLE IF NOT EXISTS "opd_order_item" (
    "order_item_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_id" VARCHAR(50) NOT NULL,
    "source_parent_id" VARCHAR(50),
    "source_code" VARCHAR(50) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "name_snapshot" VARCHAR(300) NOT NULL,
    "description_snapshot" VARCHAR(1000),
    "unit_snapshot" VARCHAR(250) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price_amount" DECIMAL(14,2) NOT NULL,
    "pricing_source" VARCHAR(20) NOT NULL,
    "tax_type_snapshot" VARCHAR(30),
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(2000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "void_reason" VARCHAR(500),
    "voided_by" VARCHAR(50),
    "voided_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_order_item_pkey" PRIMARY KEY ("order_item_id"),
    CONSTRAINT "opd_order_item_order_identity_fkey" FOREIGN KEY
        ("order_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_order"(
            "order_id",
            "clinic_id",
            "branch_id",
            "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_order_item_display_order_check" CHECK ("display_order" > 0),
    CONSTRAINT "opd_order_item_source_type_check" CHECK (
        "source_type" IN ('PRODUCT', 'COURSE_ITEM')
    ),
    CONSTRAINT "opd_order_item_category_check" CHECK (
        "category" IN (
            'MEDICINE',
            'DRUG',
            'TOOL',
            'PRODUCT',
            'CONSUMABLES',
            'COURSE'
        )
    ),
    CONSTRAINT "opd_order_item_source_category_check" CHECK (
        ("source_type" = 'COURSE_ITEM' AND "category" = 'COURSE')
        OR ("source_type" = 'PRODUCT' AND "category" <> 'COURSE')
    ),
    CONSTRAINT "opd_order_item_snapshot_check" CHECK (
        BTRIM("source_id") <> ''
        AND BTRIM("source_code") <> ''
        AND BTRIM("name_snapshot") <> ''
        AND BTRIM("unit_snapshot") <> ''
    ),
    CONSTRAINT "opd_order_item_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "opd_order_item_pricing_source_check" CHECK (
        "pricing_source" IN ('BASE', 'PROMOTION')
    ),
    CONSTRAINT "opd_order_item_tax_type_check" CHECK (
        "tax_type_snapshot" IS NULL
        OR "tax_type_snapshot" IN ('INCLUDE_VAT', 'EXCLUDE_VAT', 'NO_VAT')
    ),
    CONSTRAINT "opd_order_item_amounts_check" CHECK (
        "unit_price_amount" >= 0
        AND "gross_amount" >= 0
        AND "discount_amount" = 0
        AND "tax_amount" = 0
        AND "net_amount" = "gross_amount"
        AND "gross_amount" = ROUND("quantity" * "unit_price_amount", 2)
    ),
    CONSTRAINT "opd_order_item_status_check" CHECK (
        "status" IN ('ACTIVE', 'VOID')
    ),
    CONSTRAINT "opd_order_item_version_check" CHECK ("version" > 0),
    CONSTRAINT "opd_order_item_void_check" CHECK (
        (
            "status" = 'ACTIVE'
            AND "void_reason" IS NULL
            AND "voided_by" IS NULL
            AND "voided_at" IS NULL
        )
        OR (
            "status" = 'VOID'
            AND "voided_by" IS NOT NULL
            AND "voided_at" IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_item_identity_uq"
    ON "opd_order_item"(
        "order_item_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_item_display_order_uq"
    ON "opd_order_item"("order_id", "display_order");
CREATE INDEX IF NOT EXISTS "opd_order_item_scope_idx"
    ON "opd_order_item"(
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id",
        "status"
    );
CREATE INDEX IF NOT EXISTS "opd_order_item_source_idx"
    ON "opd_order_item"("source_type", "source_id");

CREATE TABLE IF NOT EXISTS "opd_medication_instruction" (
    "medication_instruction_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "dose" VARCHAR(100),
    "route" VARCHAR(100),
    "frequency" VARCHAR(200),
    "timing" VARCHAR(200),
    "duration_value" DECIMAL(10,2),
    "duration_unit" VARCHAR(30),
    "sig_text" VARCHAR(1000) NOT NULL,
    "note" VARCHAR(2000),
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_medication_instruction_pkey" PRIMARY KEY
        ("medication_instruction_id"),
    CONSTRAINT "opd_medication_instruction_item_identity_fkey" FOREIGN KEY
        (
            "order_item_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        REFERENCES "opd_order_item"(
            "order_item_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_medication_instruction_sig_check" CHECK (
        BTRIM("sig_text") <> ''
    ),
    CONSTRAINT "opd_medication_instruction_duration_check" CHECK (
        (
            "duration_value" IS NULL
            AND "duration_unit" IS NULL
        )
        OR (
            "duration_value" > 0
            AND "duration_unit" IS NOT NULL
            AND BTRIM("duration_unit") <> ''
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_medication_instruction_identity_uq"
    ON "opd_medication_instruction"(
        "medication_instruction_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id",
        "order_item_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_medication_instruction_item_uq"
    ON "opd_medication_instruction"(
        "order_item_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );
CREATE INDEX IF NOT EXISTS "opd_medication_instruction_scope_idx"
    ON "opd_medication_instruction"(
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );

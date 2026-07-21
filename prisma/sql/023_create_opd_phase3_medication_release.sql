-- Surgical, additive OPD V2 Phase 3B migration.
-- Evolves only the app-owned opd_order aggregate and creates app-owned release
-- snapshots/links. Legacy prescription, sale, product, inventory, receipt, and
-- document tables are intentionally not altered and receive no new foreign keys.

ALTER TABLE "opd_order"
    ADD COLUMN IF NOT EXISTS "released_by" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "released_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "voided_by" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "void_reason" VARCHAR(500);

ALTER TABLE "opd_order"
    DROP CONSTRAINT IF EXISTS "opd_order_status_check";
ALTER TABLE "opd_order"
    ADD CONSTRAINT "opd_order_status_check" CHECK (
        "status" IN ('DRAFT', 'RELEASED', 'VOIDED')
    );

ALTER TABLE "opd_order"
    DROP CONSTRAINT IF EXISTS "opd_order_totals_check";
ALTER TABLE "opd_order"
    ADD CONSTRAINT "opd_order_totals_check" CHECK (
        "subtotal_amount" >= 0
        AND "discount_total_amount" >= 0
        AND "discount_total_amount" <= "subtotal_amount"
        AND "tax_total_amount" = 0
        AND "net_total_amount" = ROUND(
            "subtotal_amount" - "discount_total_amount" + "tax_total_amount",
            2
        )
    );

ALTER TABLE "opd_order"
    DROP CONSTRAINT IF EXISTS "opd_order_lifecycle_check";
ALTER TABLE "opd_order"
    ADD CONSTRAINT "opd_order_lifecycle_check" CHECK (
        (
            "status" = 'DRAFT'
            AND "released_by" IS NULL
            AND "released_at" IS NULL
            AND "voided_by" IS NULL
            AND "voided_at" IS NULL
            AND "void_reason" IS NULL
        )
        OR (
            "status" = 'RELEASED'
            AND "released_by" IS NOT NULL
            AND "released_at" IS NOT NULL
            AND "voided_by" IS NULL
            AND "voided_at" IS NULL
            AND "void_reason" IS NULL
        )
        OR (
            "status" = 'VOIDED'
            AND "released_by" IS NOT NULL
            AND "released_at" IS NOT NULL
            AND "voided_by" IS NOT NULL
            AND "voided_at" IS NOT NULL
            AND "void_reason" IS NOT NULL
            AND BTRIM("void_reason") <> ''
        )
    );

CREATE TABLE IF NOT EXISTS "opd_order_release" (
    "release_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "source_order_version" INTEGER NOT NULL,
    "result_order_version" INTEGER NOT NULL,
    "item_version_manifest" JSONB NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'THB',
    "subtotal_amount" DECIMAL(14,2) NOT NULL,
    "promotion_discount_amount" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_total_amount" DECIMAL(14,2) NOT NULL,
    "pricing_policy" VARCHAR(50) NOT NULL,
    "tax_policy" VARCHAR(50) NOT NULL,
    "safety_source" VARCHAR(50) NOT NULL,
    "safety_snapshot_hash" VARCHAR(64) NOT NULL,
    "safety_acknowledged_by" VARCHAR(50) NOT NULL,
    "safety_acknowledged_at" TIMESTAMPTZ(6) NOT NULL,
    "prescriber_user_id" VARCHAR(50) NOT NULL,
    "released_by" VARCHAR(50) NOT NULL,
    "released_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_order_release_pkey" PRIMARY KEY ("release_id"),
    CONSTRAINT "opd_order_release_order_identity_fkey" FOREIGN KEY
        ("order_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_order"(
            "order_id",
            "clinic_id",
            "branch_id",
            "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_order_release_hash_check" CHECK (
        "request_hash" ~ '^[0-9a-f]{64}$'
        AND "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
        AND "safety_snapshot_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "opd_order_release_version_check" CHECK (
        "source_order_version" > 0
        AND "result_order_version" = "source_order_version" + 1
    ),
    CONSTRAINT "opd_order_release_currency_check" CHECK (
        "currency" = 'THB'
    ),
    CONSTRAINT "opd_order_release_policy_check" CHECK (
        "pricing_policy" = 'opd-medication-release-price-v1'
        AND "tax_policy" = 'opd-medication-no-vat-v1'
        AND "safety_source" = 'LEGACY_CUSTOMER_INFO_UNVERIFIED'
    ),
    CONSTRAINT "opd_order_release_totals_check" CHECK (
        "subtotal_amount" > 0
        AND "promotion_discount_amount" >= 0
        AND "promotion_discount_amount" <= "subtotal_amount"
        AND "tax_amount" = 0
        AND "net_total_amount" > 0
        AND "net_total_amount" = ROUND(
            "subtotal_amount" - "promotion_discount_amount" + "tax_amount",
            2
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_identity_uq"
    ON "opd_order_release"(
        "release_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_order_uq"
    ON "opd_order_release"(
        "order_id",
        "clinic_id",
        "branch_id",
        "encounter_id"
    );
CREATE INDEX IF NOT EXISTS "opd_order_release_scope_idx"
    ON "opd_order_release"(
        "clinic_id",
        "branch_id",
        "encounter_id",
        "released_at"
    );

CREATE TABLE IF NOT EXISTS "opd_order_release_item" (
    "release_item_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "legacy_prescription_item_id" VARCHAR(50) NOT NULL,
    "legacy_sale_order_item_id" VARCHAR(50) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_id" VARCHAR(50) NOT NULL,
    "source_code" VARCHAR(50) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "name_snapshot" VARCHAR(300) NOT NULL,
    "unit_snapshot" VARCHAR(250) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "base_unit_price_amount" DECIMAL(14,2) NOT NULL,
    "unit_price_amount" DECIMAL(14,2) NOT NULL,
    "pricing_source" VARCHAR(20) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL,
    "tax_type" VARCHAR(30) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "order_item_note" VARCHAR(2000),
    "dose" VARCHAR(100),
    "route" VARCHAR(100),
    "frequency" VARCHAR(200),
    "timing" VARCHAR(200),
    "duration_value" DECIMAL(10,2),
    "duration_unit" VARCHAR(30),
    "sig_text" VARCHAR(1000) NOT NULL,
    "medication_note" VARCHAR(2000),
    "lot_id" VARCHAR(50) NOT NULL,
    "expiry_at" TIMESTAMP(6) NOT NULL,
    "stock_observed_quantity" DECIMAL(10,2) NOT NULL,
    "stock_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_order_release_item_pkey" PRIMARY KEY ("release_item_id"),
    CONSTRAINT "opd_order_release_item_release_identity_fkey" FOREIGN KEY
        (
            "release_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        REFERENCES "opd_order_release"(
            "release_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_order_release_item_order_item_identity_fkey" FOREIGN KEY
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
    CONSTRAINT "opd_order_release_item_display_order_check" CHECK (
        "display_order" > 0
    ),
    CONSTRAINT "opd_order_release_item_source_check" CHECK (
        "source_type" = 'PRODUCT'
        AND "category" IN ('MEDICINE', 'DRUG')
        AND BTRIM("legacy_prescription_item_id") <> ''
        AND BTRIM("legacy_sale_order_item_id") <> ''
        AND BTRIM("source_id") <> ''
        AND BTRIM("source_code") <> ''
        AND BTRIM("name_snapshot") <> ''
        AND BTRIM("unit_snapshot") <> ''
    ),
    CONSTRAINT "opd_order_release_item_pricing_check" CHECK (
        "quantity" > 0
        AND "base_unit_price_amount" > 0
        AND "unit_price_amount" > 0
        AND "pricing_source" IN ('BASE', 'PROMOTION')
        AND "gross_amount" = ROUND(
            "quantity" * "base_unit_price_amount",
            2
        )
        AND "discount_amount" = ROUND(
            "gross_amount" - "net_amount",
            2
        )
        AND "discount_amount" >= 0
        AND "tax_type" = 'NO_VAT'
        AND "tax_amount" = 0
        AND "net_amount" = ROUND("quantity" * "unit_price_amount", 2)
        AND "net_amount" > 0
    ),
    CONSTRAINT "opd_order_release_item_sig_check" CHECK (
        BTRIM("sig_text") <> ''
    ),
    CONSTRAINT "opd_order_release_item_duration_check" CHECK (
        (
            "duration_value" IS NULL
            AND "duration_unit" IS NULL
        )
        OR (
            "duration_value" > 0
            AND "duration_unit" IS NOT NULL
            AND BTRIM("duration_unit") <> ''
        )
    ),
    CONSTRAINT "opd_order_release_item_lot_check" CHECK (
        BTRIM("lot_id") <> ''
        AND "stock_observed_quantity" >= "quantity"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_item_identity_uq"
    ON "opd_order_release_item"(
        "release_item_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id",
        "release_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_item_order_item_uq"
    ON "opd_order_release_item"(
        "release_id",
        "order_item_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_item_display_order_uq"
    ON "opd_order_release_item"("release_id", "display_order");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_item_prescription_item_uq"
    ON "opd_order_release_item"("legacy_prescription_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_release_item_sale_item_uq"
    ON "opd_order_release_item"("legacy_sale_order_item_id");
CREATE INDEX IF NOT EXISTS "opd_order_release_item_lot_idx"
    ON "opd_order_release_item"(
        "branch_id",
        "source_id",
        "lot_id",
        "expiry_at"
    );

CREATE TABLE IF NOT EXISTS "opd_order_prescription_link" (
    "prescription_link_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "legacy_prescribe_id" VARCHAR(50) NOT NULL,
    "legacy_opd_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "prescription_status_snapshot" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_order_prescription_link_pkey" PRIMARY KEY
        ("prescription_link_id"),
    CONSTRAINT "opd_order_prescription_link_release_identity_fkey" FOREIGN KEY
        (
            "release_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        REFERENCES "opd_order_release"(
            "release_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_order_prescription_link_snapshot_check" CHECK (
        "prescription_status_snapshot" = 'WAITING'
        AND BTRIM("legacy_prescribe_id") <> ''
        AND BTRIM("legacy_opd_id") <> ''
        AND BTRIM("customer_id") <> ''
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_prescription_link_identity_uq"
    ON "opd_order_prescription_link"(
        "prescription_link_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id",
        "release_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_prescription_link_release_uq"
    ON "opd_order_prescription_link"(
        "release_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_prescription_link_legacy_uq"
    ON "opd_order_prescription_link"("branch_id", "legacy_prescribe_id");
CREATE INDEX IF NOT EXISTS "opd_order_prescription_link_legacy_opd_idx"
    ON "opd_order_prescription_link"(
        "clinic_id",
        "branch_id",
        "legacy_opd_id"
    );

CREATE TABLE IF NOT EXISTS "opd_order_sale_link" (
    "sale_link_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "legacy_sale_order_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "sale_order_status_snapshot" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_order_sale_link_pkey" PRIMARY KEY ("sale_link_id"),
    CONSTRAINT "opd_order_sale_link_release_identity_fkey" FOREIGN KEY
        (
            "release_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        REFERENCES "opd_order_release"(
            "release_id",
            "clinic_id",
            "branch_id",
            "encounter_id",
            "order_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_order_sale_link_snapshot_check" CHECK (
        "sale_order_status_snapshot" = 'PENDING'
        AND BTRIM("legacy_sale_order_id") <> ''
        AND BTRIM("customer_id") <> ''
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_sale_link_identity_uq"
    ON "opd_order_sale_link"(
        "sale_link_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id",
        "release_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_sale_link_release_uq"
    ON "opd_order_sale_link"(
        "release_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "order_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_order_sale_link_legacy_uq"
    ON "opd_order_sale_link"("branch_id", "legacy_sale_order_id");
CREATE INDEX IF NOT EXISTS "opd_order_sale_link_scope_idx"
    ON "opd_order_sale_link"(
        "clinic_id",
        "branch_id",
        "customer_id",
        "created_at"
    );

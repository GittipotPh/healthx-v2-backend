-- Surgical, additive OPD V2 Phase 3C migration.
-- Creates only app-owned reservation/snapshot structures. Legacy entitlement,
-- service-usage, OPD, inventory, appointment, and document tables are frozen.

CREATE TABLE IF NOT EXISTS "opd_course_reservation" (
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "legacy_opd_id" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    "request_hash" CHAR(64) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "source_encounter_version" INTEGER NOT NULL,
    "source_balance_manifest" JSONB NOT NULL,
    "legacy_service_usage_id" VARCHAR(50) NOT NULL,
    "legacy_service_usage_branch_id" VARCHAR(50) NOT NULL,
    "legacy_service_usage_status_snapshot" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reserved_by_user_id" VARCHAR(50) NOT NULL,
    "reserved_at" TIMESTAMPTZ(6) NOT NULL,
    "voided_by_user_id" VARCHAR(50),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_reservation_pkey" PRIMARY KEY ("reservation_id"),
    CONSTRAINT "opd_course_reservation_encounter_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_reservation_hash_check" CHECK (
        "request_hash" ~ '^[0-9a-f]{64}$'
        AND "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "opd_course_reservation_scope_check" CHECK (
        BTRIM("customer_id") <> ''
        AND BTRIM("legacy_opd_id") <> ''
        AND BTRIM("legacy_service_usage_id") <> ''
        AND "legacy_service_usage_branch_id" = "branch_id"
        AND "legacy_service_usage_status_snapshot" = 'PENDING'
        AND "source_encounter_version" > 0
        AND "version" > 0
        AND JSONB_TYPEOF("source_balance_manifest") = 'array'
    ),
    CONSTRAINT "opd_course_reservation_lifecycle_check" CHECK (
        (
            "status" = 'RESERVED'
            AND "voided_by_user_id" IS NULL
            AND "voided_at" IS NULL
            AND "void_reason" IS NULL
            AND "version" = 1
        )
        OR (
            "status" = 'VOIDED'
            AND "voided_by_user_id" IS NOT NULL
            AND "voided_at" IS NOT NULL
            AND "void_reason" IS NOT NULL
            AND BTRIM("void_reason") <> ''
            AND "version" = 2
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_identity_uq"
    ON "opd_course_reservation"(
        "reservation_id", "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_active_encounter_uq"
    ON "opd_course_reservation"("clinic_id", "branch_id", "encounter_id")
    WHERE "status" = 'RESERVED';
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_legacy_usage_uq"
    ON "opd_course_reservation"(
        "legacy_service_usage_branch_id", "legacy_service_usage_id"
    );
CREATE INDEX IF NOT EXISTS "opd_course_reservation_customer_idx"
    ON "opd_course_reservation"(
        "clinic_id", "branch_id", "customer_id", "reserved_at" DESC
    );

CREATE TABLE IF NOT EXISTS "opd_course_reservation_item" (
    "reservation_item_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "legacy_service_usage_item_id" VARCHAR(50) NOT NULL,
    "legacy_usage_log_id" VARCHAR(50) NOT NULL,
    "purchase_branch_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "sale_order_id" VARCHAR(50) NOT NULL,
    "course_id" VARCHAR(50) NOT NULL,
    "course_item_id" VARCHAR(50) NOT NULL,
    "course_code_snapshot" VARCHAR(50) NOT NULL,
    "course_name_snapshot" VARCHAR(250) NOT NULL,
    "item_name_snapshot" VARCHAR(256) NOT NULL,
    "unit_snapshot" VARCHAR(50) NOT NULL,
    "entitlement_expire_at" TIMESTAMP(6) NOT NULL,
    "display_expire_at" TIMESTAMP(6) NOT NULL,
    "entitlement_amount" DECIMAL(10,2) NOT NULL,
    "before_reserved_amount" DECIMAL(10,2) NOT NULL,
    "before_used_amount" DECIMAL(10,2) NOT NULL,
    "before_remaining_amount" DECIMAL(10,2) NOT NULL,
    "reserved_amount" DECIMAL(10,2) NOT NULL,
    "after_remaining_amount" DECIMAL(10,2) NOT NULL,
    "entitlement_created_at" TIMESTAMP(6),
    "entitlement_updated_at" TIMESTAMP(6),
    "sale_order_updated_at" TIMESTAMP(6),
    "course_updated_at" TIMESTAMP(6) NOT NULL,
    "course_item_updated_at" TIMESTAMP(6) NOT NULL,
    "source_snapshot_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_reservation_item_pkey" PRIMARY KEY ("reservation_item_id"),
    CONSTRAINT "opd_course_reservation_item_root_fkey" FOREIGN KEY
        ("reservation_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_reservation"(
            "reservation_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_reservation_item_identity_check" CHECK (
        "display_order" > 0
        AND BTRIM("legacy_service_usage_item_id") <> ''
        AND BTRIM("legacy_usage_log_id") <> ''
        AND BTRIM("purchase_branch_id") <> ''
        AND BTRIM("customer_id") <> ''
        AND BTRIM("sale_order_id") <> ''
        AND BTRIM("course_id") <> ''
        AND BTRIM("course_item_id") <> ''
        AND BTRIM("course_code_snapshot") <> ''
        AND BTRIM("course_name_snapshot") <> ''
        AND BTRIM("item_name_snapshot") <> ''
        AND BTRIM("unit_snapshot") <> ''
        AND "source_snapshot_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "opd_course_reservation_item_balance_check" CHECK (
        "entitlement_amount" > 0
        AND "entitlement_amount" = TRUNC("entitlement_amount")
        AND "before_reserved_amount" >= 0
        AND "before_used_amount" >= 0
        AND "before_remaining_amount" >= 0
        AND "reserved_amount" > 0
        AND "reserved_amount" = TRUNC("reserved_amount")
        AND "after_remaining_amount" >= 0
        AND "before_remaining_amount" =
            "entitlement_amount" - "before_reserved_amount" - "before_used_amount"
        AND "after_remaining_amount" =
            "before_remaining_amount" - "reserved_amount"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_item_identity_uq"
    ON "opd_course_reservation_item"(
        "reservation_item_id", "reservation_id", "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_item_entitlement_uq"
    ON "opd_course_reservation_item"(
        "reservation_id", "purchase_branch_id", "sale_order_id",
        "course_item_id", "entitlement_expire_at"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_item_order_uq"
    ON "opd_course_reservation_item"("reservation_id", "display_order");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_item_legacy_item_uq"
    ON "opd_course_reservation_item"("branch_id", "legacy_service_usage_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_item_usage_log_uq"
    ON "opd_course_reservation_item"("legacy_usage_log_id");

CREATE TABLE IF NOT EXISTS "opd_course_reservation_component" (
    "reservation_component_id" UUID NOT NULL,
    "reservation_item_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "product_id" VARCHAR(50) NOT NULL,
    "product_code_snapshot" VARCHAR(50) NOT NULL,
    "product_name_snapshot" VARCHAR(250) NOT NULL,
    "unit_snapshot" VARCHAR(250) NOT NULL,
    "configured_quantity" DECIMAL(10,2) NOT NULL,
    "total_quantity" DECIMAL(10,2) NOT NULL,
    "lot_id" VARCHAR(50) NOT NULL,
    "expiry_at" TIMESTAMP(6) NOT NULL,
    "stock_observed_quantity" DECIMAL(10,2) NOT NULL,
    "stock_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "source_updated_at" TIMESTAMP(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_reservation_component_pkey" PRIMARY KEY ("reservation_component_id"),
    CONSTRAINT "opd_course_reservation_component_item_fkey" FOREIGN KEY
        ("reservation_item_id", "reservation_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_reservation_item"(
            "reservation_item_id", "reservation_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_reservation_component_values_check" CHECK (
        "display_order" > 0
        AND BTRIM("product_id") <> ''
        AND BTRIM("product_code_snapshot") <> ''
        AND BTRIM("product_name_snapshot") <> ''
        AND BTRIM("unit_snapshot") <> ''
        AND "configured_quantity" > 0
        AND "total_quantity" > 0
        AND BTRIM("lot_id") <> ''
        AND "stock_observed_quantity" >= "total_quantity"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_component_identity_uq"
    ON "opd_course_reservation_component"(
        "reservation_component_id", "reservation_item_id", "reservation_id",
        "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_component_product_uq"
    ON "opd_course_reservation_component"("reservation_item_id", "product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_component_order_uq"
    ON "opd_course_reservation_component"("reservation_item_id", "display_order");
CREATE INDEX IF NOT EXISTS "opd_course_reservation_component_lot_idx"
    ON "opd_course_reservation_component"("branch_id", "product_id", "lot_id", "expiry_at");

CREATE TABLE IF NOT EXISTS "opd_course_reservation_operator" (
    "reservation_operator_id" UUID NOT NULL,
    "reservation_item_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "role_id" VARCHAR(50) NOT NULL,
    "operator_type" VARCHAR(20) NOT NULL,
    "commission_amount" DECIMAL(10,2) NOT NULL,
    "commission_unit" VARCHAR(20) NOT NULL,
    "source_user_updated_at" TIMESTAMP(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_reservation_operator_pkey" PRIMARY KEY ("reservation_operator_id"),
    CONSTRAINT "opd_course_reservation_operator_item_fkey" FOREIGN KEY
        ("reservation_item_id", "reservation_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_reservation_item"(
            "reservation_item_id", "reservation_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_reservation_operator_values_check" CHECK (
        BTRIM("user_id") <> ''
        AND BTRIM("role_id") <> ''
        AND "operator_type" IN ('OPERATOR', 'ASSISTANT')
        AND "commission_amount" >= 0
        AND "commission_unit" IN ('AMOUNT', 'PERCENT')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_operator_identity_uq"
    ON "opd_course_reservation_operator"(
        "reservation_operator_id", "reservation_item_id", "reservation_id",
        "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_reservation_operator_rule_uq"
    ON "opd_course_reservation_operator"(
        "reservation_item_id", "role_id", "operator_type"
    );
CREATE INDEX IF NOT EXISTS "opd_course_reservation_operator_user_idx"
    ON "opd_course_reservation_operator"("branch_id", "user_id", "operator_type");

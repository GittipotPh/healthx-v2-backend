-- Surgical, additive OPD V2 Phase 3D migration.
-- Evolves only the app-owned Phase 3C reservation root, creates app-owned
-- verification/compensation evidence, and adds catalog-only permissions.
-- No legacy service-usage, course, inventory, OPD, appointment, queue, or
-- customer-file table/constraint/index is changed.

ALTER TABLE "opd_course_reservation"
    ADD COLUMN IF NOT EXISTS "used_by_user_id" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "used_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "compensated_by_user_id" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "compensated_at" TIMESTAMPTZ(6);

ALTER TABLE "opd_course_reservation"
    DROP CONSTRAINT IF EXISTS "opd_course_reservation_lifecycle_check";

ALTER TABLE "opd_course_reservation"
    ADD CONSTRAINT "opd_course_reservation_lifecycle_check" CHECK (
        (
            "status" = 'RESERVED'
            AND "version" = 1
            AND "voided_by_user_id" IS NULL
            AND "voided_at" IS NULL
            AND "void_reason" IS NULL
            AND "used_by_user_id" IS NULL
            AND "used_at" IS NULL
            AND "compensated_by_user_id" IS NULL
            AND "compensated_at" IS NULL
        )
        OR (
            "status" = 'VOIDED'
            AND "version" = 2
            AND "voided_by_user_id" IS NOT NULL
            AND "voided_at" IS NOT NULL
            AND "void_reason" IS NOT NULL
            AND BTRIM("void_reason") <> ''
            AND "used_by_user_id" IS NULL
            AND "used_at" IS NULL
            AND "compensated_by_user_id" IS NULL
            AND "compensated_at" IS NULL
        )
        OR (
            "status" = 'USED'
            AND "version" = 2
            AND "voided_by_user_id" IS NULL
            AND "voided_at" IS NULL
            AND "void_reason" IS NULL
            AND "used_by_user_id" IS NOT NULL
            AND "used_at" IS NOT NULL
            AND "compensated_by_user_id" IS NULL
            AND "compensated_at" IS NULL
        )
        OR (
            "status" = 'COMPENSATED'
            AND "version" = 3
            AND "voided_by_user_id" IS NULL
            AND "voided_at" IS NULL
            AND "void_reason" IS NULL
            AND "used_by_user_id" IS NOT NULL
            AND "used_at" IS NOT NULL
            AND "compensated_by_user_id" IS NOT NULL
            AND "compensated_at" IS NOT NULL
            AND "compensated_at" >= "used_at"
        )
    );

CREATE TABLE IF NOT EXISTS "opd_course_verification" (
    "verification_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "legacy_opd_id" VARCHAR(50) NOT NULL,
    "legacy_service_usage_id" VARCHAR(50) NOT NULL,
    "legacy_service_usage_branch_id" VARCHAR(50) NOT NULL,
    "source_reservation_version" INTEGER NOT NULL,
    "result_reservation_version" INTEGER NOT NULL,
    "source_legacy_status" VARCHAR(20) NOT NULL,
    "result_legacy_status" VARCHAR(20) NOT NULL,
    "manifest_schema" VARCHAR(50) NOT NULL,
    "verification_manifest" JSONB NOT NULL,
    "manifest_hash" CHAR(64) NOT NULL,
    "signer_customer_id" VARCHAR(50) NOT NULL,
    "acknowledgement_version" VARCHAR(50) NOT NULL,
    "acknowledgement_locale" VARCHAR(10) NOT NULL,
    "acknowledgement_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "verified_by_user_id" VARCHAR(50) NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL,
    "signature_file_id" VARCHAR(50) NOT NULL,
    "signature_mime_type" VARCHAR(100) NOT NULL,
    "signature_bytes" INTEGER NOT NULL,
    "signature_hash" CHAR(64) NOT NULL,
    "pdf_file_id" VARCHAR(50) NOT NULL,
    "pdf_mime_type" VARCHAR(100) NOT NULL,
    "pdf_bytes" INTEGER NOT NULL,
    "pdf_hash" CHAR(64) NOT NULL,
    "render_template" VARCHAR(50) NOT NULL,
    "render_version" INTEGER NOT NULL,
    "legacy_document_url" TEXT NOT NULL,
    "client_ip" VARCHAR(64),
    "user_agent_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_verification_pkey" PRIMARY KEY ("verification_id"),
    CONSTRAINT "opd_course_verification_reservation_fkey" FOREIGN KEY
        ("reservation_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_reservation"(
            "reservation_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_verification_scope_check" CHECK (
        BTRIM("customer_id") <> ''
        AND BTRIM("legacy_opd_id") <> ''
        AND BTRIM("legacy_service_usage_id") <> ''
        AND "legacy_service_usage_branch_id" = "branch_id"
        AND "source_reservation_version" = 1
        AND "result_reservation_version" = 2
        AND "source_legacy_status" = 'PENDING'
        AND "result_legacy_status" = 'APPROVED'
        AND BTRIM("manifest_schema") <> ''
        AND JSONB_TYPEOF("verification_manifest") = 'object'
        AND "signer_customer_id" = "customer_id"
        AND BTRIM("acknowledgement_version") <> ''
        AND "acknowledgement_locale" IN ('th-TH', 'en-US')
        AND BTRIM("verified_by_user_id") <> ''
        AND "signature_mime_type" = 'image/png'
        AND "signature_bytes" > 0
        AND "pdf_mime_type" = 'application/pdf'
        AND "pdf_bytes" > 0
        AND "render_template" = 'opd-course-use-verification-v1'
        AND "render_version" = 1
        AND BTRIM("legacy_document_url") <> ''
    ),
    CONSTRAINT "opd_course_verification_hash_check" CHECK (
        "manifest_hash" ~ '^[0-9a-f]{64}$'
        AND "acknowledgement_hash" ~ '^[0-9a-f]{64}$'
        AND "request_hash" ~ '^[0-9a-f]{64}$'
        AND "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
        AND "signature_hash" ~ '^[0-9a-f]{64}$'
        AND "pdf_hash" ~ '^[0-9a-f]{64}$'
        AND ("user_agent_hash" IS NULL OR "user_agent_hash" ~ '^[0-9a-f]{64}$')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_identity_uq"
    ON "opd_course_verification"(
        "verification_id", "reservation_id", "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_reservation_uq"
    ON "opd_course_verification"("reservation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_reservation_identity_uq"
    ON "opd_course_verification"(
        "reservation_id", "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_legacy_usage_uq"
    ON "opd_course_verification"(
        "legacy_service_usage_branch_id", "legacy_service_usage_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_signature_file_uq"
    ON "opd_course_verification"("signature_file_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_pdf_file_uq"
    ON "opd_course_verification"("pdf_file_id");
CREATE INDEX IF NOT EXISTS "opd_course_verification_customer_time_idx"
    ON "opd_course_verification"(
        "clinic_id", "branch_id", "customer_id", "verified_at" DESC
    );

CREATE TABLE IF NOT EXISTS "opd_course_verification_component" (
    "verification_component_id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "reservation_component_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "product_id" VARCHAR(50) NOT NULL,
    "original_lot_id" VARCHAR(50) NOT NULL,
    "actual_lot_id" VARCHAR(50) NOT NULL,
    "replacement_reason" VARCHAR(500),
    "expiry_at" TIMESTAMP(6) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "before_lot_stock" DECIMAL(10,2) NOT NULL,
    "after_lot_stock" DECIMAL(10,2) NOT NULL,
    "before_total_stock" DECIMAL(10,2) NOT NULL,
    "after_total_stock" DECIMAL(10,2) NOT NULL,
    "inventory_log_id" VARCHAR(50) NOT NULL,
    "inventory_source_updated_at" TIMESTAMP(6),
    "snapshot_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_verification_component_pkey"
        PRIMARY KEY ("verification_component_id"),
    CONSTRAINT "opd_course_verification_component_root_fkey" FOREIGN KEY
        ("verification_id", "reservation_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_verification"(
            "verification_id", "reservation_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_verification_component_values_check" CHECK (
        BTRIM("product_id") <> ''
        AND BTRIM("original_lot_id") <> ''
        AND BTRIM("actual_lot_id") <> ''
        AND (
            ("original_lot_id" = "actual_lot_id" AND "replacement_reason" IS NULL)
            OR (
                "original_lot_id" <> "actual_lot_id"
                AND "replacement_reason" IS NOT NULL
                AND BTRIM("replacement_reason") <> ''
            )
        )
        AND "quantity" > 0
        AND "before_lot_stock" >= "quantity"
        AND "after_lot_stock" = "before_lot_stock" - "quantity"
        AND "before_total_stock" >= "quantity"
        AND "after_total_stock" = "before_total_stock" - "quantity"
        AND BTRIM("inventory_log_id") <> ''
        AND "snapshot_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_component_identity_uq"
    ON "opd_course_verification_component"(
        "verification_component_id", "verification_id", "reservation_id",
        "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_verification_component_source_uq"
    ON "opd_course_verification_component"(
        "verification_id", "reservation_component_id"
    );
CREATE INDEX IF NOT EXISTS "opd_course_verification_component_inventory_idx"
    ON "opd_course_verification_component"("verification_id", "inventory_log_id");
CREATE INDEX IF NOT EXISTS "opd_course_verification_component_lot_idx"
    ON "opd_course_verification_component"(
        "branch_id", "product_id", "actual_lot_id", "expiry_at"
    );

CREATE TABLE IF NOT EXISTS "opd_course_compensation_request" (
    "compensation_request_id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reason_code" VARCHAR(50) NOT NULL,
    "reason_description" VARCHAR(256) NOT NULL,
    "requested_by_user_id" VARCHAR(50) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "source_reservation_version" INTEGER NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "legacy_service_usage_id" VARCHAR(50) NOT NULL,
    "legacy_service_usage_branch_id" VARCHAR(50) NOT NULL,
    "reviewed_by_user_id" VARCHAR(50),
    "reviewed_at" TIMESTAMPTZ(6),
    "review_reason" VARCHAR(500),
    "review_request_hash" CHAR(64),
    "review_idempotency_key_hash" CHAR(64),
    "adjustment_document_id" VARCHAR(50),
    "reversal_manifest" JSONB,
    "reversal_manifest_hash" CHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_compensation_request_pkey"
        PRIMARY KEY ("compensation_request_id"),
    CONSTRAINT "opd_course_compensation_request_verification_fkey" FOREIGN KEY
        ("verification_id", "reservation_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_verification"(
            "verification_id", "reservation_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_compensation_request_scope_check" CHECK (
        BTRIM("reason_code") <> ''
        AND BTRIM("reason_description") <> ''
        AND BTRIM("requested_by_user_id") <> ''
        AND "source_reservation_version" = 2
        AND BTRIM("legacy_service_usage_id") <> ''
        AND "legacy_service_usage_branch_id" = "branch_id"
        AND "request_hash" ~ '^[0-9a-f]{64}$'
        AND "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "opd_course_compensation_request_lifecycle_check" CHECK (
        (
            "status" = 'PENDING'
            AND "version" = 1
            AND "reviewed_by_user_id" IS NULL
            AND "reviewed_at" IS NULL
            AND "review_reason" IS NULL
            AND "review_request_hash" IS NULL
            AND "review_idempotency_key_hash" IS NULL
            AND "adjustment_document_id" IS NULL
            AND "reversal_manifest" IS NULL
            AND "reversal_manifest_hash" IS NULL
        )
        OR (
            "status" = 'REJECTED'
            AND "version" = 2
            AND "reviewed_by_user_id" IS NOT NULL
            AND "reviewed_by_user_id" <> "requested_by_user_id"
            AND "reviewed_at" IS NOT NULL
            AND "review_reason" IS NOT NULL
            AND BTRIM("review_reason") <> ''
            AND "review_request_hash" ~ '^[0-9a-f]{64}$'
            AND "review_idempotency_key_hash" ~ '^[0-9a-f]{64}$'
            AND "adjustment_document_id" IS NULL
            AND "reversal_manifest" IS NULL
            AND "reversal_manifest_hash" IS NULL
        )
        OR (
            "status" = 'APPROVED'
            AND "version" = 2
            AND "reviewed_by_user_id" IS NOT NULL
            AND "reviewed_by_user_id" <> "requested_by_user_id"
            AND "reviewed_at" IS NOT NULL
            AND "review_reason" IS NOT NULL
            AND BTRIM("review_reason") <> ''
            AND "review_request_hash" ~ '^[0-9a-f]{64}$'
            AND "review_idempotency_key_hash" ~ '^[0-9a-f]{64}$'
            AND "adjustment_document_id" IS NOT NULL
            AND BTRIM("adjustment_document_id") <> ''
            AND JSONB_TYPEOF("reversal_manifest") = 'object'
            AND "reversal_manifest_hash" ~ '^[0-9a-f]{64}$'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_compensation_request_identity_uq"
    ON "opd_course_compensation_request"(
        "compensation_request_id", "verification_id", "reservation_id",
        "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_compensation_request_pending_uq"
    ON "opd_course_compensation_request"("verification_id")
    WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_compensation_request_approved_uq"
    ON "opd_course_compensation_request"("verification_id")
    WHERE "status" = 'APPROVED';
CREATE INDEX IF NOT EXISTS "opd_course_compensation_request_status_idx"
    ON "opd_course_compensation_request"(
        "clinic_id", "branch_id", "status", "requested_at" DESC
    );

CREATE TABLE IF NOT EXISTS "opd_course_compensation_component" (
    "compensation_component_id" UUID NOT NULL,
    "compensation_request_id" UUID NOT NULL,
    "verification_component_id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "product_id" VARCHAR(50) NOT NULL,
    "lot_id" VARCHAR(50) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "original_inventory_log_id" VARCHAR(50) NOT NULL,
    "inverse_inventory_log_id" VARCHAR(50) NOT NULL,
    "before_lot_stock" DECIMAL(10,2) NOT NULL,
    "after_lot_stock" DECIMAL(10,2) NOT NULL,
    "before_total_stock" DECIMAL(10,2) NOT NULL,
    "after_total_stock" DECIMAL(10,2) NOT NULL,
    "snapshot_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_course_compensation_component_pkey"
        PRIMARY KEY ("compensation_component_id"),
    CONSTRAINT "opd_course_compensation_component_request_fkey" FOREIGN KEY
        ("compensation_request_id", "verification_id", "reservation_id",
         "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_compensation_request"(
            "compensation_request_id", "verification_id", "reservation_id",
            "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_compensation_component_verification_fkey" FOREIGN KEY
        ("verification_component_id", "verification_id", "reservation_id",
         "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_course_verification_component"(
            "verification_component_id", "verification_id", "reservation_id",
            "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_course_compensation_component_values_check" CHECK (
        BTRIM("product_id") <> ''
        AND BTRIM("lot_id") <> ''
        AND "quantity" > 0
        AND BTRIM("original_inventory_log_id") <> ''
        AND BTRIM("inverse_inventory_log_id") <> ''
        AND "before_lot_stock" >= 0
        AND "after_lot_stock" = "before_lot_stock" + "quantity"
        AND "before_total_stock" >= 0
        AND "after_total_stock" = "before_total_stock" + "quantity"
        AND "snapshot_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_compensation_component_identity_uq"
    ON "opd_course_compensation_component"(
        "compensation_component_id", "compensation_request_id",
        "verification_component_id", "verification_id", "reservation_id",
        "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_course_compensation_component_source_uq"
    ON "opd_course_compensation_component"(
        "compensation_request_id", "verification_component_id"
    );
CREATE INDEX IF NOT EXISTS "opd_course_compensation_component_inverse_idx"
    ON "opd_course_compensation_component"(
        "compensation_request_id", "inverse_inventory_log_id"
    );

CREATE OR REPLACE FUNCTION "opd_phase3d_reject_immutable_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable after commit', TG_TABLE_NAME;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'opd_course_verification_immutable_trg'
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "opd_course_verification_immutable_trg"
        BEFORE UPDATE OR DELETE ON "opd_course_verification"
        FOR EACH ROW EXECUTE FUNCTION "opd_phase3d_reject_immutable_change"();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'opd_course_verification_component_immutable_trg'
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "opd_course_verification_component_immutable_trg"
        BEFORE UPDATE OR DELETE ON "opd_course_verification_component"
        FOR EACH ROW EXECUTE FUNCTION "opd_phase3d_reject_immutable_change"();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'opd_course_compensation_component_immutable_trg'
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "opd_course_compensation_component_immutable_trg"
        BEFORE UPDATE OR DELETE ON "opd_course_compensation_component"
        FOR EACH ROW EXECUTE FUNCTION "opd_phase3d_reject_immutable_change"();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'opd_course_compensation_request_no_delete_trg'
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "opd_course_compensation_request_no_delete_trg"
        BEFORE DELETE ON "opd_course_compensation_request"
        FOR EACH ROW EXECUTE FUNCTION "opd_phase3d_reject_immutable_change"();
    END IF;
END;
$$;

INSERT INTO "permission" (
    "permission_id",
    "name_TH",
    "name_EN",
    "created_at",
    "updated_at",
    "group_name_TH",
    "group_name_EN",
    "sequence"
)
VALUES
(
    'OPD_COURSE_VERIFY',
    'ยืนยันการใช้คอร์สใน OPD',
    'Verify reserved OPD course use',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'OPD',
    'OPD',
    13
),
(
    'OPD_COURSE_COMPENSATE',
    'อนุมัติการย้อนรายการใช้คอร์สใน OPD',
    'Approve or reject OPD course compensation',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'OPD',
    'OPD',
    14
)
ON CONFLICT ("permission_id") DO NOTHING;

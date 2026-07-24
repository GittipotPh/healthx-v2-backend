-- Surgical, additive OPD V2 Phase 2H migration.
-- Creates only app-owned Chart document/revision/artifact tables and relates
-- them to the app-owned OPD encounter. No legacy HealthX table, constraint, or
-- index is altered.

CREATE TABLE IF NOT EXISTS "opd_chart_document" (
    "chart_document_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "template_code" VARCHAR(50) NOT NULL,
    "template_version" VARCHAR(80) NOT NULL,
    "template_name_snapshot" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "current_revision_number" INTEGER NOT NULL DEFAULT 1,
    "finalization_idempotency_key_hash" CHAR(64),
    "finalization_request_hash" CHAR(64),
    "finalized_by" VARCHAR(50),
    "finalized_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_chart_document_pkey" PRIMARY KEY ("chart_document_id"),
    CONSTRAINT "opd_chart_document_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_chart_document_values_check" CHECK (
        BTRIM("customer_id") <> ''
        AND BTRIM("template_code") <> ''
        AND BTRIM("template_version") <> ''
        AND BTRIM("template_name_snapshot") <> ''
        AND "status" IN ('DRAFT', 'FINAL')
        AND "version" > 0
        AND "current_revision_number" = "version"
        AND (
            (
                "status" = 'DRAFT'
                AND "finalization_idempotency_key_hash" IS NULL
                AND "finalization_request_hash" IS NULL
                AND "finalized_by" IS NULL
                AND "finalized_at" IS NULL
            )
            OR (
                "status" = 'FINAL'
                AND "finalization_idempotency_key_hash" ~ '^[0-9a-f]{64}$'
                AND "finalization_request_hash" ~ '^[0-9a-f]{64}$'
                AND "finalized_by" IS NOT NULL
                AND "finalized_at" IS NOT NULL
            )
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_document_identity_uq"
    ON "opd_chart_document"(
        "chart_document_id", "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_document_encounter_template_uq"
    ON "opd_chart_document"(
        "encounter_id", "clinic_id", "branch_id", "template_code"
    );
CREATE INDEX IF NOT EXISTS "opd_chart_document_encounter_idx"
    ON "opd_chart_document"(
        "clinic_id", "branch_id", "encounter_id", "status"
    );
CREATE INDEX IF NOT EXISTS "opd_chart_document_customer_idx"
    ON "opd_chart_document"(
        "clinic_id", "branch_id", "customer_id", "updated_at" DESC
    );

CREATE TABLE IF NOT EXISTS "opd_chart_revision" (
    "chart_revision_id" UUID NOT NULL,
    "chart_document_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "content_schema" VARCHAR(50) NOT NULL DEFAULT 'opd-chart-vector-v1',
    "vector_snapshot" JSONB NOT NULL,
    "clinical_metadata" JSONB NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "finalization_idempotency_key_hash" CHAR(64),
    "finalization_request_hash" CHAR(64),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_chart_revision_pkey" PRIMARY KEY ("chart_revision_id"),
    CONSTRAINT "opd_chart_revision_document_identity_fkey" FOREIGN KEY
        ("chart_document_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_chart_document"(
            "chart_document_id", "clinic_id", "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_chart_revision_values_check" CHECK (
        "revision_number" > 0
        AND "status" IN ('DRAFT', 'FINAL')
        AND "content_schema" = 'opd-chart-vector-v1'
        AND JSONB_TYPEOF("vector_snapshot") = 'object'
        AND JSONB_TYPEOF("clinical_metadata") = 'object'
        AND "content_sha256" ~ '^[0-9a-f]{64}$'
        AND (
            (
                "status" = 'DRAFT'
                AND "finalization_idempotency_key_hash" IS NULL
                AND "finalization_request_hash" IS NULL
            )
            OR (
                "status" = 'FINAL'
                AND "finalization_idempotency_key_hash" ~ '^[0-9a-f]{64}$'
                AND "finalization_request_hash" ~ '^[0-9a-f]{64}$'
            )
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_revision_identity_uq"
    ON "opd_chart_revision"(
        "chart_revision_id", "chart_document_id", "clinic_id", "branch_id",
        "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_revision_number_uq"
    ON "opd_chart_revision"("chart_document_id", "revision_number");
CREATE INDEX IF NOT EXISTS "opd_chart_revision_current_idx"
    ON "opd_chart_revision"(
        "clinic_id", "branch_id", "encounter_id", "chart_document_id",
        "revision_number" DESC
    );
CREATE INDEX IF NOT EXISTS "opd_chart_revision_content_hash_idx"
    ON "opd_chart_revision"("content_sha256");

CREATE TABLE IF NOT EXISTS "opd_chart_artifact" (
    "chart_artifact_id" UUID NOT NULL,
    "chart_revision_id" UUID NOT NULL,
    "chart_document_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "artifact_format" VARCHAR(10) NOT NULL,
    "storage_provider" VARCHAR(20) NOT NULL,
    "storage_bucket" VARCHAR(200) NOT NULL,
    "storage_object_key" VARCHAR(700) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_chart_artifact_pkey" PRIMARY KEY ("chart_artifact_id"),
    CONSTRAINT "opd_chart_artifact_revision_identity_fkey" FOREIGN KEY
        (
            "chart_revision_id", "chart_document_id", "clinic_id",
            "branch_id", "encounter_id"
        )
        REFERENCES "opd_chart_revision"(
            "chart_revision_id", "chart_document_id", "clinic_id",
            "branch_id", "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_chart_artifact_values_check" CHECK (
        "artifact_format" IN ('PNG', 'PDF')
        AND "storage_provider" IN ('minio', 'azure')
        AND BTRIM("storage_bucket") <> ''
        AND BTRIM("storage_object_key") <> ''
        AND (
            (
                "artifact_format" = 'PNG'
                AND "mime_type" = 'image/png'
            )
            OR (
                "artifact_format" = 'PDF'
                AND "mime_type" = 'application/pdf'
            )
        )
        AND "file_size_bytes" > 0
        AND "sha256" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_artifact_identity_uq"
    ON "opd_chart_artifact"(
        "chart_artifact_id", "chart_revision_id", "chart_document_id",
        "clinic_id", "branch_id", "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_artifact_revision_format_uq"
    ON "opd_chart_artifact"("chart_revision_id", "artifact_format");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_artifact_object_uq"
    ON "opd_chart_artifact"(
        "storage_provider", "storage_bucket", "storage_object_key"
    );
CREATE INDEX IF NOT EXISTS "opd_chart_artifact_encounter_idx"
    ON "opd_chart_artifact"(
        "clinic_id", "branch_id", "encounter_id", "chart_document_id"
    );

-- Approved CAZ image-first Chart transition.
-- Evolves only app-owned migration-028 tables. No legacy HealthX table,
-- constraint, index, or relation is changed.
--
-- Safety: an environment that contains vector Chart rows must be reconciled
-- through an explicitly reviewed data migration. This transition never
-- discards or silently reinterprets those rows.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'opd_chart_document'
          AND column_name = 'content_schema'
    ) AND (
        EXISTS (SELECT 1 FROM "opd_chart_document")
        OR EXISTS (SELECT 1 FROM "opd_chart_revision")
        OR EXISTS (SELECT 1 FROM "opd_chart_artifact")
    ) THEN
        RAISE EXCEPTION
            'CAZ migration 029 requires zero legacy vector Chart rows; run reviewed reconciliation instead';
    END IF;
END
$$;

ALTER TABLE "opd_chart_document"
    ADD COLUMN IF NOT EXISTS "content_schema" VARCHAR(50) NOT NULL
        DEFAULT 'opd-chart-raster-v1',
    ADD COLUMN IF NOT EXISTS "clinical_metadata" JSONB NOT NULL
        DEFAULT '{"location":"","character":"","size":"","side":"","doctorNote":""}'::JSONB,
    ADD COLUMN IF NOT EXISTS "content_sha256" CHAR(64) NOT NULL,
    ADD COLUMN IF NOT EXISTS "raster_sha256" CHAR(64) NOT NULL,
    ADD COLUMN IF NOT EXISTS "raster_file_size_bytes" INTEGER NOT NULL,
    ADD COLUMN IF NOT EXISTS "last_client_mutation_id" UUID NOT NULL,
    ADD COLUMN IF NOT EXISTS "draft_storage_provider" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "draft_storage_bucket" VARCHAR(200),
    ADD COLUMN IF NOT EXISTS "draft_storage_object_key" VARCHAR(700),
    ADD COLUMN IF NOT EXISTS "draft_storage_etag" VARCHAR(300),
    ADD COLUMN IF NOT EXISTS "finalization_id" UUID;

ALTER TABLE "opd_chart_document"
    ALTER COLUMN "current_revision_number" DROP NOT NULL,
    ALTER COLUMN "current_revision_number" DROP DEFAULT;

ALTER TABLE "opd_chart_document"
    DROP CONSTRAINT IF EXISTS "opd_chart_document_values_check";

ALTER TABLE "opd_chart_document"
    ADD CONSTRAINT "opd_chart_document_values_check" CHECK (
        BTRIM("customer_id") <> ''
        AND BTRIM("template_code") <> ''
        AND BTRIM("template_version") <> ''
        AND BTRIM("template_name_snapshot") <> ''
        AND "status" IN ('DRAFT', 'FINAL')
        AND "version" > 0
        AND "current_revision_number" IS NULL
        AND "content_schema" = 'opd-chart-raster-v1'
        AND JSONB_TYPEOF("clinical_metadata") = 'object'
        AND "content_sha256" ~ '^[0-9a-f]{64}$'
        AND "raster_sha256" ~ '^[0-9a-f]{64}$'
        AND "raster_file_size_bytes" > 0
        AND (
            (
                "status" = 'DRAFT'
                AND "draft_storage_provider" IN ('minio', 'azure')
                AND BTRIM("draft_storage_bucket") <> ''
                AND BTRIM("draft_storage_object_key") <> ''
                AND BTRIM("draft_storage_etag") <> ''
                AND "finalization_id" IS NULL
                AND "finalization_idempotency_key_hash" IS NULL
                AND "finalization_request_hash" IS NULL
                AND "finalized_by" IS NULL
                AND "finalized_at" IS NULL
            )
            OR (
                "status" = 'FINAL'
                AND "draft_storage_provider" IS NULL
                AND "draft_storage_bucket" IS NULL
                AND "draft_storage_object_key" IS NULL
                AND "draft_storage_etag" IS NULL
                AND "finalization_id" IS NOT NULL
                AND "finalization_idempotency_key_hash" ~ '^[0-9a-f]{64}$'
                AND "finalization_request_hash" ~ '^[0-9a-f]{64}$'
                AND "finalized_by" IS NOT NULL
                AND "finalized_at" IS NOT NULL
            )
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_document_draft_object_uq"
    ON "opd_chart_document"(
        "draft_storage_provider",
        "draft_storage_bucket",
        "draft_storage_object_key"
    );

ALTER TABLE "opd_chart_artifact"
    ADD COLUMN IF NOT EXISTS "finalization_id" UUID NOT NULL,
    ADD COLUMN IF NOT EXISTS "source_draft_version" INTEGER NOT NULL,
    ADD COLUMN IF NOT EXISTS "storage_etag" VARCHAR(300) NOT NULL;

ALTER TABLE "opd_chart_artifact"
    ALTER COLUMN "chart_revision_id" DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opd_chart_artifact_document_identity_fkey'
    ) THEN
        ALTER TABLE "opd_chart_artifact"
            ADD CONSTRAINT "opd_chart_artifact_document_identity_fkey"
            FOREIGN KEY (
                "chart_document_id", "clinic_id", "branch_id", "encounter_id"
            )
            REFERENCES "opd_chart_document"(
                "chart_document_id", "clinic_id", "branch_id", "encounter_id"
            )
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

ALTER TABLE "opd_chart_artifact"
    DROP CONSTRAINT IF EXISTS "opd_chart_artifact_values_check";

ALTER TABLE "opd_chart_artifact"
    ADD CONSTRAINT "opd_chart_artifact_values_check" CHECK (
        "chart_revision_id" IS NULL
        AND "source_draft_version" > 0
        AND "artifact_format" IN ('PNG', 'PDF')
        AND "storage_provider" IN ('minio', 'azure')
        AND BTRIM("storage_bucket") <> ''
        AND BTRIM("storage_object_key") <> ''
        AND BTRIM("storage_etag") <> ''
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
    );

DROP INDEX IF EXISTS "opd_chart_artifact_identity_uq";
DROP INDEX IF EXISTS "opd_chart_artifact_revision_format_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_artifact_identity_uq"
    ON "opd_chart_artifact"(
        "chart_artifact_id", "chart_document_id", "clinic_id", "branch_id",
        "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_artifact_document_format_uq"
    ON "opd_chart_artifact"("chart_document_id", "artifact_format");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_chart_artifact_finalization_format_uq"
    ON "opd_chart_artifact"("finalization_id", "artifact_format");

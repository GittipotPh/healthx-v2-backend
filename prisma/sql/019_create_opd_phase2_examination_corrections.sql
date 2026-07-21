-- Surgical, additive OPD V2 Phase 2 correction migration.
-- Alters only the app-owned opd_examination table and adds the explicitly
-- approved OPD_CORRECT permission catalog entry. It does not grant that
-- sensitive permission to any role; clinic policy must grant it explicitly.

ALTER TABLE "opd_examination"
    ADD COLUMN IF NOT EXISTS "corrects_examination_id" UUID,
    ADD COLUMN IF NOT EXISTS "supersedes_examination_id" UUID,
    ADD COLUMN IF NOT EXISTS "correction_source_version" INTEGER,
    ADD COLUMN IF NOT EXISTS "correction_reason" VARCHAR(500);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opd_examination_correction_metadata_check'
          AND conrelid = 'opd_examination'::regclass
    ) THEN
        ALTER TABLE "opd_examination"
            ADD CONSTRAINT "opd_examination_correction_metadata_check" CHECK (
                (
                    "corrects_examination_id" IS NULL
                    AND "supersedes_examination_id" IS NULL
                    AND "correction_source_version" IS NULL
                    AND "correction_reason" IS NULL
                ) OR (
                    "corrects_examination_id" IS NOT NULL
                    AND "supersedes_examination_id" IS NOT NULL
                    AND "correction_source_version" > 0
                    AND "correction_reason" IS NOT NULL
                    AND LENGTH(BTRIM("correction_reason")) > 0
                    AND "corrects_examination_id" <> "examination_id"
                    AND "supersedes_examination_id" <> "examination_id"
                )
            );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opd_examination_corrects_identity_fkey'
          AND conrelid = 'opd_examination'::regclass
    ) THEN
        ALTER TABLE "opd_examination"
            ADD CONSTRAINT "opd_examination_corrects_identity_fkey" FOREIGN KEY
                ("corrects_examination_id", "clinic_id", "branch_id", "encounter_id")
                REFERENCES "opd_examination"
                    ("examination_id", "clinic_id", "branch_id", "encounter_id")
                ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'opd_examination_supersedes_identity_fkey'
          AND conrelid = 'opd_examination'::regclass
    ) THEN
        ALTER TABLE "opd_examination"
            ADD CONSTRAINT "opd_examination_supersedes_identity_fkey" FOREIGN KEY
                ("supersedes_examination_id", "clinic_id", "branch_id", "encounter_id")
                REFERENCES "opd_examination"
                    ("examination_id", "clinic_id", "branch_id", "encounter_id")
                ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "opd_examination_supersedes_uq"
    ON "opd_examination"(
        "supersedes_examination_id",
        "clinic_id",
        "branch_id",
        "encounter_id"
    );

CREATE INDEX IF NOT EXISTS "opd_examination_correction_root_idx"
    ON "opd_examination"(
        "clinic_id",
        "branch_id",
        "encounter_id",
        "corrects_examination_id",
        "examination_number"
    );

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
VALUES (
    'OPD_CORRECT',
    'แก้ไขข้อมูล OPD หลังยืนยัน',
    'Correct finalized OPD data',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'OPD',
    'OPD',
    11
)
ON CONFLICT ("permission_id") DO NOTHING;

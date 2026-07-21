-- Surgical, additive OPD V2 Phase 2F migration.
-- Creates ONLY the app-owned urinary/bowel intake resource. SL and the
-- free-floating Lt/Rt prototype controls are deliberately not persisted.
-- The only database foreign key connects app-owned OPD tables and carries
-- clinic/branch/encounter identity.

CREATE TABLE IF NOT EXISTS "opd_intake" (
    "intake_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "examination_id" UUID NOT NULL,
    "urinary_status" VARCHAR(30) NOT NULL,
    "urinary_other_text" VARCHAR(500),
    "bowel_status" VARCHAR(30) NOT NULL,
    "bowel_other_text" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_intake_pkey" PRIMARY KEY ("intake_id"),
    CONSTRAINT "opd_intake_examination_identity_fkey" FOREIGN KEY
        ("examination_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_examination"(
            "examination_id",
            "clinic_id",
            "branch_id",
            "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_intake_urinary_status_check" CHECK (
        "urinary_status" IN (
            'NORMAL',
            'DYSURIA',
            'FREQUENCY',
            'RETENTION',
            'OTHER'
        )
    ),
    CONSTRAINT "opd_intake_bowel_status_check" CHECK (
        "bowel_status" IN (
            'NORMAL',
            'CONSTIPATION',
            'DIARRHEA',
            'NO_BOWEL_MOVEMENT',
            'OTHER'
        )
    ),
    CONSTRAINT "opd_intake_urinary_other_check" CHECK (
        (
            "urinary_status" = 'OTHER'
            AND "urinary_other_text" IS NOT NULL
            AND BTRIM("urinary_other_text") <> ''
        )
        OR (
            "urinary_status" <> 'OTHER'
            AND "urinary_other_text" IS NULL
        )
    ),
    CONSTRAINT "opd_intake_bowel_other_check" CHECK (
        (
            "bowel_status" = 'OTHER'
            AND "bowel_other_text" IS NOT NULL
            AND BTRIM("bowel_other_text") <> ''
        )
        OR (
            "bowel_status" <> 'OTHER'
            AND "bowel_other_text" IS NULL
        )
    ),
    CONSTRAINT "opd_intake_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_intake_identity_uq"
    ON "opd_intake"("intake_id", "clinic_id", "branch_id", "encounter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_intake_examination_uq"
    ON "opd_intake"(
        "examination_id",
        "clinic_id",
        "branch_id",
        "encounter_id"
    );
CREATE INDEX IF NOT EXISTS "opd_intake_encounter_idx"
    ON "opd_intake"(
        "clinic_id",
        "branch_id",
        "encounter_id",
        "examination_id"
    );

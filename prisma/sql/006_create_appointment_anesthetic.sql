-- Surgical migration: the "แปะยาชา" anaesthetic detail record. Creates ONLY the
-- new app-owned appointment_anesthetic table. String refs to HealthX rows
-- (appointment_id/clinic_id/branch_id) — no FK. Idempotent.

CREATE TABLE IF NOT EXISTS "appointment_anesthetic" (
    "anesthetic_id"    UUID          NOT NULL,
    "clinic_id"        VARCHAR(50)   NOT NULL,
    "branch_id"        VARCHAR(50)   NOT NULL,
    "appointment_id"   VARCHAR(50)   NOT NULL,
    "allergy_status"   VARCHAR(20)   NOT NULL,
    "allergy_notes"    VARCHAR(500),
    "nurse_ref"        VARCHAR(100)  NOT NULL,
    "room"             VARCHAR(50),
    "bed"              VARCHAR(50),
    "duration_minutes" INTEGER       NOT NULL,
    "notes"            TEXT,
    "started_at"       TIMESTAMP(6)  NOT NULL,
    "created_by"       VARCHAR(50),
    "updated_at"       TIMESTAMP(6)  NOT NULL,
    "created_at"       TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_anesthetic_pkey" PRIMARY KEY ("anesthetic_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_anesthetic_appointment_id_key"
    ON "appointment_anesthetic"("appointment_id");
CREATE INDEX IF NOT EXISTS "appointment_anesthetic_clinic_id_branch_id_idx"
    ON "appointment_anesthetic"("clinic_id", "branch_id");

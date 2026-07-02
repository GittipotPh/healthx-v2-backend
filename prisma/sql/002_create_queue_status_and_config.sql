-- Surgical migration for the Queue Kanban 9-step flow + Advanced settings.
-- Creates ONLY the new ref_queue_step_status / queue_status / queue_config
-- tables in the public schema, and seeds the known step catalog. Does NOT
-- touch any existing HealthX table (including the legacy statusAppointment
-- enum/column). Idempotent (IF NOT EXISTS guards + ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS "ref_queue_step_status" (
    "code" VARCHAR(30) NOT NULL,
    "label_th" VARCHAR(100) NOT NULL,
    "label_en" VARCHAR(100),
    "color" VARCHAR(20),
    "sort_order" INTEGER NOT NULL,
    "is_end_step" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ref_queue_step_status_pkey" PRIMARY KEY ("code")
);

INSERT INTO "ref_queue_step_status"
  ("code", "label_th", "color", "sort_order", "is_end_step", "updated_at")
VALUES
  ('CONFIRMED',        'คอนเฟิร์มนัด', '#E0E7FF', 1, false, CURRENT_TIMESTAMP),
  ('ARRIVED',          'มาถึงแล้ว',    '#DBEAFE', 2, false, CURRENT_TIMESTAMP),
  ('CONSULTING',       'กำลังปรึกษา',  '#E9D5FF', 3, false, CURRENT_TIMESTAMP),
  ('PENDING_PAYMENT',  'รอชำระเงิน',   '#FEF3C7', 4, false, CURRENT_TIMESTAMP),
  ('ANESTHETIC',       'แปะยาชา',      '#FFEDD5', 5, false, CURRENT_TIMESTAMP),
  ('IN_SERVICE',       'กำลังบริการ',  '#FCE7F3', 6, false, CURRENT_TIMESTAMP),
  ('DISPENSING',       'จ่ายยา',       '#DBEAFE', 7, false, CURRENT_TIMESTAMP),
  ('VERIFIED',         'ตรวจแล้ว',     '#D1FAE5', 8, false, CURRENT_TIMESTAMP),
  ('COMPLETED',        'กลับบ้านแล้ว', '#E5E7EB', 9, true,  CURRENT_TIMESTAMP),
  ('CANCELLED',        'ยกเลิก',       '#F3F4F6', 10, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "queue_status" (
    "queue_status_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "appointment_id" VARCHAR(50) NOT NULL,
    "current_step" VARCHAR(30) NOT NULL,
    "entered_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_status_pkey" PRIMARY KEY ("queue_status_id"),
    CONSTRAINT "queue_status_current_step_fkey" FOREIGN KEY ("current_step")
        REFERENCES "ref_queue_step_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "queue_status_appointment_id_key" ON "queue_status"("appointment_id");
CREATE INDEX IF NOT EXISTS "queue_status_clinic_id_branch_id_idx" ON "queue_status"("clinic_id", "branch_id");
CREATE INDEX IF NOT EXISTS "queue_status_branch_id_current_step_idx" ON "queue_status"("branch_id", "current_step");

CREATE TABLE IF NOT EXISTS "queue_config" (
    "queue_config_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "columns" JSONB NOT NULL,
    "sla" JSONB NOT NULL,
    "transitions" JSONB NOT NULL,
    "automation" JSONB NOT NULL,
    "tracking" JSONB NOT NULL,
    "notifications" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "updated_by" VARCHAR(50),
    "updated_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_config_pkey" PRIMARY KEY ("queue_config_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "queue_config_branch_id_key" ON "queue_config"("branch_id");
CREATE INDEX IF NOT EXISTS "queue_config_clinic_id_branch_id_idx" ON "queue_config"("clinic_id", "branch_id");

-- Extends the legacy "statusAppointment" enum with the granular Kanban queue
-- steps so appointment.status_appointment can be kept in exact sync
-- (best-effort) with queue_status.current_step. Additive only: existing
-- values (APPOINT, CONFIRM, IN_SERVICE, SUCCESS, CANCEL) and existing rows
-- are untouched. Each ALTER TYPE ... ADD VALUE is idempotent via IF NOT
-- EXISTS and safe to run standalone (not combined with a use of the new
-- value in the same transaction).

ALTER TYPE "statusAppointment" ADD VALUE IF NOT EXISTS 'ARRIVED';
ALTER TYPE "statusAppointment" ADD VALUE IF NOT EXISTS 'CONSULTING';
ALTER TYPE "statusAppointment" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "statusAppointment" ADD VALUE IF NOT EXISTS 'ANESTHETIC';
ALTER TYPE "statusAppointment" ADD VALUE IF NOT EXISTS 'DISPENSING';
ALTER TYPE "statusAppointment" ADD VALUE IF NOT EXISTS 'VERIFIED';

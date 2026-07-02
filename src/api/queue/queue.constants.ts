import { statusAppointment } from "@prisma/client";

/** The step a newly created appointment's queue card starts on. */
export const INITIAL_QUEUE_STEP = "CONFIRMED";

/**
 * 1:1 map from a `ref_queue_step_status.code` (queue_status.current_step) to
 * the legacy `statusAppointment` value it best-effort mirrors. Every step in
 * the seeded catalog (see prisma/sql/002_create_queue_status_and_config.sql)
 * has an entry here, which is why the enum was extended with the granular
 * in-progress steps instead of collapsing them into a coarser legacy bucket.
 */
export const STEP_TO_APPOINTMENT_STATUS: Record<string, statusAppointment> = {
  CONFIRMED: statusAppointment.CONFIRM,
  ARRIVED: statusAppointment.ARRIVED,
  CONSULTING: statusAppointment.CONSULTING,
  PENDING_PAYMENT: statusAppointment.PENDING_PAYMENT,
  ANESTHETIC: statusAppointment.ANESTHETIC,
  IN_SERVICE: statusAppointment.IN_SERVICE,
  DISPENSING: statusAppointment.DISPENSING,
  VERIFIED: statusAppointment.VERIFIED,
  COMPLETED: statusAppointment.SUCCESS,
  CANCELLED: statusAppointment.CANCEL,
};

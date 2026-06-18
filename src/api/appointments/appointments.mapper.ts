import type { appointment, customer, statusAppointment } from "@prisma/client";

export type AppointmentWithCustomer = appointment & { customer?: customer | null };

export interface AppointmentView {
  appointmentId: string;
  clinicId: string;
  branchId: string;
  customerId: string;
  customerName: string | null;
  room: string | null;
  channel: string | null;
  dateAppointment: string;
  timeArrive: string;
  startTime: string;
  endTime: string;
  isConsult: boolean;
  applyAnesthetic: boolean;
  detail: string | null;
  status: statusAppointment;
  opdId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toAppointmentView(row: AppointmentWithCustomer): AppointmentView {
  const customerName = row.customer
    ? `${row.customer.name} ${row.customer.lastname}`.trim()
    : null;

  return {
    appointmentId: row.appointment_id,
    clinicId: row.clinic_id,
    branchId: row.branch_id,
    customerId: row.customer_id,
    customerName,
    room: row.room,
    channel: row.channel,
    dateAppointment: row.date_appointment,
    timeArrive: row.time_arrive,
    startTime: row.start_time,
    endTime: row.end_time,
    isConsult: row.is_consult,
    applyAnesthetic: row.apply_anesthetic,
    detail: row.appointment_detail,
    status: row.status_appointment,
    opdId: row.opd_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

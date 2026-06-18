import type { customer, opd, opdStatus } from "@prisma/client";

export type OpdWithCustomer = opd & { customer?: customer | null };

export interface OpdView {
  opdId: string;
  branchId: string;
  clinicId: string;
  customerId: string;
  customerName: string | null;
  chiefComplaint: string | null;
  diagnosis: string | null;
  details: string | null;
  room: string | null;
  status: opdStatus;
  opdDate: string;
  createdAt: string;
  updatedAt: string;
}

function num(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

export function toOpdView(row: OpdWithCustomer): OpdView {
  const customerName = row.customer
    ? `${row.customer.name} ${row.customer.lastname}`.trim()
    : null;

  return {
    opdId: row.opd_id,
    branchId: row.branch_id,
    clinicId: row.clinic_id,
    customerId: row.customer_id,
    customerName,
    chiefComplaint: row.chief_complaint,
    diagnosis: row.diagnosis,
    details: row.details,
    room: row.room,
    status: row.status_opd,
    opdDate: row.opd_date.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface OpdVitals {
  bt: number | null;
  bp: number | null;
  pr: number | null;
  rr: number | null;
  bmi: number | null;
  weight: number | null;
  height: number | null;
}

export function toOpdVitals(row: opd): OpdVitals {
  return {
    bt: num(row.bt),
    bp: num(row.bp),
    pr: num(row.pr),
    rr: num(row.rr),
    bmi: num(row.bmi),
    weight: num(row.weight),
    height: num(row.height),
  };
}

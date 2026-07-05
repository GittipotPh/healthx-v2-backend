import { ApiProperty } from "@nestjs/swagger";
import { opdStatus, type customer, type opd } from "@prisma/client";

export type OpdWithCustomer = opd & { customer?: customer | null };

export class OpdView {
  @ApiProperty()
  opdId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  clinicId!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ type: String, nullable: true })
  customerName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  chiefComplaint!: string | null;

  @ApiProperty({ type: String, nullable: true })
  diagnosis!: string | null;

  @ApiProperty({ type: String, nullable: true })
  details!: string | null;

  @ApiProperty({ type: String, nullable: true })
  room!: string | null;

  @ApiProperty({ enum: opdStatus, enumName: "OpdStatus" })
  status!: opdStatus;

  @ApiProperty({ description: "ISO timestamp" })
  opdDate!: string;

  @ApiProperty({ description: "ISO timestamp" })
  createdAt!: string;

  @ApiProperty({ description: "ISO timestamp" })
  updatedAt!: string;
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

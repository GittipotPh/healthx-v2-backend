import { ApiProperty } from "@nestjs/swagger";
import {
  role_enum,
  statusAppointment,
  type_branch,
  type appointment,
  type customer,
} from "@prisma/client";

export type AppointmentWithCustomer = appointment & { customer?: customer | null };

export class AppointmentView {
  @ApiProperty()
  appointmentId!: string;

  @ApiProperty()
  clinicId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ type: String, nullable: true })
  customerName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  room!: string | null;

  @ApiProperty({ type: String, nullable: true })
  channel!: string | null;

  @ApiProperty({ description: "YYYY-MM-DD" })
  dateAppointment!: string;

  @ApiProperty({ description: "HH:mm" })
  timeArrive!: string;

  @ApiProperty({ description: "HH:mm" })
  startTime!: string;

  @ApiProperty({ description: "HH:mm" })
  endTime!: string;

  @ApiProperty()
  isConsult!: boolean;

  @ApiProperty()
  applyAnesthetic!: boolean;

  @ApiProperty({ type: String, nullable: true })
  detail!: string | null;

  @ApiProperty({ enum: statusAppointment, enumName: "StatusAppointment" })
  status!: statusAppointment;

  @ApiProperty({ type: String, nullable: true })
  opdId!: string | null;

  @ApiProperty({ description: "ISO timestamp" })
  createdAt!: string;

  @ApiProperty({ description: "ISO timestamp" })
  updatedAt!: string;
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

export class AppointmentOption {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;
}

export class BranchOption extends AppointmentOption {
  @ApiProperty({ enum: type_branch, enumName: "TypeBranch" })
  typeBranch!: type_branch;
}

export class BranchScopedOption extends AppointmentOption {
  @ApiProperty()
  branchId!: string;
}

export class StaffOption extends BranchScopedOption {
  @ApiProperty({ enum: role_enum, enumName: "RoleEnum" })
  role!: role_enum;
}

export class AppointmentOptionsView {
  @ApiProperty({ type: [BranchOption] })
  branches!: BranchOption[];

  @ApiProperty({ type: [BranchScopedOption] })
  rooms!: BranchScopedOption[];

  @ApiProperty({ type: [BranchScopedOption] })
  procedures!: BranchScopedOption[];

  @ApiProperty({ type: [StaffOption] })
  doctors!: StaffOption[];

  @ApiProperty({ type: [StaffOption] })
  assistants!: StaffOption[];

  @ApiProperty({ type: [AppointmentOption] })
  consultTypes!: AppointmentOption[];

  @ApiProperty({ type: [AppointmentOption] })
  marketingPlatforms!: AppointmentOption[];

  @ApiProperty({ type: [AppointmentOption] })
  marketingCampaigns!: AppointmentOption[];

  @ApiProperty({ type: [AppointmentOption] })
  preparationTags!: AppointmentOption[];

  @ApiProperty({ type: [AppointmentOption] })
  internalTags!: AppointmentOption[];

  @ApiProperty({ type: [Number] })
  numbingDurations!: number[];
}

/** Generic page shape used internally; the documented wire models are the concrete pages below. */
export interface AppointmentOptionPage<TOption extends AppointmentOption = AppointmentOption> {
  items: TOption[];
  total: number;
  page: number;
  pageSize: number;
}

export class BranchScopedOptionPage implements AppointmentOptionPage<BranchScopedOption> {
  @ApiProperty({ type: [BranchScopedOption] })
  items!: BranchScopedOption[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class StaffOptionPage implements AppointmentOptionPage<StaffOption> {
  @ApiProperty({ type: [StaffOption] })
  items!: StaffOption[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

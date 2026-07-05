import { ApiProperty } from "@nestjs/swagger";
import type { customer } from "@prisma/client";

export class CustomerView {
  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  clinicId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  lastname!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty()
  gender!: string;

  @ApiProperty({ type: String, nullable: true })
  birthDate!: string | null;

  @ApiProperty({ description: "Customer HN" })
  personalId!: string;

  @ApiProperty({ type: String, nullable: true })
  phoneNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lineId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  customerImage!: string | null;

  @ApiProperty()
  isVip!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: String, nullable: true })
  customerGroup!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "ISO timestamp" })
  createdAt!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "ISO timestamp" })
  updatedAt!: string | null;
}

export function toCustomerView(row: customer): CustomerView {
  return {
    customerId: row.customer_id,
    clinicId: row.clinic_id,
    branchId: row.branch_id,
    title: row.title,
    name: row.name,
    lastname: row.lastname,
    fullName: `${row.name} ${row.lastname}`.trim(),
    nickname: row.nickname,
    gender: row.gender,
    birthDate: row.birth_date,
    personalId: row.personal_id,
    phoneNumber: row.phone_number,
    email: row.email,
    lineId: row.line_id,
    customerImage: row.customer_image,
    isVip: row.status_vip,
    isActive: row.customer_status,
    customerGroup: row.customer_group,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

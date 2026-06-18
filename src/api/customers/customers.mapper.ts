import type { customer } from "@prisma/client";

export interface CustomerView {
  customerId: string;
  clinicId: string;
  branchId: string;
  title: string;
  name: string;
  lastname: string;
  fullName: string;
  nickname: string | null;
  gender: string;
  birthDate: string | null;
  personalId: string;
  phoneNumber: string | null;
  email: string | null;
  lineId: string | null;
  customerImage: string | null;
  isVip: boolean;
  isActive: boolean;
  customerGroup: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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

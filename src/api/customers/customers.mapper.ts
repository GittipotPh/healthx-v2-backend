import { ApiProperty } from "@nestjs/swagger";
import { document_status, record_status, sale_order_status, usage_log_status, type customer } from "@prisma/client";
import { decimalToNumber } from "../../common/decimal";

export type CustomerWithCardRelations = customer & {
  attendant_detail?: { name: string | null; lastname: string | null; nickname: string | null } | null;
  customer_attendant?: {
    user: { name: string | null; lastname: string | null; nickname: string | null };
  }[];
  documents_signed_customer?: { status: document_status }[];
  customer_coures?: {
    item_id: string;
    amount: unknown;
    expire_date: Date;
    course_item: { name: string };
  }[];
  customer_course_usage_log?: {
    item_id: string;
    expire_date: Date;
    amount: unknown;
    status: usage_log_status;
  }[];
  customer_wallet?: {
    amount: unknown;
    bonus: unknown;
    status: record_status;
  }[];
  wallet_log?: {
    in: unknown;
    out: unknown;
  }[];
  sale_order?: {
    totalDue: unknown;
    sale_order_status: sale_order_status;
    status: record_status;
  }[];
};

export class CustomerConsentSummary {
  @ApiProperty()
  signed!: number;

  @ApiProperty()
  total!: number;
}

export class CustomerCourseSummary {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  used!: number;

  @ApiProperty()
  total!: number;
}

export class CustomerCardSummary {
  @ApiProperty()
  outstanding!: number;

  @ApiProperty()
  deposit!: number;

  @ApiProperty({ type: String, nullable: true })
  attendant!: string | null;

  @ApiProperty({ type: CustomerConsentSummary, nullable: true })
  consent!: CustomerConsentSummary | null;

  @ApiProperty({ type: [CustomerCourseSummary] })
  courses!: CustomerCourseSummary[];

  @ApiProperty({ type: Number, nullable: true })
  credit!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  points!: number | null;
}

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

  @ApiProperty({ type: CustomerCardSummary, nullable: true })
  card!: CustomerCardSummary | null;
}

export class CustomerOption {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;
}

export class CustomerGroupOption extends CustomerOption {
  @ApiProperty({ type: String, nullable: true })
  color!: string | null;
}

export class CustomerAttendantOption extends CustomerOption {
  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;
}

export class CustomerOptionsView {
  @ApiProperty({ type: [CustomerGroupOption] })
  groups!: CustomerGroupOption[];

  @ApiProperty({ type: [CustomerAttendantOption] })
  attendants!: CustomerAttendantOption[];
}

function attendantName(row: CustomerWithCardRelations): string | null {
  const attendant = row.attendant_detail ?? row.customer_attendant?.[0]?.user ?? null;
  if (!attendant) return null;
  return `${attendant.name ?? ""} ${attendant.lastname ?? ""}`.trim() || attendant.nickname;
}

function consentSummary(row: CustomerWithCardRelations): CustomerConsentSummary | null {
  const docs = row.documents_signed_customer ?? [];
  if (docs.length === 0) return null;
  return {
    signed: docs.filter((doc) => doc.status === document_status.SIGNED).length,
    total: docs.length,
  };
}

function courseSummary(row: CustomerWithCardRelations): CustomerCourseSummary[] {
  const usageByKey = new Map<string, number>();
  for (const usage of row.customer_course_usage_log ?? []) {
    if (![usage_log_status.RESERVED, usage_log_status.USED].includes(usage.status)) continue;
    const key = `${usage.item_id}|${usage.expire_date.toISOString()}`;
    usageByKey.set(key, (usageByKey.get(key) ?? 0) + decimalToNumber(usage.amount));
  }

  return (row.customer_coures ?? [])
    .map((course) => {
      const total = decimalToNumber(course.amount);
      const used = usageByKey.get(`${course.item_id}|${course.expire_date.toISOString()}`) ?? 0;
      return {
        name: course.course_item.name,
        used,
        total,
      };
    })
    .filter((course) => course.total > 0);
}

function cardSummary(row: CustomerWithCardRelations): CustomerCardSummary | null {
  if (
    row.customer_wallet === undefined &&
    row.wallet_log === undefined &&
    row.sale_order === undefined &&
    row.documents_signed_customer === undefined &&
    row.customer_coures === undefined &&
    row.customer_course_usage_log === undefined &&
    row.customer_attendant === undefined &&
    row.attendant_detail === undefined
  ) {
    return null;
  }

  const outstanding = (row.sale_order ?? [])
    .filter((order) => order.status === record_status.ACTIVE)
    .filter((order) =>
      order.sale_order_status === sale_order_status.PENDING ||
      order.sale_order_status === sale_order_status.PARTAIL,
    )
    .reduce((sum, order) => sum + decimalToNumber(order.totalDue), 0);

  const deposit = (row.customer_wallet ?? [])
    .filter((wallet) => wallet.status === record_status.ACTIVE)
    .reduce((sum, wallet) => sum + decimalToNumber(wallet.amount) + decimalToNumber(wallet.bonus), 0);

  const credit = (row.wallet_log ?? []).reduce(
    (sum, log) => sum + decimalToNumber(log.in) - decimalToNumber(log.out),
    0,
  );

  const oldPoints = decimalToNumber(row.point_accumulate_all_old);
  const currentPoints = decimalToNumber(row.point_current_year);
  const points = oldPoints + currentPoints;

  return {
    outstanding,
    deposit,
    attendant: attendantName(row),
    consent: consentSummary(row),
    courses: courseSummary(row),
    credit: row.wallet_log === undefined ? null : credit,
    points: row.point_accumulate_all_old == null && row.point_current_year == null ? null : points,
  };
}

export function toCustomerView(row: CustomerWithCardRelations): CustomerView {
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
    card: cardSummary(row),
  };
}

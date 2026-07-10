import { ApiProperty } from "@nestjs/swagger";
import {
  document_status,
  record_status,
  sale_order_status,
  usage_log_status,
  type customer_file,
  type customer_info,
  type customer_note,
} from "@prisma/client";
import {
  CustomerView,
  type CustomerWithCardRelations,
  toCustomerView,
} from "./customers.mapper";
import { decimalToNumber } from "../../common/decimal";

// Appointment date/time columns store Bangkok wall-clock strings; anchor them to
// the clinic offset so "upcoming" checks don't drift when the server runs in UTC.
const CLINIC_UTC_OFFSET = "+07:00";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function userName(user: UserName | null | undefined): string | null {
  if (!user) return null;
  return `${user.name ?? ""} ${user.lastname ?? ""}`.trim() || user.nickname || null;
}

function combineAddress(row: CustomerProfileRow): string | null {
  const parts = [
    row.address,
    row.sub_district,
    row.district,
    row.province,
    row.postcode,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function dateTimeOf(date: string | null | undefined, time?: string | null): Date | null {
  if (!date) return null;
  const parsed = new Date(`${date}T${time || "00:00"}:00${CLINIC_UTC_OFFSET}`);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const fallback = new Date(date);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function dateLabel(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function timeLabel(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(11, 16) : null;
}

interface UserName {
  name: string | null;
  lastname: string | null;
  nickname: string | null;
}

export type CustomerNoteWithUser = customer_note & {
  created_by_user?: UserName | null;
  updated_by_user?: UserName | null;
};

export type CustomerFileWithUser = customer_file & {
  uploaded_by_user?: UserName | null;
};

interface CustomerProfileDocument {
  doc_id: string;
  document_url: string | null;
  status: document_status;
  exp: Date | null;
  created_at: Date | null;
  documents_signed?: {
    document_name: string;
    purpose_use: string;
    document_type: string;
    document_url: string | null;
  } | null;
}

interface CustomerProfileAppointment {
  appointment_id: string;
  branch_id: string;
  date_appointment: string;
  start_time: string;
  end_time: string;
  appointment_detail: string | null;
  status_appointment: string;
  created_at: Date;
  branch?: { branch_name: string } | null;
  user_appointment?: { user?: UserName | null }[];
  operation_appointment?: { operation_item?: { title: string } | null }[];
}

interface CustomerProfileOpd {
  opd_id: string;
  branch_id: string;
  diagnosis: string | null;
  details: string | null;
  chief_complaint: string | null;
  management: string | null;
  status_opd: string;
  opd_date: Date;
  created_at: Date;
  user?: UserName | null;
}

interface CustomerProfileReceipt {
  receipt_id: string;
  paid_amount: unknown;
  wallet_amount: unknown;
  status: record_status | null;
  date: Date | null;
  created_at: Date | null;
  clinic_payment_method?: {
    name: string | null;
    payment_type: string;
  } | null;
}

interface CustomerProfileSaleOrder {
  sale_order_id: string;
  branch_id: string;
  total: unknown;
  totalDue: unknown;
  sale_order_status: sale_order_status;
  status: record_status;
  date: Date | null;
  created_at: Date | null;
  receipt?: CustomerProfileReceipt[];
  sale_order_item?: {
    item_name: string;
    quantity: unknown;
    total: unknown;
  }[];
  seller?: UserName | null;
}

interface CustomerProfileWalletLog {
  wallet_log_id?: string;
  in: unknown;
  out: unknown;
  type?: string;
  created_at?: Date;
}

interface CustomerProfileWallet {
  trans_id?: string;
  amount: unknown;
  bonus: unknown;
  status: record_status;
  created_at?: Date;
  payment_method?: { name: string | null } | null;
  cashier_detail?: UserName | null;
}

interface CustomerProfileCourse {
  item_id: string;
  amount: unknown;
  expire_date: Date;
  created_at?: Date | null;
  course_item: { name: string };
}

interface CustomerProfileCourseUsage {
  id?: string;
  item_id: string;
  expire_date: Date;
  amount: unknown;
  status: usage_log_status;
  created_at?: Date | null;
  course_item?: { name: string };
}

export type CustomerProfileRow = Omit<
  CustomerWithCardRelations,
  | "customer_coures"
  | "customer_course_usage_log"
  | "customer_wallet"
  | "documents_signed_customer"
  | "sale_order"
  | "wallet_log"
> & {
  customer_info?: customer_info | null;
  customer_group_info?: {
    group_name: string;
    color_group: string | null;
  } | null;
  appointment?: CustomerProfileAppointment[];
  opd?: CustomerProfileOpd[];
  customer_note?: CustomerNoteWithUser[];
  customer_file?: CustomerFileWithUser[];
  documents_signed_customer?: CustomerProfileDocument[];
  sale_order?: CustomerProfileSaleOrder[];
  wallet_log?: CustomerProfileWalletLog[];
  customer_wallet?: CustomerProfileWallet[];
  customer_coures?: CustomerProfileCourse[];
  customer_course_usage_log?: CustomerProfileCourseUsage[];
};

export class CustomerPersonalInfo {
  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true })
  occupation!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nationality!: string | null;

  @ApiProperty({ type: String, nullable: true })
  maritalStatus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  referralSource!: string | null;
}

export class CustomerHealthInfo {
  @ApiProperty({ type: String, nullable: true })
  allergy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  congenitalDisease!: string | null;

  @ApiProperty({ type: String, nullable: true })
  surgery!: string | null;

  @ApiProperty({ type: String, nullable: true })
  otherImportant!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  weight!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ type: String, nullable: true })
  bmi!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bp!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  pr!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rr!: string | null;

  @ApiProperty({ type: Object, nullable: true })
  emergencyContact!: { name: string; phone: string; relation: string } | null;
}

export class CustomerFinancialSummary {
  @ApiProperty()
  wallet!: number;

  @ApiProperty()
  deposit!: number;

  @ApiProperty()
  outstanding!: number;

  @ApiProperty({ type: Number, nullable: true })
  credit!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  points!: number | null;

  @ApiProperty()
  totalSpend!: number;

  @ApiProperty()
  averageSpend!: number;
}

export class CustomerCourseDetail {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  used!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  remaining!: number;

  @ApiProperty({ type: String, nullable: true })
  expireDate!: string | null;
}

export class CustomerAlert {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  severity!: "info" | "warning" | "danger";
}

export class CustomerRecommendedAction {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  reason!: string;
}

export class CustomerTimelineItem {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true })
  occurredAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  actorName!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  amount!: number | null;

  @ApiProperty({ type: String, nullable: true })
  status!: string | null;
}

export class CustomerAppointmentSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  date!: string;

  @ApiProperty()
  time!: string;

  @ApiProperty({ type: String, nullable: true })
  branch!: string | null;

  @ApiProperty()
  service!: string;

  @ApiProperty({ type: String, nullable: true })
  doctor!: string | null;

  @ApiProperty()
  status!: string;
}

export class CustomerPaymentSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  date!: string | null;

  @ApiProperty()
  invoice!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty({ type: String, nullable: true })
  method!: string | null;

  @ApiProperty({ type: String, nullable: true })
  status!: string | null;
}

export class CustomerDocumentSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ type: String, nullable: true })
  date!: string | null;

  @ApiProperty({ type: String, nullable: true })
  url!: string | null;

  @ApiProperty()
  source!: "signed_document" | "customer_file";
}

export class CustomerNoteView {
  @ApiProperty()
  noteId!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: String, nullable: true })
  createdByName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CustomerFileView {
  @ApiProperty()
  fileId!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  originalName!: string;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty()
  storageProvider!: string;

  @ApiProperty()
  bucketName!: string;

  @ApiProperty()
  objectKey!: string;

  @ApiProperty({ type: String, nullable: true })
  readUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  uploadedByName!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class CustomerFinancialsView {
  @ApiProperty({ type: CustomerFinancialSummary })
  summary!: CustomerFinancialSummary;

  @ApiProperty({ type: [CustomerPaymentSummary] })
  payments!: CustomerPaymentSummary[];
}

export class CustomerProfileView {
  @ApiProperty({ type: CustomerView })
  customer!: CustomerView;

  @ApiProperty({ type: CustomerPersonalInfo })
  personal!: CustomerPersonalInfo;

  @ApiProperty({ type: CustomerHealthInfo })
  health!: CustomerHealthInfo;

  @ApiProperty({ type: CustomerFinancialSummary })
  financial!: CustomerFinancialSummary;

  @ApiProperty({ type: [CustomerCourseDetail] })
  courses!: CustomerCourseDetail[];

  @ApiProperty({ type: [CustomerAlert] })
  alerts!: CustomerAlert[];

  @ApiProperty({ type: [CustomerRecommendedAction] })
  recommendedActions!: CustomerRecommendedAction[];

  @ApiProperty({ type: [CustomerTimelineItem] })
  recentTimeline!: CustomerTimelineItem[];

  @ApiProperty({ type: [CustomerAppointmentSummary] })
  upcomingAppointments!: CustomerAppointmentSummary[];

  @ApiProperty({ type: [CustomerDocumentSummary] })
  recentDocuments!: CustomerDocumentSummary[];

  @ApiProperty({ type: [CustomerNoteView] })
  recentNotes!: CustomerNoteView[];
}

export function toCustomerNoteView(row: CustomerNoteWithUser): CustomerNoteView {
  return {
    noteId: row.note_id,
    customerId: row.customer_id,
    content: row.content,
    createdByName: userName(row.created_by_user),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toCustomerFileView(
  row: CustomerFileWithUser,
  readUrl: string | null = row.public_url,
): CustomerFileView {
  return {
    fileId: row.file_id,
    customerId: row.customer_id,
    displayName: row.display_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storageProvider: row.storage_provider,
    bucketName: row.bucket_name,
    objectKey: row.object_key,
    readUrl,
    uploadedByName: userName(row.uploaded_by_user),
    createdAt: row.created_at.toISOString(),
  };
}

export function toCustomerProfileView(row: CustomerProfileRow): CustomerProfileView {
  const appointments = toAppointmentSummaries(row);
  const timeline = toTimelineItems(row);
  const financial = toFinancialSummary(row);
  const alerts = toAlerts(row);

  return {
    customer: toCustomerView(row as CustomerWithCardRelations),
    personal: toPersonalInfo(row),
    health: toHealthInfo(row.customer_info ?? null),
    financial,
    courses: toCourseDetails(row),
    alerts,
    recommendedActions: toRecommendedActions(alerts),
    recentTimeline: timeline.slice(0, 10),
    upcomingAppointments: appointments.slice(0, 5),
    recentDocuments: toDocumentSummaries(row).slice(0, 10),
    recentNotes: (row.customer_note ?? []).slice(0, 5).map(toCustomerNoteView),
  };
}

export function toPersonalInfo(row: CustomerProfileRow): CustomerPersonalInfo {
  const info = row.customer_info ?? null;
  return {
    address: combineAddress(row),
    occupation: info?.career ?? null,
    nationality: row.nationality ?? null,
    maritalStatus: row.status_marry ?? null,
    referralSource: info?.chanel ?? info?.know_method ?? null,
  };
}

export function toHealthInfo(info: customer_info | null): CustomerHealthInfo {
  return {
    allergy: info?.allergy ?? null,
    congenitalDisease: info?.congenital_disease ?? null,
    surgery: info?.surgery ?? null,
    otherImportant: info?.other_important ?? null,
    weight: info?.weight == null ? null : decimalToNumber(info.weight),
    height: info?.height == null ? null : decimalToNumber(info.height),
    bmi: info?.bmi ?? null,
    bp: info?.bp ?? null,
    bt: info?.bt ?? null,
    pr: info?.pr ?? null,
    rr: info?.rr ?? null,
    emergencyContact:
      info?.emergency_contact_name || info?.emergency_contact_phone
        ? {
            name: info.emergency_contact_name ?? "",
            phone: info.emergency_contact_phone ?? "",
            relation: info.emergency_contact_relation ?? "",
          }
        : null,
  };
}

export function toFinancialSummary(row: CustomerProfileRow): CustomerFinancialSummary {
  const card = toCustomerView(row as CustomerWithCardRelations).card;
  const activeOrders = (row.sale_order ?? []).filter(
    (order) => order.status === record_status.ACTIVE,
  );
  const totalSpend = activeOrders.reduce(
    (sum, order) => sum + decimalToNumber(order.total),
    0,
  );
  const paidOrderCount = activeOrders.filter(
    (order) => order.sale_order_status === sale_order_status.PAID,
  ).length;

  return {
    wallet: card?.deposit ?? 0,
    deposit: card?.deposit ?? 0,
    outstanding: card?.outstanding ?? 0,
    credit: card?.credit ?? null,
    points: card?.points ?? null,
    totalSpend,
    averageSpend: paidOrderCount > 0 ? totalSpend / paidOrderCount : 0,
  };
}

export function toCourseDetails(row: CustomerProfileRow): CustomerCourseDetail[] {
  const usageByKey = new Map<string, number>();
  for (const usage of row.customer_course_usage_log ?? []) {
    if (![usage_log_status.RESERVED, usage_log_status.USED].includes(usage.status)) continue;
    const key = `${usage.item_id}|${usage.expire_date.toISOString()}`;
    usageByKey.set(key, (usageByKey.get(key) ?? 0) + decimalToNumber(usage.amount));
  }

  return (row.customer_coures ?? []).map((course) => {
    const total = decimalToNumber(course.amount);
    const key = `${course.item_id}|${course.expire_date?.toISOString() ?? ""}`;
    const used = usageByKey.get(key) ?? 0;
    return {
      name: course.course_item?.name ?? "Course",
      used,
      total,
      remaining: Math.max(total - used, 0),
      expireDate: iso(course.expire_date),
    };
  });
}

export function toAlerts(row: CustomerProfileRow): CustomerAlert[] {
  const alerts: CustomerAlert[] = [];
  const info = row.customer_info ?? null;
  const card = toCustomerView(row as CustomerWithCardRelations).card;

  if (info?.allergy) {
    alerts.push({
      type: "allergy",
      message: info.allergy,
      severity: "danger",
    });
  }

  if (info?.congenital_disease) {
    alerts.push({
      type: "congenital_disease",
      message: info.congenital_disease,
      severity: "warning",
    });
  }

  if ((card?.outstanding ?? 0) > 0) {
    alerts.push({
      type: "outstanding_balance",
      message: `Outstanding balance ${card?.outstanding ?? 0}`,
      severity: "warning",
    });
  }

  const consent = card?.consent;
  if (consent && consent.signed < consent.total) {
    alerts.push({
      type: "unsigned_document",
      message: `${consent.total - consent.signed} consent document(s) still unsigned`,
      severity: "info",
    });
  }

  return alerts;
}

export function toRecommendedActions(alerts: CustomerAlert[]): CustomerRecommendedAction[] {
  return alerts.map((alert, index) => ({
    id: `${alert.type}-${index}`,
    label:
      alert.type === "allergy"
        ? "Review allergy before treatment"
        : alert.type === "outstanding_balance"
          ? "Review outstanding balance"
          : alert.type === "unsigned_document"
            ? "Collect missing consent"
            : "Review customer profile",
    reason: alert.message,
  }));
}

export function toTimelineItems(row: CustomerProfileRow): CustomerTimelineItem[] {
  const items: CustomerTimelineItem[] = [];

  for (const opd of row.opd ?? []) {
    items.push({
      id: `opd-${opd.opd_id}`,
      type: "treatment",
      title: opd.chief_complaint ?? opd.diagnosis ?? "Treatment visit",
      description: opd.details ?? opd.management ?? null,
      occurredAt: opd.opd_date.toISOString(),
      actorName: userName(opd.user),
      amount: null,
      status: opd.status_opd,
    });
  }

  for (const usage of row.customer_course_usage_log ?? []) {
    items.push({
      id: `course-use-${usage.id ?? `${usage.item_id}-${usage.expire_date.toISOString()}`}`,
      type: "course_use",
      title: usage.course_item?.name ?? "Course usage",
      description: `${decimalToNumber(usage.amount)} used`,
      occurredAt: iso(usage.created_at) ?? usage.expire_date.toISOString(),
      actorName: null,
      amount: decimalToNumber(usage.amount),
      status: usage.status,
    });
  }

  for (const course of row.customer_coures ?? []) {
    items.push({
      id: `course-purchase-${course.item_id}-${course.expire_date?.toISOString() ?? ""}`,
      type: "course_purchase",
      title: course.course_item?.name ?? "Course purchase",
      description: `${decimalToNumber(course.amount)} purchased`,
      occurredAt: iso(course.created_at),
      actorName: null,
      amount: decimalToNumber(course.amount),
      status: null,
    });
  }

  for (const wallet of row.wallet_log ?? []) {
    items.push({
      id: `wallet-${wallet.wallet_log_id ?? `${wallet.created_at?.getTime() ?? items.length}`}`,
      type: "wallet",
      title: decimalToNumber(wallet.in) >= decimalToNumber(wallet.out) ? "Wallet credit" : "Wallet debit",
      description: wallet.type ?? null,
      occurredAt: iso(wallet.created_at),
      actorName: null,
      amount: decimalToNumber(wallet.in) - decimalToNumber(wallet.out),
      status: null,
    });
  }

  for (const doc of toDocumentSummaries(row)) {
    items.push({
      id: `document-${doc.id}`,
      type: "document",
      title: doc.name,
      description: doc.type,
      occurredAt: doc.date,
      actorName: null,
      amount: null,
      status: null,
    });
  }

  for (const note of row.customer_note ?? []) {
    items.push({
      id: `note-${note.note_id}`,
      type: "note",
      title: "Customer note",
      description: note.content,
      occurredAt: note.created_at.toISOString(),
      actorName: userName(note.created_by_user),
      amount: null,
      status: note.status,
    });
  }

  return items.sort((a, b) => {
    const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return bTime - aTime;
  });
}

export function toAppointmentSummaries(row: CustomerProfileRow): CustomerAppointmentSummary[] {
  const now = new Date();

  return (row.appointment ?? [])
    .filter((appointment) => {
      const value = dateTimeOf(appointment.date_appointment, appointment.start_time);
      return value === null || value >= now;
    })
    .map((appointment) => ({
      id: appointment.appointment_id,
      date: appointment.date_appointment,
      time: `${appointment.start_time}-${appointment.end_time}`,
      branch: appointment.branch?.branch_name ?? appointment.branch_id,
      service:
        appointment.operation_appointment
          ?.map((item) => item.operation_item?.title)
          .filter(Boolean)
          .join(", ") ||
        appointment.appointment_detail ||
        "Appointment",
      doctor:
        appointment.user_appointment
          ?.map((item) => userName(item.user))
          .filter(Boolean)
          .join(", ") || null,
      status: appointment.status_appointment,
    }));
}

export function toFinancialsView(row: CustomerProfileRow): CustomerFinancialsView {
  const payments = (row.sale_order ?? []).flatMap((order) =>
    (order.receipt ?? []).map((receipt) => ({
      id: receipt.receipt_id,
      date: iso(receipt.date) ?? iso(receipt.created_at),
      invoice: order.sale_order_id,
      amount: decimalToNumber(receipt.paid_amount) + decimalToNumber(receipt.wallet_amount),
      method: receipt.clinic_payment_method?.name ?? receipt.clinic_payment_method?.payment_type ?? null,
      status: receipt.status,
    })),
  );

  return {
    summary: toFinancialSummary(row),
    payments,
  };
}

export function toDocumentSummaries(row: CustomerProfileRow): CustomerDocumentSummary[] {
  const signedDocs = (row.documents_signed_customer ?? []).map((doc) => ({
    id: doc.doc_id,
    name: doc.documents_signed?.document_name ?? "Signed document",
    type: doc.documents_signed?.purpose_use ?? doc.status,
    date: iso(doc.created_at),
    url: doc.document_url ?? doc.documents_signed?.document_url ?? null,
    source: "signed_document" as const,
  }));

  const files = (row.customer_file ?? []).map((file) => ({
    id: file.file_id,
    name: file.display_name,
    type: file.mime_type,
    date: file.created_at.toISOString(),
    url: file.public_url,
    source: "customer_file" as const,
  }));

  return [...signedDocs, ...files].sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return bTime - aTime;
  });
}

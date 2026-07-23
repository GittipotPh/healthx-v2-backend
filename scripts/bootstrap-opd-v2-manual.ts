import {
  Prisma,
  PrismaClient,
  all_product_category,
  amount_unit,
  document_key,
  format_type,
  operator_type,
  product_category,
  product_type,
  receive_order_status,
  record_status,
  sale_order_status,
  statusAppointment,
  vat_type,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type JsonObject = Record<string, unknown>;

interface RequestOptions {
  method?: "GET" | "PATCH" | "POST";
  body?: JsonObject;
  idempotencyKey?: string;
}

interface ScenarioResult {
  appointmentId: string;
  encounterId: string;
  workflowStatus: string;
  clinicalRecordStatus: string;
}

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/healthx_optionb_test?schema=public";
const API_BASE_URL =
  process.env.OPD_MANUAL_API_BASE_URL ?? "http://127.0.0.1:8080/api/v1";
const LOGIN_EMAIL =
  process.env.OPD_MANUAL_LOGIN_EMAIL ?? "admin.test@healthx.local";
const LOGIN_PASSWORD = process.env.OPD_MANUAL_LOGIN_PASSWORD ?? "Admin@1234";
const APPLY = process.argv.includes("--apply");

const CLINIC_ID = "CLINIC-UAT";
const BRANCH_ID = "BR-UAT-SRC";
const ADMIN_USER_ID = "UAT-ADMIN-USER";
const DOCTOR_USER_ID = "UAT-DOCTOR-USER";
const CUSTOMER_ID = "CUST-OPD-MANUAL-01";

const MEDICINE_CATEGORY_ID = "CAT-OPD-MANUAL-MED";
const MEDICINE_SUBCATEGORY_ID = "SUBCAT-OPD-MANUAL-MED";
const MEDICINE_PRODUCT_ID = "PROD-OPD-MANUAL-MED";
const MEDICINE_LOT_ID = "LOT-OPD-MANUAL-2030";
const RECEIVE_ORDER_ID = "RO-OPD-MANUAL-MED";

const COURSE_CATEGORY_ID = "CAT-OPD-MANUAL-COURSE";
const COURSE_SUBCATEGORY_ID = "SUBCAT-OPD-MANUAL-COURSE";
const COURSE_ID = "COURSE-OPD-MANUAL-SKIN";
const COURSE_ITEM_ID = "COURSE-ITEM-OPD-MANUAL-SKIN";
const COURSE_SALE_ORDER_ID = "SO-OPD-MANUAL-COURSE";
const COURSE_EXPIRES_AT = new Date("2030-12-31T16:59:59.000Z");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function progress(message: string): void {
  process.stderr.write(`[opd-manual] ${message}\n`);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function asObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function objectField(object: JsonObject, key: string, label = key): JsonObject {
  return asObject(object[key], label);
}

function nullableObjectField(
  object: JsonObject,
  key: string,
  label = key,
): JsonObject | null {
  const value = object[key];
  return value === null || value === undefined ? null : asObject(value, label);
}

function stringField(object: JsonObject, key: string, label = key): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function nullableStringField(
  object: JsonObject,
  key: string,
  label = key,
): string | null {
  const value = object[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function numberField(object: JsonObject, key: string, label = key): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function booleanField(object: JsonObject, key: string, label = key): boolean {
  const value = object[key];
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function objectArrayField(
  object: JsonObject,
  key: string,
  label = key,
): JsonObject[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => asObject(item, `${label}[${index}]`));
}

function assertLocalDatabase(): void {
  const parsed = new URL(DATABASE_URL);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (
    !localHosts.has(parsed.hostname) ||
    databaseName !== "healthx_optionb_test"
  ) {
    throw new Error(
      `Refusing OPD manual bootstrap for non-local target ${parsed.hostname}/${databaseName}`,
    );
  }
}

function bangkokBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) {
    throw new Error("Unable to derive the Bangkok business date");
  }
  return `${year}-${month}-${day}`;
}

function compactBusinessDate(businessDate: string): string {
  return businessDate.replaceAll("-", "");
}

function richText(text: string): JsonObject {
  return {
    schema: "clinical-rich-text-v1",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

class ApiClient {
  private cookie = "";

  async login(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/authentication/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        `Login failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }
    const cookieHeaders = response.headers.getSetCookie();
    this.cookie = cookieHeaders
      .map((header) => header.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
    if (!this.cookie) {
      throw new Error("Login succeeded without an authentication cookie");
    }
  }

  async request(
    path: string,
    options: RequestOptions = {},
  ): Promise<JsonObject> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      cookie: this.cookie,
      origin: "http://localhost:3000",
      "x-clinic-id": CLINIC_ID,
      "x-branch-id": BRANCH_ID,
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (options.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        `${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }
    const envelope = asObject(payload, `${method} ${path} response`);
    if (envelope.status !== "0000") {
      throw new Error(
        `${method} ${path} returned an unexpected envelope: ${JSON.stringify(payload)}`,
      );
    }
    return objectField(envelope, "data", `${method} ${path} data`);
  }
}

async function assertPrerequisites(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const clinic = await tx.clinic.findUnique({
    where: { clinic_id: CLINIC_ID },
  });
  const branch = await tx.branch.findUnique({
    where: { branch_id: BRANCH_ID },
  });
  const admin = await tx.user.findUnique({
    where: { user_id: ADMIN_USER_ID },
  });
  const doctor = await tx.user.findUnique({
    where: { user_id: DOCTOR_USER_ID },
  });
  const doctorBranch = await tx.user_branch.findUnique({
    where: {
      user_id_branch_id: {
        user_id: DOCTOR_USER_ID,
        branch_id: BRANCH_ID,
      },
    },
  });
  if (
    !clinic ||
    clinic.status !== record_status.ACTIVE ||
    !branch ||
    branch.clinic_id !== CLINIC_ID ||
    branch.status !== record_status.ACTIVE
  ) {
    throw new Error(
      `Active fixture scope ${CLINIC_ID}/${BRANCH_ID} is required; run the normal local seed first`,
    );
  }
  if (
    !admin ||
    admin.clinic_id !== CLINIC_ID ||
    admin.status !== record_status.ACTIVE ||
    !admin.is_clinic_root_user
  ) {
    throw new Error(`Active root fixture user ${ADMIN_USER_ID} is required`);
  }
  if (
    !doctor ||
    doctor.clinic_id !== CLINIC_ID ||
    doctor.status !== record_status.ACTIVE ||
    !doctorBranch ||
    doctorBranch.status !== record_status.ACTIVE
  ) {
    throw new Error(
      `Active doctor fixture ${DOCTOR_USER_ID} in ${BRANCH_ID} is required`,
    );
  }
}

async function ensureCustomer(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  const existing = await tx.customer.findUnique({
    where: {
      customer_id_clinic_id: {
        customer_id: CUSTOMER_ID,
        clinic_id: CLINIC_ID,
      },
    },
  });
  if (existing) {
    if (existing.branch_id !== BRANCH_ID) {
      throw new Error(
        `Fixture customer ${CUSTOMER_ID} belongs to another branch`,
      );
    }
  } else {
    await tx.customer.create({
      data: {
        customer_id: CUSTOMER_ID,
        clinic_id: CLINIC_ID,
        branch_id: BRANCH_ID,
        title: "Ms.",
        name: "Mali",
        lastname: "Manual Test",
        nickname: "Mali",
        gender: "female",
        birth_date: "1991-04-18",
        personal_id: "HN-OPD-MANUAL-01",
        address: "88 Manual Test Road",
        sub_district: "Khlong Toei",
        district: "Khlong Toei",
        province: "Bangkok",
        postcode: "10110",
        phone_number: "0890002001",
        email: "mali.opd.manual@example.test",
        line_id: "mali-opd-manual",
        customer_status: true,
        status_vip: true,
        attendant: DOCTOR_USER_ID,
        point_accumulate_all_old: 1250,
        point_current_year: 320,
        user_create: ADMIN_USER_ID,
        created_at: now,
        updated_at: now,
      },
    });
  }

  const info = await tx.customer_info.findUnique({
    where: {
      customer_id_clinic_id: {
        customer_id: CUSTOMER_ID,
        clinic_id: CLINIC_ID,
      },
    },
  });
  if (!info) {
    await tx.customer_info.create({
      data: {
        customer_id: CUSTOMER_ID,
        clinic_id: CLINIC_ID,
        allergy: "Penicillin (legacy text; unverified)",
        surgery: "Appendectomy in 2012",
        congenital_disease: "Mild intermittent asthma",
        other_important:
          "Uses salbutamol inhaler as needed; no current anticoagulant",
        weight: 57.4,
        height: 164,
        monthly_income: "50,000-80,000 THB",
        career: "Product designer",
        chanel: "Referral",
        education: "Bachelor degree",
        know_method: "Existing customer referral",
        decide_come_here: "OPD manual acceptance fixture",
        social_media_frequent: "LINE",
        emergency_contact_name: "Narin Manual Test",
        emergency_contact_phone: "0890002002",
        emergency_contact_relation: "Sibling",
        created_at: now,
        updated_at: now,
      },
    });
  }
}

async function ensureCatalog(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  const medicineCategory = await tx.category.findUnique({
    where: { category_id: MEDICINE_CATEGORY_ID },
  });
  if (medicineCategory && medicineCategory.clinic_id !== CLINIC_ID) {
    throw new Error(`${MEDICINE_CATEGORY_ID} is outside the fixture clinic`);
  }
  if (!medicineCategory) {
    await tx.category.create({
      data: {
        category_id: MEDICINE_CATEGORY_ID,
        clinic_id: CLINIC_ID,
        name: "OPD Manual Medicines",
        product_category: all_product_category.MEDICINE,
        status: record_status.ACTIVE,
        code: "OPD-MED",
        created_at: now,
        updated_at: now,
      },
    });
  }

  const medicineSubcategory = await tx.sub_category.findUnique({
    where: { sub_category_id: MEDICINE_SUBCATEGORY_ID },
  });
  if (medicineSubcategory && medicineSubcategory.clinic_id !== CLINIC_ID) {
    throw new Error(`${MEDICINE_SUBCATEGORY_ID} is outside the fixture clinic`);
  }
  if (!medicineSubcategory) {
    await tx.sub_category.create({
      data: {
        sub_category_id: MEDICINE_SUBCATEGORY_ID,
        clinic_id: CLINIC_ID,
        name: "Oral Medication",
        product_category: all_product_category.MEDICINE,
        status: record_status.ACTIVE,
        code: "OPD-ORAL",
        created_at: now,
        updated_at: now,
      },
    });
  }

  const product = await tx.product.findUnique({
    where: { product_id: MEDICINE_PRODUCT_ID },
  });
  if (product && product.branch_id !== BRANCH_ID) {
    throw new Error(`${MEDICINE_PRODUCT_ID} is outside the fixture branch`);
  }
  if (!product) {
    await tx.product.create({
      data: {
        product_id: MEDICINE_PRODUCT_ID,
        product_id_display: "OPD-MED-001",
        branch_id: BRANCH_ID,
        category_id: MEDICINE_CATEGORY_ID,
        sub_category_id: MEDICINE_SUBCATEGORY_ID,
        product_name: "Cetirizine 10 mg tablet",
        description:
          "Local manual-test medicine with a verified future-expiry lot",
        product_category: product_category.MEDICINE,
        product_type: product_type.SALE,
        price: 12,
        is_global: false,
        out_of_stock_alert: 10,
        vat: vat_type.NO_VAT,
        status: record_status.ACTIVE,
        unit: "tablet",
        created_at: now,
        updated_at: now,
      },
    });
  }

  const courseCategory = await tx.category.findUnique({
    where: { category_id: COURSE_CATEGORY_ID },
  });
  if (courseCategory && courseCategory.clinic_id !== CLINIC_ID) {
    throw new Error(`${COURSE_CATEGORY_ID} is outside the fixture clinic`);
  }
  if (!courseCategory) {
    await tx.category.create({
      data: {
        category_id: COURSE_CATEGORY_ID,
        clinic_id: CLINIC_ID,
        name: "OPD Manual Courses",
        product_category: all_product_category.COURSE,
        status: record_status.ACTIVE,
        code: "OPD-COURSE",
        created_at: now,
        updated_at: now,
      },
    });
  }

  const courseSubcategory = await tx.sub_category.findUnique({
    where: { sub_category_id: COURSE_SUBCATEGORY_ID },
  });
  if (courseSubcategory && courseSubcategory.clinic_id !== CLINIC_ID) {
    throw new Error(`${COURSE_SUBCATEGORY_ID} is outside the fixture clinic`);
  }
  if (!courseSubcategory) {
    await tx.sub_category.create({
      data: {
        sub_category_id: COURSE_SUBCATEGORY_ID,
        clinic_id: CLINIC_ID,
        name: "Skin Follow-up",
        product_category: all_product_category.COURSE,
        status: record_status.ACTIVE,
        code: "OPD-SKIN",
        created_at: now,
        updated_at: now,
      },
    });
  }

  const course = await tx.course.findUnique({
    where: { course_id: COURSE_ID },
  });
  if (course && course.branch_id !== BRANCH_ID) {
    throw new Error(`${COURSE_ID} is outside the fixture branch`);
  }
  if (!course) {
    await tx.course.create({
      data: {
        course_id: COURSE_ID,
        course_id_display: "OPD-COURSE-001",
        branch_id: BRANCH_ID,
        category_id: COURSE_CATEGORY_ID,
        sub_category_id: COURSE_SUBCATEGORY_ID,
        course_name: "Skin wellness follow-up package",
        expire_in: 1095,
        is_global: false,
        description: "Existing-course manual scenario with one stock component",
        status: record_status.ACTIVE,
        maximum_discount: 0,
        maximum_discount_unit: amount_unit.PERCENT,
        product_type: product_type.SALE,
        created_at: now,
        updated_at: now,
      },
    });
  }

  const courseItem = await tx.course_item.findUnique({
    where: { course_item_id: COURSE_ITEM_ID },
  });
  if (courseItem && courseItem.course_id !== COURSE_ID) {
    throw new Error(`${COURSE_ITEM_ID} belongs to another course`);
  }
  if (!courseItem) {
    await tx.course_item.create({
      data: {
        course_item_id: COURSE_ITEM_ID,
        course_id: COURSE_ID,
        unit: "session",
        name: "Skin wellness follow-up session",
        price: 8500,
        amount: 20,
        vat: vat_type.NO_VAT,
        created_by: ADMIN_USER_ID,
        status: record_status.ACTIVE,
        created_at: now,
        updated_at: now,
      },
    });
  }

  const component = await tx.course_item_product.findUnique({
    where: {
      product_id_course_item_id: {
        product_id: MEDICINE_PRODUCT_ID,
        course_item_id: COURSE_ITEM_ID,
      },
    },
  });
  if (!component) {
    await tx.course_item_product.create({
      data: {
        product_id: MEDICINE_PRODUCT_ID,
        course_item_id: COURSE_ITEM_ID,
        quantity: 1,
        created_at: now,
        updated_at: now,
      },
    });
  }
}

async function ensureStockAndEntitlement(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  for (const format of [
    {
      formatId: "FMT-OPD-MANUAL-SALE",
      documentKey: document_key.SALE_ORDER,
      prefix: "OPDM-SO-",
      title: "OPD manual sale order",
    },
    {
      formatId: "FMT-OPD-MANUAL-USAGE",
      documentKey: document_key.SERVICE_USAGE,
      prefix: "OPDM-SU-",
      title: "OPD manual service usage",
    },
  ]) {
    const existingFormat = await tx.document_format.findUnique({
      where: {
        document_key_branch_id: {
          document_key: format.documentKey,
          branch_id: BRANCH_ID,
        },
      },
    });
    if (!existingFormat) {
      await tx.document_format.create({
        data: {
          format_id: format.formatId,
          document_key: format.documentKey,
          prefix: format.prefix,
          branch_id: BRANCH_ID,
          title: format.title,
          format_type: format_type.CONTINUOUS,
          start_number: 1,
          digit_number: 6,
          created_at: now,
          updated_at: now,
        },
      });
    }
  }

  const receiveOrder = await tx.receive_order.findUnique({
    where: {
      receive_order_id_branch_id: {
        receive_order_id: RECEIVE_ORDER_ID,
        branch_id: BRANCH_ID,
      },
    },
  });
  if (!receiveOrder) {
    await tx.receive_order.create({
      data: {
        receive_order_id: RECEIVE_ORDER_ID,
        branch_id: BRANCH_ID,
        receive_user_id: ADMIN_USER_ID,
        date: now,
        remark: "OPD manual fixture stock provenance",
        vat_type: vat_type.NO_VAT,
        total: 600,
        discount: 0,
        net: 600,
        created_by: ADMIN_USER_ID,
        receive_order_status: receive_order_status.VERIFY,
        status: record_status.ACTIVE,
        created_at: now,
        updated_at: now,
      },
    });
  }

  const receiveItem = await tx.receive_order_item.findUnique({
    where: {
      receive_order_id_branch_id_item_id_lot_id: {
        receive_order_id: RECEIVE_ORDER_ID,
        branch_id: BRANCH_ID,
        item_id: MEDICINE_PRODUCT_ID,
        lot_id: MEDICINE_LOT_ID,
      },
    },
  });
  if (!receiveItem) {
    await tx.receive_order_item.create({
      data: {
        receive_order_id: RECEIVE_ORDER_ID,
        branch_id: BRANCH_ID,
        item_id: MEDICINE_PRODUCT_ID,
        lot_id: MEDICINE_LOT_ID,
        price_per_unit: 6,
        item_name: "Cetirizine 10 mg tablet",
        quantity: 100,
        price: 600,
        total: 600,
        discount: 0,
        vat: 0,
        expire_date: new Date("2030-12-31T16:59:59.000Z"),
        created_at: now,
        updated_at: now,
      },
    });
  }

  const inventory = await tx.inventory.findUnique({
    where: {
      branch_id_item_id_lot_id: {
        branch_id: BRANCH_ID,
        item_id: MEDICINE_PRODUCT_ID,
        lot_id: MEDICINE_LOT_ID,
      },
    },
  });
  if (!inventory) {
    await tx.inventory.create({
      data: {
        branch_id: BRANCH_ID,
        item_id: MEDICINE_PRODUCT_ID,
        lot_id: MEDICINE_LOT_ID,
        in_stock: 100,
        created_at: now,
        updated_at: now,
      },
    });
  }

  const saleOrder = await tx.sale_order.findUnique({
    where: {
      sale_order_id_branch_id: {
        sale_order_id: COURSE_SALE_ORDER_ID,
        branch_id: BRANCH_ID,
      },
    },
  });
  if (saleOrder) {
    if (
      saleOrder.clinic_id !== CLINIC_ID ||
      saleOrder.customer_id !== CUSTOMER_ID
    ) {
      throw new Error(
        `${COURSE_SALE_ORDER_ID} belongs to another clinic/customer`,
      );
    }
  } else {
    await tx.sale_order.create({
      data: {
        sale_order_id: COURSE_SALE_ORDER_ID,
        branch_id: BRANCH_ID,
        clinic_id: CLINIC_ID,
        customer_id: CUSTOMER_ID,
        total: 8500,
        promotion_discount: 0,
        customer_discount: 0,
        voucher_discount: 0,
        extra_discount: 0,
        subtotal: 8500,
        round_decimal: false,
        totalDue: 0,
        remark: "Paid OPD manual fixture course entitlement",
        sale_order_status: sale_order_status.PAID,
        status: record_status.ACTIVE,
        date: now,
        created_by: ADMIN_USER_ID,
        created_at: now,
        updated_at: now,
      },
    });
  }

  const entitlement = await tx.customer_coures.findUnique({
    where: {
      sale_order_id_branch_id_customer_id_item_id: {
        sale_order_id: COURSE_SALE_ORDER_ID,
        branch_id: BRANCH_ID,
        customer_id: CUSTOMER_ID,
        item_id: COURSE_ITEM_ID,
      },
    },
  });
  if (!entitlement) {
    await tx.customer_coures.create({
      data: {
        sale_order_id: COURSE_SALE_ORDER_ID,
        customer_id: CUSTOMER_ID,
        branch_id: BRANCH_ID,
        clinic_id: CLINIC_ID,
        item_id: COURSE_ITEM_ID,
        amount: 20,
        expire_date: COURSE_EXPIRES_AT,
        expire_date_display: COURSE_EXPIRES_AT,
        created_at: now,
        updated_at: now,
      },
    });
  }
}

async function ensureAppointment(
  tx: Prisma.TransactionClient,
  input: {
    appointmentId: string;
    businessDate: string;
    startTime: string;
    endTime: string;
    detail: string;
  },
  now: Date,
): Promise<void> {
  const existing = await tx.appointment.findUnique({
    where: { appointment_id: input.appointmentId },
  });
  if (existing) {
    if (
      existing.clinic_id !== CLINIC_ID ||
      existing.branch_id !== BRANCH_ID ||
      existing.customer_id !== CUSTOMER_ID ||
      existing.date_appointment !== input.businessDate
    ) {
      throw new Error(
        `Fixture appointment ${input.appointmentId} has conflicting identity`,
      );
    }
  } else {
    await tx.appointment.create({
      data: {
        appointment_id: input.appointmentId,
        branch_id: BRANCH_ID,
        clinic_id: CLINIC_ID,
        customer_id: CUSTOMER_ID,
        user_create: ADMIN_USER_ID,
        date_appointment: input.businessDate,
        time_arrive: input.startTime,
        start_time: input.startTime,
        end_time: input.endTime,
        channel: "OPD local manual bootstrap",
        is_consult: true,
        apply_anesthetic: false,
        appointment_detail: input.detail,
        status_appointment: statusAppointment.APPOINT,
        created_at: now,
        updated_at: now,
      },
    });
  }

  await tx.appointment_detail_extra.upsert({
    where: { appointment_id: input.appointmentId },
    update: {},
    create: {
      appointment_id: input.appointmentId,
      clinic_id: CLINIC_ID,
      branch_id: BRANCH_ID,
      marketing_platform: "Local manual acceptance",
      campaign: "OPD V2 full-detail bootstrap",
      preparation: "Review allergy banner before medication release",
      preparation_tags: ["manual-test", "opd-v2"],
      internal_note:
        "Fixture-scoped record. Manual edits are intentionally preserved.",
      internal_tags: ["OPD-V2", "MANUAL"],
      created_by: ADMIN_USER_ID,
      created_at: now,
      updated_at: now,
    },
  });
  await tx.user_appointment.createMany({
    data: [
      {
        appointment_id: input.appointmentId,
        user_id: DOCTOR_USER_ID,
        operator_type: operator_type.OPERATOR,
      },
    ],
    skipDuplicates: true,
  });
}

async function ensureBaseFixtures(businessDate: string): Promise<{
  activeAppointmentId: string;
  draftSourceAppointmentId: string;
  postAppointmentId: string;
}> {
  const compactDate = compactBusinessDate(businessDate);
  const activeAppointmentId = `APP-OPD-MANUAL-${compactDate}-ACTIVE`;
  const draftSourceAppointmentId = `APP-OPD-MANUAL-${compactDate}-DRAFT`;
  const postAppointmentId = `APP-OPD-MANUAL-${compactDate}-POST`;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await assertPrerequisites(tx);
    await ensureCustomer(tx, now);
    await ensureCatalog(tx, now);
    await ensureStockAndEntitlement(tx, now);
    await ensureAppointment(
      tx,
      {
        appointmentId: draftSourceAppointmentId,
        businessDate,
        startTime: "08:00",
        endTime: "08:45",
        detail:
          "Open reusable-draft source for copy-forward acceptance testing",
      },
      now,
    );
    await ensureAppointment(
      tx,
      {
        appointmentId: postAppointmentId,
        businessDate,
        startTime: "09:00",
        endTime: "09:45",
        detail: "Completed OPD visit for history and post-visit review",
      },
      now,
    );
    await ensureAppointment(
      tx,
      {
        appointmentId: activeAppointmentId,
        businessDate,
        startTime: "10:00",
        endTime: "11:00",
        detail:
          "Open OPD visit with clinical data, draft orders, and course verification",
      },
      now,
    );
  });
  return {
    activeAppointmentId,
    draftSourceAppointmentId,
    postAppointmentId,
  };
}

async function getOrStartEncounter(
  client: ApiClient,
  appointmentId: string,
  idempotencyKey: string,
): Promise<ScenarioResult> {
  const existing = await prisma.opd_encounter.findFirst({
    where: {
      clinic_id: CLINIC_ID,
      branch_id: BRANCH_ID,
      appointment_id: appointmentId,
    },
  });
  if (existing) {
    return {
      appointmentId,
      encounterId: existing.encounter_id,
      workflowStatus: existing.workflow_status,
      clinicalRecordStatus: existing.clinical_record_status,
    };
  }
  const result = await client.request("/clinic/opd/start", {
    method: "POST",
    body: { appointmentId },
    idempotencyKey,
  });
  return {
    appointmentId,
    encounterId: stringField(result, "encounterId"),
    workflowStatus: stringField(result, "workflowStatus"),
    clinicalRecordStatus: stringField(result, "clinicalRecordStatus"),
  };
}

async function ensureAttending(
  client: ApiClient,
  encounterId: string,
): Promise<JsonObject> {
  let workspace = await client.request(`/clinic/opd/${encounterId}/workspace`);
  let context = objectField(workspace, "context");
  if (nullableStringField(context, "attendingUserId") !== DOCTOR_USER_ID) {
    await client.request(`/clinic/opd/${encounterId}/attending-clinician`, {
      method: "PATCH",
      body: {
        expectedEncounterVersion: numberField(context, "version"),
        attendingUserId: DOCTOR_USER_ID,
      },
    });
    workspace = await client.request(`/clinic/opd/${encounterId}/workspace`);
    context = objectField(workspace, "context");
  }
  return context;
}

async function ensureExamination(
  client: ApiClient,
  encounterId: string,
  scenario: "active" | "post",
): Promise<JsonObject> {
  const created = await client.request(
    `/clinic/opd/${encounterId}/examinations`,
    { method: "POST", body: {} },
  );
  let examination = objectField(created, "examination");
  const vitals = objectField(examination, "vitals");
  const vitalKeys = [
    "weightKg",
    "heightCm",
    "systolicBloodPressureMmHg",
    "diastolicBloodPressureMmHg",
    "pulseRatePerMinute",
    "temperatureCelsius",
    "oxygenSaturationPercent",
    "respiratoryRatePerMinute",
    "dtxMgDl",
    "painScore",
  ];
  const vitalsAreEmpty = vitalKeys.every(
    (key) => vitals[key] === null || vitals[key] === undefined,
  );
  if (vitalsAreEmpty && numberField(vitals, "version") === 1) {
    examination = await client.request(
      `/clinic/opd/${encounterId}/examinations/${stringField(examination, "examinationId")}/vitals`,
      {
        method: "PATCH",
        body:
          scenario === "post"
            ? {
                expectedVersion: 1,
                weightKg: 57.1,
                heightCm: 164,
                systolicBloodPressureMmHg: 116,
                diastolicBloodPressureMmHg: 74,
                pulseRatePerMinute: 72,
                temperatureCelsius: 36.6,
                oxygenSaturationPercent: 99,
                respiratoryRatePerMinute: 16,
                dtxMgDl: 94,
                painScore: 2,
              }
            : {
                expectedVersion: 1,
                weightKg: 57.4,
                heightCm: 164,
                systolicBloodPressureMmHg: 118,
                diastolicBloodPressureMmHg: 76,
                pulseRatePerMinute: 74,
                temperatureCelsius: 36.7,
                oxygenSaturationPercent: 99,
                respiratoryRatePerMinute: 16,
                dtxMgDl: 98,
                painScore: 3,
              },
      },
    );
  }
  return examination;
}

async function ensureIntake(
  client: ApiClient,
  encounterId: string,
  examinationId: string,
  scenario: "active" | "post",
): Promise<JsonObject> {
  let intake = await client.request(
    `/clinic/opd/${encounterId}/examinations/${examinationId}/intake`,
  );
  if (numberField(intake, "version") === 0) {
    intake = await client.request(
      `/clinic/opd/${encounterId}/examinations/${examinationId}/intake`,
      {
        method: "PATCH",
        body:
          scenario === "post"
            ? {
                expectedVersion: 0,
                urinaryStatus: "NORMAL",
                urinaryOtherText: null,
                bowelStatus: "NORMAL",
                bowelOtherText: null,
              }
            : {
                expectedVersion: 0,
                urinaryStatus: "FREQUENCY",
                urinaryOtherText: null,
                bowelStatus: "CONSTIPATION",
                bowelOtherText: null,
              },
      },
    );
  }
  return intake;
}

async function ensureSymptoms(
  client: ApiClient,
  encounterId: string,
  examinationId: string,
  scenario: "active" | "post",
): Promise<JsonObject> {
  const created = await client.request(
    `/clinic/opd/${encounterId}/examinations/${examinationId}/symptoms`,
    { method: "POST", body: {} },
  );
  let section = objectField(created, "section");
  if (
    numberField(section, "version") === 1 &&
    objectArrayField(section, "items").length === 0
  ) {
    section = await client.request(
      `/clinic/opd/${encounterId}/examinations/${examinationId}/symptoms`,
      {
        method: "PATCH",
        body:
          scenario === "post"
            ? {
                expectedVersion: 1,
                patientQuote:
                  "The facial itching is much better and I slept normally.",
                items: [
                  {
                    mainCode: null,
                    mainText: "Resolving facial pruritus",
                    durationValue: 5,
                    durationUnit: "day",
                    location: "both cheeks",
                    laterality: "BILATERAL",
                    severity: 2,
                    character: "intermittent itching",
                    modifyingFactors: "improved with oral antihistamine",
                    staffSummary:
                      "No dyspnea, lip swelling, or spreading rash reported",
                    associations: [
                      { code: null, label: "mild erythema" },
                      { code: null, label: "dry skin" },
                    ],
                  },
                ],
              }
            : {
                expectedVersion: 1,
                patientQuote:
                  "Dark patches and mild itching returned after sun exposure.",
                items: [
                  {
                    mainCode: null,
                    mainText: "Facial hyperpigmentation with pruritus",
                    durationValue: 3,
                    durationUnit: "week",
                    location: "malar area",
                    laterality: "BILATERAL",
                    severity: 3,
                    character: "patchy discoloration and mild itching",
                    modifyingFactors:
                      "worse after sun exposure, improved by moisturizer",
                    staffSummary:
                      "No fever, breathing difficulty, mucosal lesion, or acute swelling",
                    associations: [
                      { code: null, label: "photosensitivity" },
                      { code: null, label: "dry skin" },
                    ],
                  },
                ],
              },
      },
    );
  }
  return section;
}

async function ensureDiagnoses(
  client: ApiClient,
  encounterId: string,
  scenario: "active" | "post",
): Promise<JsonObject> {
  const created = await client.request(`/clinic/opd/${encounterId}/diagnoses`, {
    method: "POST",
    body: {},
  });
  let section = objectField(created, "section");
  if (
    numberField(section, "version") === 1 &&
    objectArrayField(section, "items").length === 0
  ) {
    section = await client.request(`/clinic/opd/${encounterId}/diagnoses`, {
      method: "PATCH",
      body:
        scenario === "post"
          ? {
              expectedVersion: 1,
              items: [
                {
                  codeSystem: "ICD-10",
                  codeEdition: "2019",
                  code: "L29.9",
                  label: "Pruritus, unspecified",
                  isPrimary: true,
                  onsetText: "Acute, resolving",
                  note: "Improved without red-flag allergic symptoms",
                },
                {
                  codeSystem: "ICD-10",
                  codeEdition: "2019",
                  code: "L85.3",
                  label: "Xerosis cutis",
                  isPrimary: false,
                  onsetText: "Intermittent",
                  note: "Continue emollient and sun protection",
                },
              ],
            }
          : {
              expectedVersion: 1,
              items: [
                {
                  codeSystem: "ICD-10",
                  codeEdition: "2019",
                  code: "L81.1",
                  label: "Chloasma",
                  isPrimary: true,
                  onsetText: "Three weeks",
                  note: "Bilateral malar distribution after sun exposure",
                },
                {
                  codeSystem: "ICD-10",
                  codeEdition: "2019",
                  code: "L29.9",
                  label: "Pruritus, unspecified",
                  isPrimary: false,
                  onsetText: "Three weeks",
                  note: "Mild; no systemic allergic features",
                },
              ],
            },
    });
  }
  return section;
}

async function ensureNotes(
  client: ApiClient,
  encounterId: string,
  scenario: "active" | "post",
): Promise<JsonObject> {
  let workspace = await client.request(
    `/clinic/opd/${encounterId}/note-workspace`,
  );
  if (numberField(workspace, "version") === 0) {
    workspace = await client.request(
      `/clinic/opd/${encounterId}/note-workspace/mode`,
      {
        method: "PATCH",
        body: { expectedVersion: 0, selectedMode: "FORM" },
      },
    );
  }
  const texts: Record<string, string> =
    scenario === "post"
      ? {
          CHIEF_COMPLAINT:
            "Follow-up for facial itching and dryness after five days of treatment.",
          PHYSICAL_EXAMINATION:
            "Alert, afebrile. Mild bilateral cheek xerosis; no urticaria, angioedema, mucosal lesion, or respiratory distress.",
          DIAGNOSIS_NARRATIVE:
            "Resolving nonspecific facial pruritus with xerosis; no evidence of anaphylaxis or infection.",
          TREATMENT:
            "Continue cetirizine 10 mg nightly as needed and fragrance-free emollient twice daily.",
          TREATMENT_PLAN:
            "Sun protection, avoid new cosmetics for one week, and return for worsening rash, swelling, or dyspnea.",
          ADDITIONAL_NOTES:
            "Legacy penicillin allergy text reviewed with patient; medication interaction checking is outside this workflow.",
          FREE_NOTE:
            "Manual fixture completed visit: all clinical sections intentionally populated.",
        }
      : {
          CHIEF_COMPLAINT:
            "Recurrent bilateral facial dark patches with mild itching after increased sun exposure.",
          PHYSICAL_EXAMINATION:
            "Well appearing. Symmetric malar hyperpigmented patches with mild xerosis; no open wound, discharge, or mucosal involvement.",
          DIAGNOSIS_NARRATIVE:
            "Clinical pattern is consistent with chloasma plus mild nonspecific pruritus; review response at follow-up.",
          TREATMENT:
            "Cetirizine 10 mg nightly for symptomatic itch; reinforce moisturizer and broad-spectrum sunscreen.",
          TREATMENT_PLAN:
            "Use existing skin wellness course session after verification; reassess pigmentation and tolerance in four weeks.",
          ADDITIONAL_NOTES:
            "Patient understands that legacy allergy data is unverified and will confirm it before medication release.",
          FREE_NOTE:
            "Open manual-test encounter; safe to edit fields and exercise course verification.",
        };
  for (const section of objectArrayField(workspace, "sections")) {
    const sectionCode = stringField(section, "sectionCode");
    if (numberField(section, "version") === 0) {
      await client.request(
        `/clinic/opd/${encounterId}/sections/${sectionCode}`,
        {
          method: "PATCH",
          body: {
            expectedVersion: 0,
            content: richText(
              texts[sectionCode] ??
                `Manual OPD fixture content for ${sectionCode}.`,
            ),
          },
        },
      );
    }
  }
  return client.request(`/clinic/opd/${encounterId}/note-workspace`);
}

async function ensureOrder(
  client: ApiClient,
  encounterId: string,
  includeCourseItem: boolean,
): Promise<JsonObject> {
  const current = await client.request(`/clinic/opd/${encounterId}/orders`);
  let order = nullableObjectField(current, "order");
  if (!order) {
    const created = await client.request(`/clinic/opd/${encounterId}/orders`, {
      method: "POST",
      body: {},
    });
    order = objectField(created, "order");
  }
  if (stringField(order, "status") !== "DRAFT") return order;

  let items = objectArrayField(order, "items");
  if (
    !items.some((item) => stringField(item, "sourceId") === MEDICINE_PRODUCT_ID)
  ) {
    order = await client.request(
      `/clinic/opd/${encounterId}/orders/${stringField(order, "orderId")}/items`,
      {
        method: "POST",
        body: {
          expectedOrderVersion: numberField(order, "version"),
          sourceType: "PRODUCT",
          sourceId: MEDICINE_PRODUCT_ID,
          quantity: 10,
          note: "Manual fixture medication line",
          medicationInstruction: {
            dose: "10 mg",
            route: "oral",
            frequency: "once daily",
            timing: "at bedtime",
            durationValue: 10,
            durationUnit: "day",
            sigText: "Take one tablet by mouth at bedtime for itching.",
            note: "Stop and seek care for swelling or breathing difficulty.",
          },
        },
      },
    );
  }

  items = objectArrayField(order, "items");
  if (
    includeCourseItem &&
    !items.some((item) => stringField(item, "sourceId") === COURSE_ITEM_ID)
  ) {
    order = await client.request(
      `/clinic/opd/${encounterId}/orders/${stringField(order, "orderId")}/items`,
      {
        method: "POST",
        body: {
          expectedOrderVersion: numberField(order, "version"),
          sourceType: "COURSE_ITEM",
          sourceId: COURSE_ITEM_ID,
          quantity: 1,
          note: "Manual fixture course proposal; existing entitlement is reserved separately",
          medicationInstruction: null,
        },
      },
    );
  }
  return order;
}

async function ensureDraftCheckpoint(
  client: ApiClient,
  encounterId: string,
  examination: JsonObject,
): Promise<void> {
  const existing = await prisma.opd_draft_checkpoint.findFirst({
    where: { encounter_id: encounterId },
    select: { draft_checkpoint_id: true },
  });
  if (existing) return;

  const examinationId = stringField(examination, "examinationId");
  const [
    workspace,
    currentExamination,
    intake,
    symptomsResult,
    diagnosesResult,
    orderResult,
    noteWorkspace,
  ] = await Promise.all([
    client.request(`/clinic/opd/${encounterId}/workspace`),
    client.request(`/clinic/opd/${encounterId}/examinations/${examinationId}`),
    client.request(
      `/clinic/opd/${encounterId}/examinations/${examinationId}/intake`,
    ),
    client.request(
      `/clinic/opd/${encounterId}/examinations/${examinationId}/symptoms`,
    ),
    client.request(`/clinic/opd/${encounterId}/diagnoses`),
    client.request(`/clinic/opd/${encounterId}/orders`),
    client.request(`/clinic/opd/${encounterId}/note-workspace`),
  ]);
  const context = objectField(workspace, "context");
  const vitals = objectField(currentExamination, "vitals");
  const symptoms = objectField(symptomsResult, "section");
  const diagnoses = objectField(diagnosesResult, "section");
  const order = objectField(orderResult, "order");
  const noteSections = objectArrayField(noteWorkspace, "sections").map(
    (section) => ({
      id: stringField(section, "noteSectionId"),
      version: numberField(section, "version"),
      sectionCode: stringField(section, "sectionCode"),
    }),
  );
  await client.request(`/clinic/opd/${encounterId}/draft-checkpoints`, {
    method: "POST",
    idempotencyKey: `manual-${encounterId}-checkpoint`,
    body: {
      expectedVersions: {
        encounter: {
          id: encounterId,
          version: numberField(context, "version"),
        },
        examination: {
          id: examinationId,
          version: numberField(currentExamination, "version"),
        },
        vitals: {
          id: stringField(vitals, "vitalObservationId"),
          version: numberField(vitals, "version"),
        },
        intake: {
          id: stringField(intake, "intakeId"),
          version: numberField(intake, "version"),
        },
        symptoms: {
          id: stringField(symptoms, "symptomSectionId"),
          version: numberField(symptoms, "version"),
        },
        diagnoses: {
          id: stringField(diagnoses, "diagnosisSectionId"),
          version: numberField(diagnoses, "version"),
        },
        order: {
          id: stringField(order, "orderId"),
          version: numberField(order, "version"),
        },
        noteWorkspace: {
          id: stringField(noteWorkspace, "noteWorkspaceId"),
          version: numberField(noteWorkspace, "version"),
        },
        noteSections,
      },
      note: "Reusable manual-test snapshot captured before clinical finalization",
    },
  });
}

async function ensureReleasedOrder(
  client: ApiClient,
  encounterId: string,
  order: JsonObject,
): Promise<JsonObject> {
  if (stringField(order, "status") === "RELEASED") return order;
  const orderId = stringField(order, "orderId");
  const itemVersions = objectArrayField(order, "items")
    .filter((item) => stringField(item, "status") === "ACTIVE")
    .map((item) => ({
      orderItemId: stringField(item, "orderItemId"),
      version: numberField(item, "version"),
    }));
  const discovery = await client.request(
    `/clinic/opd/${encounterId}/orders/${orderId}/release-preflight`,
    {
      method: "POST",
      body: {
        expectedOrderVersion: numberField(order, "version"),
        itemVersions,
      },
    },
  );
  const selectedLots = objectArrayField(discovery, "lots").map((line) => {
    const eligibleLot =
      objectArrayField(line, "eligibleLots").find(
        (lot) => stringField(lot, "lotId") === MEDICINE_LOT_ID,
      ) ?? objectArrayField(line, "eligibleLots")[0];
    if (!eligibleLot) {
      throw new Error(
        `No eligible lot is available for order item ${stringField(line, "orderItemId")}`,
      );
    }
    return {
      orderItemId: stringField(line, "orderItemId"),
      lotId: stringField(eligibleLot, "lotId"),
    };
  });
  const preflight = await client.request(
    `/clinic/opd/${encounterId}/orders/${orderId}/release-preflight`,
    {
      method: "POST",
      body: {
        expectedOrderVersion: numberField(order, "version"),
        itemVersions,
        selectedLots,
      },
    },
  );
  if (!booleanField(preflight, "eligible")) {
    throw new Error(
      `Medication release preflight is blocked: ${JSON.stringify(preflight.blockers)}`,
    );
  }
  const safety = objectField(preflight, "safety");
  await client.request(`/clinic/opd/${encounterId}/orders/${orderId}/release`, {
    method: "POST",
    idempotencyKey: `manual-${encounterId}-release`,
    body: {
      expectedOrderVersion: numberField(preflight, "orderVersion"),
      itemVersions: objectArrayField(preflight, "itemVersions").map((item) => ({
        orderItemId: stringField(item, "orderItemId"),
        version: numberField(item, "version"),
      })),
      selectedLots,
      preflightToken: stringField(preflight, "preflightToken"),
      safetyAcknowledgement: {
        safetySnapshotHash: stringField(safety, "safetySnapshotHash"),
        acknowledged: true,
      },
    },
  });
  const current = await client.request(`/clinic/opd/${encounterId}/orders`);
  return objectField(current, "order");
}

async function ensureFinalExamination(
  client: ApiClient,
  encounterId: string,
  examination: JsonObject,
): Promise<JsonObject> {
  if (stringField(examination, "status") === "FINAL") return examination;
  const examinationId = stringField(examination, "examinationId");
  const [current, intake, symptomsResult] = await Promise.all([
    client.request(`/clinic/opd/${encounterId}/examinations/${examinationId}`),
    client.request(
      `/clinic/opd/${encounterId}/examinations/${examinationId}/intake`,
    ),
    client.request(
      `/clinic/opd/${encounterId}/examinations/${examinationId}/symptoms`,
    ),
  ]);
  const vitals = objectField(current, "vitals");
  const symptoms = objectField(symptomsResult, "section");
  return client.request(
    `/clinic/opd/${encounterId}/examinations/${examinationId}/finalize`,
    {
      method: "POST",
      idempotencyKey: `manual-${encounterId}-exam-finalize`,
      body: {
        expectedExaminationVersion: numberField(current, "version"),
        expectedVitalVersion: numberField(vitals, "version"),
        expectedIntakeVersion: numberField(intake, "version"),
        expectedSymptomVersion: numberField(symptoms, "version"),
      },
    },
  );
}

async function ensureClinicalFinalization(
  client: ApiClient,
  encounterId: string,
): Promise<void> {
  const readiness = await client.request(
    `/clinic/opd/${encounterId}/readiness`,
  );
  if (!booleanField(readiness, "ready")) {
    throw new Error(
      `Clinical finalization is blocked: ${JSON.stringify(readiness.blockers)}`,
    );
  }
  await client.request(`/clinic/opd/${encounterId}/finalize-clinical`, {
    method: "POST",
    idempotencyKey: `manual-${encounterId}-clinical-finalize`,
    body: {
      expectedVersions: objectField(readiness, "expectedVersions"),
    },
  });
}

async function ensureCourseReservation(
  client: ApiClient,
  encounterId: string,
): Promise<void> {
  const current = await client.request(
    `/clinic/opd/${encounterId}/course-reservations/current`,
  );
  if (nullableObjectField(current, "reservation")) return;

  const entitlements = await client.request(
    `/clinic/opd/${encounterId}/course-entitlements?page=1&pageSize=20`,
  );
  const entitlement = objectArrayField(entitlements, "items").find(
    (item) =>
      stringField(item, "courseItemId") === COURSE_ITEM_ID &&
      booleanField(item, "eligible"),
  );
  if (!entitlement) {
    throw new Error(
      `No eligible ${COURSE_ITEM_ID} entitlement is available for ${encounterId}`,
    );
  }
  const selections = [
    {
      entitlementToken: stringField(entitlement, "entitlementToken"),
      quantity: 1,
      components: [
        {
          productId: MEDICINE_PRODUCT_ID,
          lotId: MEDICINE_LOT_ID,
        },
      ],
    },
  ];
  const preflight = await client.request(
    `/clinic/opd/${encounterId}/course-reservations/preflight`,
    { method: "POST", body: { selections } },
  );
  if (!booleanField(preflight, "eligible")) {
    throw new Error(
      `Course reservation preflight is blocked: ${JSON.stringify(preflight.blockers)}`,
    );
  }
  await client.request(`/clinic/opd/${encounterId}/course-reservations`, {
    method: "POST",
    idempotencyKey: `manual-${encounterId}-course-reservation`,
    body: {
      selections,
      preflightToken: stringField(preflight, "preflightToken"),
    },
  });
}

async function seedOpenClinicalScenario(
  client: ApiClient,
  scenario: ScenarioResult,
  kind: "active" | "post",
): Promise<ScenarioResult> {
  const workspace = await client.request(
    `/clinic/opd/${scenario.encounterId}/workspace`,
  );
  const initialContext = objectField(workspace, "context");
  const initialWorkflowStatus = stringField(initialContext, "workflowStatus");
  const initialClinicalStatus = stringField(
    initialContext,
    "clinicalRecordStatus",
  );
  if (initialWorkflowStatus !== "OPEN" || initialClinicalStatus !== "DRAFT") {
    return {
      ...scenario,
      workflowStatus: initialWorkflowStatus,
      clinicalRecordStatus: initialClinicalStatus,
    };
  }

  await ensureAttending(client, scenario.encounterId);
  let examination = await ensureExamination(client, scenario.encounterId, kind);
  const examinationId = stringField(examination, "examinationId");
  await ensureIntake(client, scenario.encounterId, examinationId, kind);
  await ensureSymptoms(client, scenario.encounterId, examinationId, kind);
  await ensureDiagnoses(client, scenario.encounterId, kind);
  await ensureNotes(client, scenario.encounterId, kind);
  let order = await ensureOrder(
    client,
    scenario.encounterId,
    kind === "active",
  );

  if (kind === "post") {
    await ensureDraftCheckpoint(client, scenario.encounterId, examination);
    order = await ensureReleasedOrder(client, scenario.encounterId, order);
    if (stringField(order, "status") !== "RELEASED") {
      throw new Error("The completed scenario order did not reach RELEASED");
    }
    examination = await ensureFinalExamination(
      client,
      scenario.encounterId,
      examination,
    );
    if (stringField(examination, "status") !== "FINAL") {
      throw new Error("The completed scenario examination did not reach FINAL");
    }
    await ensureClinicalFinalization(client, scenario.encounterId);
  } else {
    await ensureCourseReservation(client, scenario.encounterId);
  }

  const refreshed = await client.request(
    `/clinic/opd/${scenario.encounterId}/workspace`,
  );
  const context = objectField(refreshed, "context");
  return {
    ...scenario,
    workflowStatus: stringField(context, "workflowStatus"),
    clinicalRecordStatus: stringField(context, "clinicalRecordStatus"),
  };
}

async function seedReusableDraftSource(
  client: ApiClient,
  scenario: ScenarioResult,
): Promise<ScenarioResult> {
  const workspace = await client.request(
    `/clinic/opd/${scenario.encounterId}/workspace`,
  );
  const initialContext = objectField(workspace, "context");
  const initialWorkflowStatus = stringField(initialContext, "workflowStatus");
  const initialClinicalStatus = stringField(
    initialContext,
    "clinicalRecordStatus",
  );
  if (initialWorkflowStatus !== "OPEN" || initialClinicalStatus !== "DRAFT") {
    return {
      ...scenario,
      workflowStatus: initialWorkflowStatus,
      clinicalRecordStatus: initialClinicalStatus,
    };
  }

  await ensureAttending(client, scenario.encounterId);
  const examination = await ensureExamination(
    client,
    scenario.encounterId,
    "active",
  );
  const examinationId = stringField(examination, "examinationId");
  await ensureIntake(client, scenario.encounterId, examinationId, "active");
  await ensureSymptoms(client, scenario.encounterId, examinationId, "active");
  await ensureDiagnoses(client, scenario.encounterId, "active");
  await ensureNotes(client, scenario.encounterId, "active");
  await ensureOrder(client, scenario.encounterId, false);
  await ensureDraftCheckpoint(client, scenario.encounterId, examination);

  const refreshed = await client.request(
    `/clinic/opd/${scenario.encounterId}/workspace`,
  );
  const context = objectField(refreshed, "context");
  return {
    ...scenario,
    workflowStatus: stringField(context, "workflowStatus"),
    clinicalRecordStatus: stringField(context, "clinicalRecordStatus"),
  };
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const businessDate = bangkokBusinessDate();
  if (!APPLY) {
    write({
      mode: "DRY_RUN",
      database: "healthx_optionb_test",
      clinicId: CLINIC_ID,
      branchId: BRANCH_ID,
      businessDate,
      fixtureCustomerId: CUSTOMER_ID,
      plannedScenarios: [
        "FINALIZED_POST_VISIT",
        "OPEN_REUSABLE_DRAFT_SOURCE",
        "OPEN_FULL_DETAIL",
      ],
      nextCommand: "pnpm.cmd opd:v2:bootstrap-manual --apply",
    });
    return;
  }

  const { activeAppointmentId, draftSourceAppointmentId, postAppointmentId } =
    await ensureBaseFixtures(businessDate);
  progress("base fixtures ready");
  const client = new ApiClient();
  await client.login();
  progress("authenticated");
  let post = await getOrStartEncounter(
    client,
    postAppointmentId,
    `manual-${businessDate}-post-start`,
  );
  progress(`completed scenario encounter ready: ${post.encounterId}`);
  post = await seedOpenClinicalScenario(client, post, "post");
  progress("completed scenario populated and finalized");

  let draftSource = await getOrStartEncounter(
    client,
    draftSourceAppointmentId,
    `manual-${businessDate}-draft-source-start`,
  );
  progress(`reusable draft source encounter ready: ${draftSource.encounterId}`);
  draftSource = await seedReusableDraftSource(client, draftSource);
  progress("reusable draft source populated and checkpointed");

  let active = await getOrStartEncounter(
    client,
    activeAppointmentId,
    `manual-${businessDate}-active-start`,
  );
  progress(`open scenario encounter ready: ${active.encounterId}`);
  active = await seedOpenClinicalScenario(client, active, "active");
  progress("open scenario populated with reservation");

  const [postVisit, reusableDrafts, reservation, stock] = await Promise.all([
    client.request(`/clinic/opd/${post.encounterId}/post-visit`),
    client.request(
      `/clinic/opd/${active.encounterId}/reusable-drafts?page=1&pageSize=20&author=ALL`,
    ),
    client.request(
      `/clinic/opd/${active.encounterId}/course-reservations/current`,
    ),
    prisma.inventory.findUnique({
      where: {
        branch_id_item_id_lot_id: {
          branch_id: BRANCH_ID,
          item_id: MEDICINE_PRODUCT_ID,
          lot_id: MEDICINE_LOT_ID,
        },
      },
    }),
  ]);
  const reusableDraftCount = objectArrayField(reusableDrafts, "items").length;
  if (reusableDraftCount < 1) {
    throw new Error(
      "The open scenario cannot see the reusable draft source checkpoint",
    );
  }

  write({
    mode: "APPLIED",
    businessDate,
    scope: { clinicId: CLINIC_ID, branchId: BRANCH_ID },
    login: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
    patient: {
      customerId: CUSTOMER_ID,
      displayName: "Mali Manual Test",
    },
    active,
    reusableDraftSource: draftSource,
    postVisit: post,
    checks: {
      postVisitProjection:
        objectField(postVisit, "context").workflowStatus === "POST_VISIT",
      reusableDraftCount,
      courseReservationStatus: nullableObjectField(reservation, "reservation")
        ? stringField(objectField(reservation, "reservation"), "status")
        : null,
      courseVerificationAllowed: booleanField(
        reservation,
        "verificationAllowed",
      ),
      fixtureLotStock: stock ? Number(stock.in_stock?.toString() ?? "0") : 0,
    },
  });
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

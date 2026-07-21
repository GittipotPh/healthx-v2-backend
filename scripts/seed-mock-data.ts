import { randomUUID } from "crypto";
import * as argon2 from "argon2";
import {
  PrismaClient,
  all_product_category,
  amount_unit,
  clinic_payment_type,
  condition_wallet_enum,
  discount_type,
  document_status,
  document_type,
  opdStatus,
  product_type,
  record_status,
  role_enum,
  sale_order_status,
  statusAppointment,
  type_branch,
  usage_log_status,
  vat_type,
  wallet_type,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncFixtureAppointmentTicket } from "./opd-v2-fixture-ticket-sync";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/healthx_optionb_test?schema=public";
const EMAIL = "admin.test@healthx.local";
const PASSWORD = "Admin@1234";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=";

const APPOINTMENT_REFERENCE_OPTIONS = [
  { type: "CONSULT_TYPE", code: "consult", label: "Consult", sort: 10 },
  { type: "CONSULT_TYPE", code: "procedure", label: "Procedure", sort: 20 },
  { type: "CONSULT_TYPE", code: "follow-up", label: "Follow-up", sort: 30 },
  { type: "MARKETING_PLATFORM", code: "facebook", label: "Facebook", sort: 10 },
  { type: "MARKETING_PLATFORM", code: "line", label: "LINE", sort: 20 },
  { type: "MARKETING_PLATFORM", code: "google-ads", label: "Google Ads", sort: 30 },
  { type: "MARKETING_PLATFORM", code: "walk-in", label: "Walk-in", sort: 40 },
  { type: "MARKETING_PLATFORM", code: "instagram", label: "Instagram", sort: 50 },
  { type: "MARKETING_CAMPAIGN", code: "birthday-promotion", label: "Birthday Promotion", sort: 10 },
  { type: "MARKETING_CAMPAIGN", code: "member-special", label: "Member Special", sort: 20 },
  { type: "MARKETING_CAMPAIGN", code: "flash-sale", label: "Flash Sale", sort: 30 },
  { type: "MARKETING_CAMPAIGN", code: "new-year-campaign", label: "New Year Campaign", sort: 40 },
  { type: "PREPARATION_TAG", code: "no-vitamins", label: "No vitamins", sort: 10 },
  { type: "PREPARATION_TAG", code: "no-alcohol", label: "No alcohol", sort: 20 },
  { type: "PREPARATION_TAG", code: "fasting", label: "Fasting", sort: 30 },
  { type: "PREPARATION_TAG", code: "wash-face", label: "Wash face", sort: 40 },
  { type: "PREPARATION_TAG", code: "numbing-cream", label: "Numbing cream", sort: 50 },
  { type: "INTERNAL_TAG", code: "laser-zone", label: "Laser zone", sort: 10 },
  { type: "INTERNAL_TAG", code: "vip", label: "VIP patient", sort: 20 },
  { type: "INTERNAL_TAG", code: "special-care", label: "Special care", sort: 30 },
  { type: "NUMBING_DURATION", code: "30", label: "30 minutes", sort: 10, metadata: { minutes: 30 } },
  { type: "NUMBING_DURATION", code: "45", label: "45 minutes", sort: 20, metadata: { minutes: 45 } },
  { type: "NUMBING_DURATION", code: "60", label: "60 minutes", sort: 30, metadata: { minutes: 60 } },
] as const;

interface MockCourseBalance {
  itemKey: "BOTOX" | "FILLER";
  used: number;
  total: number;
}

interface MockCustomer {
  id: string;
  name: string;
  lastname: string;
  nickname: string;
  gender: "male" | "female";
  personal_id: string;
  status_vip: boolean;
  allergy: string;
  birth_date: string;
  phone_number: string;
  line_id: string | null;
  customer_group: "GENERAL" | "GOLD" | "PLATINUM";
  points_old: number;
  points_current: number;
  outstanding: number;
  deposit: number;
  credit: number;
  consentSigned: number;
  consentTotal: number;
  courses: MockCourseBalance[];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600 * 1000);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function appointmentOptionId(type: string, code: string): string {
  return `GLOBAL-${type}-${code.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`.slice(0, 80);
}

async function seedAppointmentReferenceOptions(now: Date): Promise<void> {
  for (const option of APPOINTMENT_REFERENCE_OPTIONS) {
    await prisma.ref_appointment_option.upsert({
      where: { option_id: appointmentOptionId(option.type, option.code) },
      update: {
        code: option.code,
        label_th: option.label,
        label_en: option.label,
        sort_order: option.sort,
        is_active: true,
        metadata: "metadata" in option ? option.metadata : undefined,
        updated_at: now,
      },
      create: {
        option_id: appointmentOptionId(option.type, option.code),
        type: option.type,
        code: option.code,
        label_th: option.label,
        label_en: option.label,
        sort_order: option.sort,
        is_active: true,
        metadata: "metadata" in option ? option.metadata : undefined,
        created_at: now,
        updated_at: now,
      },
    });
  }
}

async function seedClinicAndBranch(
  clinicId: string,
  branchId: string,
  adminUserId: string,
  doctorUserId: string,
  prefix: string,
  now: Date,
  todayStr: string,
  tomorrowStr: string,
  nextWeekStr: string
): Promise<void> {
  console.log(`🌱 Seeding data for Clinic [${clinicId}] - Branch [${branchId}]...`);

  // 1) Ensure Examination Rooms exist for this branch
  const rooms = ["ตรวจสุขภาพทั่วไป", "ทันตกรรม", "ตรวจผิวหนัง", "Botox", "Laser"];
  for (const roomName of rooms) {
    const roomId = `ROOM-${prefix}-${roomName}`;
    await prisma.examination_room.upsert({
      where: { room_id: roomId },
      update: { room_status: record_status.ACTIVE },
      create: {
        room_id: roomId,
        branch_id: branchId,
        room_name: roomName,
        room_status: record_status.ACTIVE,
      },
    });
  }

  const operationItems = [
    { code: "CONSULT", title: "Consultation", minutes: "30" },
    { code: "BOTOX", title: "Botox", minutes: "45" },
    { code: "FILLER", title: "Filler", minutes: "60" },
    { code: "HIFU", title: "HIFU", minutes: "90" },
    { code: "LASER", title: "Laser", minutes: "45" },
    { code: "SKINBOOSTER", title: "Skinbooster", minutes: "60" },
  ];

  for (const item of operationItems) {
    await prisma.operation_item.upsert({
      where: { op_id: `OP-${prefix}-${item.code}` },
      update: {
        title: item.title,
        operating_time: item.minutes,
        status: record_status.ACTIVE,
      },
      create: {
        op_id: `OP-${prefix}-${item.code}`,
        branch_id: branchId,
        title: item.title,
        operating_time: item.minutes,
        user_create: adminUserId,
        status: record_status.ACTIVE,
        created_at: now,
      },
    });
  }

  // 2) Define target mock IDs
  const mockCustomerIds = [
    `CUST-${prefix}-01`,
    `CUST-${prefix}-02`,
    `CUST-${prefix}-03`,
    `CUST-${prefix}-04`,
    `CUST-${prefix}-05`,
    `CUST-${prefix}-06`,
    `CUST-${prefix}-07`,
    `CUST-${prefix}-08`,
  ];

  const mockAppIds = [
    `APP-TODAY-${prefix}-01`,
    `APP-TODAY-${prefix}-02`,
    `APP-TODAY-${prefix}-03`,
    `APP-TODAY-${prefix}-04`,
    `APP-TODAY-${prefix}-05`,
    `APP-TODAY-${prefix}-06`,
    `APP-TODAY-${prefix}-07`,
    `APP-TODAY-${prefix}-08`,
    `APP-FUTURE-${prefix}-01`,
    `APP-FUTURE-${prefix}-02`,
    `APP-FUTURE-${prefix}-03`,
    `APP-FUTURE-${prefix}-04`,
  ];

  const mockOpdIds = mockAppIds.map(id => `OPD-${id}`);
  const consentDocIds = [1, 2, 3].map((n) => `DOC-CARD-${prefix}-${n}`);
  const categoryId = `CAT-CARD-${prefix}`;
  const subCategoryId = `SUBCAT-CARD-${prefix}`;
  const courseIds = {
    BOTOX: `COURSE-CARD-${prefix}-BOTOX`,
    FILLER: `COURSE-CARD-${prefix}-FILLER`,
  };
  const courseItemIds = {
    BOTOX: `COURSE-ITEM-CARD-${prefix}-BOTOX`,
    FILLER: `COURSE-ITEM-CARD-${prefix}-FILLER`,
  };
  const paymentMethodId = `PAYMENT-CARD-${prefix}-TRANSFER`;

  const startedFixtureEncounter = await prisma.opd_encounter.findFirst({
    where: {
      clinic_id: clinicId,
      branch_id: branchId,
      OR: [
        { appointment_id: { in: mockAppIds } },
        { customer_id: { in: mockCustomerIds } },
      ],
    },
    select: { encounter_id: true },
  });
  if (startedFixtureEncounter) {
    throw new Error(
      `Refusing fixture refresh because OPD encounter ${startedFixtureEncounter.encounter_id} exists for mock clinical data`,
    );
  }
  const stableFixtureTickets = await prisma.opd_queue_ticket.findMany({
    where: {
      clinic_id: clinicId,
      branch_id: branchId,
      appointment_id: { in: mockAppIds },
      source_type: "APPOINTMENT",
    },
    select: { appointment_id: true },
  });
  const stableFixtureAppointmentIds = stableFixtureTickets.flatMap((ticket) =>
    ticket.appointment_id ? [ticket.appointment_id] : [],
  );
  const stableFixtureAppointments = await prisma.appointment.findMany({
    where: {
      clinic_id: clinicId,
      branch_id: branchId,
      appointment_id: { in: stableFixtureAppointmentIds },
    },
    select: { opd_id: true },
  });
  const stableFixtureLegacyOpdIds = stableFixtureAppointments.flatMap(
    (appointment) => (appointment.opd_id ? [appointment.opd_id] : []),
  );

  // 3) Clean existing seed operational data for this branch safely
  await prisma.sale_order_item.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_course_usage_log.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_coures.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.sale_order.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.wallet_log.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_wallet.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.documents_signed_customer.deleteMany({
    where: { clinic_id: clinicId, customer_id: { in: mockCustomerIds } },
  });
  await prisma.customer_attendant.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_registration.deleteMany({ where: { branch_id: branchId } }).catch(() => {});

  // Safe delete appointments, OPDs, and customer references using target mock IDs
  await prisma.appointment.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { appointment_id: { in: mockAppIds } },
            { clinic_id: clinicId, customer_id: { in: mockCustomerIds } },
          ],
        },
        { appointment_id: { notIn: stableFixtureAppointmentIds } },
      ],
    },
  });
  await prisma.opd.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { opd_id: { in: mockOpdIds } },
            { clinic_id: clinicId, customer_id: { in: mockCustomerIds } },
          ],
        },
        { opd_id: { notIn: stableFixtureLegacyOpdIds } },
      ],
    },
  });
  await prisma.customer_info.deleteMany({
    where: { customer_id: { in: mockCustomerIds } },
  });
  await prisma.customer.deleteMany({
    where: { customer_id: { in: mockCustomerIds } },
  }).catch(() => {});

  // 4) Ensure customer-card master data exists
  for (const group of [
    { id: "GENERAL", name: "ทั่วไป", discount: 0, minimum: 0, color: "#9CA3AF", order: 1 },
    { id: "GOLD", name: "Gold", discount: 10, minimum: 50000, color: "#F59E0B", order: 2 },
    { id: "PLATINUM", name: "Platinum", discount: 15, minimum: 100000, color: "#64748B", order: 3 },
  ]) {
    await prisma.customer_group.upsert({
      where: { group_id: group.id },
      update: {
        group_name: group.name,
        clinic_id: clinicId,
        status: record_status.ACTIVE,
        discount: group.discount,
        minimum_balance: group.minimum,
        color_group: group.color,
        order: group.order,
      },
      create: {
        group_id: group.id,
        group_name: group.name,
        clinic_id: clinicId,
        discount: group.discount,
        minimum_balance: group.minimum,
        color_group: group.color,
        auto_promote: false,
        require_access: false,
        discount_type: discount_type.PERCENT,
        status: record_status.ACTIVE,
        order: group.order,
        no_expiration: true,
        created_at: now,
        updated_at: now,
      },
    });
  }

  await prisma.clinic_payment_method.upsert({
    where: { clinic_payment_method_id: paymentMethodId },
    update: { status: record_status.ACTIVE },
    create: {
      clinic_payment_method_id: paymentMethodId,
      branch_id: branchId,
      name: "โอนเงิน",
      payment_type: clinic_payment_type.TRANSFER,
      status: record_status.ACTIVE,
      created_by: adminUserId,
      code: `CARD-${prefix}`,
      created_at: now,
      updated_at: now,
    },
  });

  for (const [index, docId] of consentDocIds.entries()) {
    await prisma.documents_signed.upsert({
      where: { doc_id: docId },
      update: { status: record_status.ACTIVE },
      create: {
        doc_id: docId,
        clinic_id: clinicId,
        document_name: ["แบบยินยอมรักษา", "PDPA", "แบบยินยอมหัตถการ"][index],
        purpose_use: "customer-card-mock",
        document_type: document_type.USER_ADD,
        expiration_period: "365",
        document_url: ONE_PIXEL_PNG,
        position_sign: "[]",
        status: record_status.ACTIVE,
        created_at: now,
        updated_at: now,
      },
    });
  }

  await prisma.category.upsert({
    where: { category_id: categoryId },
    update: { status: record_status.ACTIVE },
    create: {
      category_id: categoryId,
      clinic_id: clinicId,
      name: "Aesthetic Course Mock",
      product_category: all_product_category.COURSE,
      status: record_status.ACTIVE,
      code: `CARD-${prefix}`,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.sub_category.upsert({
    where: { sub_category_id: subCategoryId },
    update: { status: record_status.ACTIVE },
    create: {
      sub_category_id: subCategoryId,
      clinic_id: clinicId,
      name: "Injectable Mock",
      product_category: all_product_category.COURSE,
      status: record_status.ACTIVE,
      code: `CARD-${prefix}`,
      created_at: now,
      updated_at: now,
    },
  });

  for (const course of [
    { key: "BOTOX" as const, name: "Botox", price: 12000, amount: 5 },
    { key: "FILLER" as const, name: "Filler", price: 15000, amount: 3 },
  ]) {
    await prisma.course.upsert({
      where: { course_id: courseIds[course.key] },
      update: { status: record_status.ACTIVE },
      create: {
        course_id: courseIds[course.key],
        course_id_display: `${prefix}-${course.key}`,
        branch_id: branchId,
        category_id: categoryId,
        sub_category_id: subCategoryId,
        course_name: course.name,
        expire_in: 365,
        is_global: true,
        status: record_status.ACTIVE,
        maximum_discount: 0,
        maximum_discount_unit: amount_unit.PERCENT,
        product_type: product_type.SALE,
        doc_id: consentDocIds[2],
        created_at: now,
        updated_at: now,
      },
    });

    await prisma.course_item.upsert({
      where: { course_item_id: courseItemIds[course.key] },
      update: { status: record_status.ACTIVE },
      create: {
        course_item_id: courseItemIds[course.key],
        course_id: courseIds[course.key],
        unit: "ครั้ง",
        name: course.name,
        price: course.price,
        amount: course.amount,
        vat: vat_type.NO_VAT,
        created_by: adminUserId,
        status: record_status.ACTIVE,
        created_at: now,
        updated_at: now,
      },
    });
  }

  // 4) Create Mock Customers
  const customerData: MockCustomer[] = [
    {
      id: `CUST-${prefix}-01`,
      name: "พิมพ์ใจ",
      lastname: "ใจดี",
      nickname: "มายด์",
      gender: "female",
      personal_id: `HN${prefix}00637`,
      status_vip: false,
      allergy: "Penicillin",
      birth_date: "1998-05-15",
      phone_number: "080-000-0000",
      line_id: `mind-${prefix.toLowerCase()}`,
      customer_group: "GENERAL",
      points_old: 900,
      points_current: 340,
      outstanding: 6800,
      deposit: 6000,
      credit: 2500,
      consentSigned: 3,
      consentTotal: 3,
      courses: [
        { itemKey: "BOTOX", used: 2, total: 5 },
        { itemKey: "FILLER", used: 1, total: 3 },
      ],
    },
    {
      id: `CUST-${prefix}-02`,
      name: "อนัญญา",
      lastname: "ประเสริฐ",
      nickname: "ญา",
      gender: "female",
      personal_id: `HN${prefix}00638`,
      status_vip: true,
      allergy: "",
      birth_date: "1992-11-20",
      phone_number: "081-222-0000",
      line_id: `anya-${prefix.toLowerCase()}`,
      customer_group: "PLATINUM",
      points_old: 1600,
      points_current: 420,
      outstanding: 6800,
      deposit: 6000,
      credit: 2500,
      consentSigned: 0,
      consentTotal: 3,
      courses: [
        { itemKey: "BOTOX", used: 2, total: 5 },
        { itemKey: "FILLER", used: 1, total: 3 },
      ],
    },
    {
      id: `CUST-${prefix}-03`,
      name: "ธนัง",
      lastname: "คิม",
      nickname: "ต้น",
      gender: "male",
      personal_id: `HN${prefix}00639`,
      status_vip: false,
      allergy: "Aspirin, NSAIDs",
      birth_date: "1989-02-02",
      phone_number: "082-333-0000",
      line_id: null,
      customer_group: "GOLD",
      points_old: 700,
      points_current: 180,
      outstanding: 0,
      deposit: 6000,
      credit: 2500,
      consentSigned: 3,
      consentTotal: 3,
      courses: [
        { itemKey: "BOTOX", used: 1, total: 5 },
        { itemKey: "FILLER", used: 0, total: 3 },
      ],
    },
    {
      id: `CUST-${prefix}-04`,
      name: "ชนิตา",
      lastname: "ปาร์ค",
      nickname: "แนน",
      gender: "female",
      personal_id: `HN${prefix}00640`,
      status_vip: false,
      allergy: "",
      birth_date: "1996-08-09",
      phone_number: "083-444-0000",
      line_id: `nan-${prefix.toLowerCase()}`,
      customer_group: "GENERAL",
      points_old: 200,
      points_current: 95,
      outstanding: 2400,
      deposit: 3000,
      credit: 1200,
      consentSigned: 2,
      consentTotal: 3,
      courses: [{ itemKey: "FILLER", used: 1, total: 3 }],
    },
    {
      id: `CUST-${prefix}-05`,
      name: "พลอย",
      lastname: "รัตนา",
      nickname: "พลอย",
      gender: "female",
      personal_id: `HN${prefix}00641`,
      status_vip: true,
      allergy: "Sulfa",
      birth_date: "1986-12-01",
      phone_number: "084-555-0000",
      line_id: `ploy-${prefix.toLowerCase()}`,
      customer_group: "PLATINUM",
      points_old: 2100,
      points_current: 760,
      outstanding: 0,
      deposit: 10000,
      credit: 7600,
      consentSigned: 3,
      consentTotal: 3,
      courses: [{ itemKey: "BOTOX", used: 4, total: 5 }],
    },
    {
      id: `CUST-${prefix}-06`,
      name: "กฤษต",
      lastname: "สมหวัง",
      nickname: "กิ๊ก",
      gender: "male",
      personal_id: `HN${prefix}00642`,
      status_vip: false,
      allergy: "",
      birth_date: "1999-04-30",
      phone_number: "085-666-0000",
      line_id: null,
      customer_group: "GENERAL",
      points_old: 80,
      points_current: 25,
      outstanding: 0,
      deposit: 0,
      credit: 0,
      consentSigned: 1,
      consentTotal: 3,
      courses: [],
    },
    {
      id: `CUST-${prefix}-07`,
      name: "สุภาพร",
      lastname: "วิริยะ",
      nickname: "พร",
      gender: "female",
      personal_id: `HN${prefix}00643`,
      status_vip: true,
      allergy: "Ibuprofen",
      birth_date: "1990-01-18",
      phone_number: "086-777-0000",
      line_id: `porn-${prefix.toLowerCase()}`,
      customer_group: "GOLD",
      points_old: 1300,
      points_current: 520,
      outstanding: 12500,
      deposit: 5000,
      credit: 5000,
      consentSigned: 0,
      consentTotal: 3,
      courses: [
        { itemKey: "BOTOX", used: 0, total: 5 },
        { itemKey: "FILLER", used: 2, total: 3 },
      ],
    },
    {
      id: `CUST-${prefix}-08`,
      name: "ธนวัฒน์",
      lastname: "สุขใจ",
      nickname: "วัฒน์",
      gender: "male",
      personal_id: `HN${prefix}00644`,
      status_vip: false,
      allergy: "",
      birth_date: "1994-07-07",
      phone_number: "087-888-0000",
      line_id: `wat-${prefix.toLowerCase()}`,
      customer_group: "GENERAL",
      points_old: 400,
      points_current: 160,
      outstanding: 0,
      deposit: 2500,
      credit: 900,
      consentSigned: 3,
      consentTotal: 3,
      courses: [{ itemKey: "BOTOX", used: 3, total: 5 }],
    },
  ];

  for (const [index, c] of customerData.entries()) {
    const customerRecord = {
      branch_id: branchId,
      title: c.gender === "male" ? "นาย" : "นางสาว",
      name: c.name,
      lastname: c.lastname,
      nickname: c.nickname,
      gender: c.gender,
      birth_date: c.birth_date,
      personal_id: c.personal_id,
      phone_number: c.phone_number,
      line_id: c.line_id,
      customer_status: true,
      status_vip: c.status_vip,
      customer_group: c.customer_group,
      attendant: index % 2 === 0 ? doctorUserId : adminUserId,
      point_accumulate_all_old: c.points_old,
      point_current_year: c.points_current,
      user_create: adminUserId,
      updated_at: now,
    };

    await prisma.customer.upsert({
      where: { customer_id_clinic_id: { customer_id: c.id, clinic_id: clinicId } },
      update: customerRecord,
      create: {
        ...customerRecord,
        customer_id: c.id,
        clinic_id: clinicId,
        created_at: addDays(now, -index * 7),
      },
    });

    if (c.allergy) {
      await prisma.customer_info.create({
        data: {
          customer_id: c.id,
          clinic_id: clinicId,
          allergy: c.allergy,
          created_at: now,
          updated_at: now,
        },
      });
    }

    await prisma.customer_attendant.create({
      data: {
        user_id: index % 2 === 0 ? doctorUserId : adminUserId,
        customer_id: c.id,
        branch_id: branchId,
        clinic_id: clinicId,
        user_create: adminUserId,
        status: record_status.ACTIVE,
        created_at: now,
      },
    });

    for (const [docIndex, docId] of consentDocIds.entries()) {
      await prisma.documents_signed_customer.create({
        data: {
          doc_id: docId,
          clinic_id: clinicId,
          customer_id: c.id,
          document_url: docIndex < c.consentSigned ? ONE_PIXEL_PNG : null,
          status: docIndex < c.consentSigned ? document_status.SIGNED : document_status.UNSIGNED,
          exp: addDays(now, 365),
          created_at: now,
          updated_at: now,
        },
      });
    }

    if (c.deposit > 0) {
      const walletTransId = `WALLET-CARD-${prefix}-${String(index + 1).padStart(2, "0")}`;
      await prisma.customer_wallet.create({
        data: {
          trans_id: walletTransId,
          branch_id: branchId,
          clinic_id: clinicId,
          customer_id: c.id,
          date: now,
          payment_method_id: paymentMethodId,
          amount: c.deposit,
          bonus: 0,
          seller_id: adminUserId,
          cashier_id: adminUserId,
          remark: "mock deposit for customer card",
          evidence: ONE_PIXEL_PNG,
          status: record_status.ACTIVE,
          created_by: adminUserId,
          created_at: now,
          updated_at: now,
        },
      });

      await prisma.wallet_log.create({
        data: {
          wallet_log_id: `WALLET-LOG-IN-${prefix}-${String(index + 1).padStart(2, "0")}`,
          branch_id: branchId,
          clinic_id: clinicId,
          reference_id: walletTransId,
          customer_id: c.id,
          in: c.deposit,
          out: 0,
          type: wallet_type.NORMAL,
          created_at: now,
          updated_at: now,
        },
      });

      const spent = c.deposit - c.credit;
      if (spent > 0) {
        await prisma.wallet_log.create({
          data: {
            wallet_log_id: `WALLET-LOG-OUT-${prefix}-${String(index + 1).padStart(2, "0")}`,
            branch_id: branchId,
            clinic_id: clinicId,
            reference_id: `MOCK-SPEND-${prefix}-${String(index + 1).padStart(2, "0")}`,
            customer_id: c.id,
            in: 0,
            out: spent,
            type: wallet_type.NORMAL,
            created_at: now,
            updated_at: now,
          },
        });
      }
    }

    if (c.outstanding > 0) {
      const saleOrderId = `SO-DUE-CARD-${prefix}-${String(index + 1).padStart(2, "0")}`;
      const saleOrderRecord = {
        clinic_id: clinicId,
        customer_id: c.id,
        total: c.outstanding,
        promotion_discount: 0,
        customer_discount: 0,
        voucher_discount: 0,
        extra_discount: 0,
        subtotal: c.outstanding,
        round_decimal: false,
        totalDue: c.outstanding,
        remark: "mock outstanding balance for customer card",
        sale_order_status: sale_order_status.PENDING,
        status: record_status.ACTIVE,
        date: now,
        created_by: adminUserId,
        updated_at: now,
      };
      await prisma.sale_order.upsert({
        where: { sale_order_id_branch_id: { sale_order_id: saleOrderId, branch_id: branchId } },
        update: saleOrderRecord,
        create: {
          ...saleOrderRecord,
          sale_order_id: saleOrderId,
          branch_id: branchId,
          created_at: now,
        },
      });
    }

    if (c.courses.length > 0) {
      const saleOrderId = `SO-COURSE-CARD-${prefix}-${String(index + 1).padStart(2, "0")}`;
      const subtotal = c.courses.reduce((sum, course) => {
        return sum + (course.itemKey === "BOTOX" ? 12000 : 15000);
      }, 0);

      const saleOrderRecord = {
        clinic_id: clinicId,
        customer_id: c.id,
        total: subtotal,
        promotion_discount: 0,
        customer_discount: 0,
        voucher_discount: 0,
        extra_discount: 0,
        subtotal,
        round_decimal: false,
        totalDue: 0,
        remark: "mock course purchase for customer card",
        sale_order_status: sale_order_status.PAID,
        status: record_status.ACTIVE,
        date: now,
        created_by: adminUserId,
        updated_at: now,
      };
      await prisma.sale_order.upsert({
        where: { sale_order_id_branch_id: { sale_order_id: saleOrderId, branch_id: branchId } },
        update: saleOrderRecord,
        create: {
          ...saleOrderRecord,
          sale_order_id: saleOrderId,
          branch_id: branchId,
          created_at: now,
        },
      });

      for (const course of c.courses) {
        const expireDate = addDays(now, 365 + index);
        await prisma.customer_coures.create({
          data: {
            sale_order_id: saleOrderId,
            customer_id: c.id,
            branch_id: branchId,
            clinic_id: clinicId,
            item_id: courseItemIds[course.itemKey],
            amount: course.total,
            expire_date: expireDate,
            expire_date_display: expireDate,
            created_at: now,
            updated_at: now,
          },
        });

        if (course.used > 0) {
          await prisma.customer_course_usage_log.create({
            data: {
              id: `COURSE-USE-CARD-${prefix}-${String(index + 1).padStart(2, "0")}-${course.itemKey}`,
              service_usage_id: `MOCK-USAGE-${prefix}-${String(index + 1).padStart(2, "0")}`,
              customer_id: c.id,
              branch_id: branchId,
              clinic_id: clinicId,
              item_id: courseItemIds[course.itemKey],
              amount: course.used,
              status: usage_log_status.USED,
              expire_date: expireDate,
              created_at: now,
              updated_at: now,
            },
          });
        }
      }
    }
  }

  // 5) Create Today's Queue (Appointments with today's date)
  const todayAppointments = [
    { id: `APP-TODAY-${prefix}-01`, customerId: `CUST-${prefix}-01`, time: "09:00", status: statusAppointment.SUCCESS, isConsult: false, applyAnesthetic: false, room: `ROOM-${prefix}-ตรวจสุขภาพทั่วไป`, detail: "Botox Follow-up 50u" },
    { id: `APP-TODAY-${prefix}-02`, customerId: `CUST-${prefix}-02`, time: "09:15", status: statusAppointment.IN_SERVICE, isConsult: true, applyAnesthetic: false, room: `ROOM-${prefix}-ทันตกรรม`, detail: "Skin Consultation (ครั้งแรก)" },
    { id: `APP-TODAY-${prefix}-03`, customerId: `CUST-${prefix}-03`, time: "09:30", status: statusAppointment.CONFIRM, isConsult: false, applyAnesthetic: true, room: `ROOM-${prefix}-Botox`, detail: "Review Lab + HIFU Progress" },
    { id: `APP-TODAY-${prefix}-04`, customerId: `CUST-${prefix}-04`, time: "09:45", status: statusAppointment.SUCCESS, isConsult: false, applyAnesthetic: false, room: `ROOM-${prefix}-ตรวจสุขภาพทั่วไป`, detail: "Filler Lips + Chin" },
    { id: `APP-TODAY-${prefix}-05`, customerId: `CUST-${prefix}-05`, time: "10:00", status: statusAppointment.CONFIRM, isConsult: true, applyAnesthetic: false, room: `ROOM-${prefix}-Laser`, detail: "Laser treatment" },
    { id: `APP-TODAY-${prefix}-06`, customerId: `CUST-${prefix}-06`, time: "10:15", status: statusAppointment.APPOINT, isConsult: false, applyAnesthetic: true, room: `ROOM-${prefix}-ตรวจสุขภาพทั่วไป`, detail: "Dental checkup" },
    { id: `APP-TODAY-${prefix}-07`, customerId: `CUST-${prefix}-07`, time: "10:30", status: statusAppointment.SUCCESS, isConsult: false, applyAnesthetic: false, room: `ROOM-${prefix}-Botox`, detail: "Botox Review" },
    { id: `APP-TODAY-${prefix}-08`, customerId: `CUST-${prefix}-08`, time: "10:45", status: statusAppointment.SUCCESS, isConsult: false, applyAnesthetic: false, room: `ROOM-${prefix}-Laser`, detail: "Acne Laser treatment" },
  ];

  for (const app of todayAppointments) {
    let opdId: string | null = null;
    if (app.status === statusAppointment.SUCCESS || app.status === statusAppointment.IN_SERVICE) {
      opdId = `OPD-${app.id}`;
      const opdRecord = {
          clinic_id: clinicId,
          customer_id: app.customerId,
          user_create: doctorUserId,
          chief_complaint: "มาตรวจสุขภาพประจำปี / ทำหัตถการตามนัดหมาย",
          diagnosis: "ตรวจปกติ / ดำเนินการเสร็จสมบูรณ์",
          details: "ทำความสะอาดฟัน / เลเซอร์เลือนริ้วรอย / แปะยาเรียบร้อย",
          room: app.room,
          status_opd: app.status === statusAppointment.SUCCESS ? opdStatus.SUCCESS : opdStatus.PENDING,
          opd_date: now,
          bt: 36.5,
          bp: 120,
          pr: 75,
          rr: 16,
          bmi: 22.1,
          weight: 65,
          height: 171,
        updated_at: now,
      };
      await prisma.opd.upsert({
        where: {
          opd_id_branch_id: { opd_id: opdId, branch_id: branchId },
        },
        update: opdRecord,
        create: {
          ...opdRecord,
          opd_id: opdId,
          branch_id: branchId,
          created_at: now,
        },
      });
    }

    const appointmentRecord = {
      branch_id: branchId,
      clinic_id: clinicId,
      customer_id: app.customerId,
      user_create: adminUserId,
      room: app.room,
      date_appointment: todayStr,
      time_arrive: app.time,
      start_time: app.time,
      end_time: app.time,
      is_consult: app.isConsult,
      apply_anesthetic: app.applyAnesthetic,
      status_appointment: app.status,
      appointment_detail: app.detail,
      opd_id: opdId,
      updated_at: now,
    };
    await prisma.$transaction(async (tx) => {
      await tx.appointment.upsert({
        where: { appointment_id: app.id },
        update: appointmentRecord,
        create: {
          ...appointmentRecord,
          appointment_id: app.id,
          created_at: now,
        },
      });
      await syncFixtureAppointmentTicket(tx, {
        clinicId,
        branchId,
        appointmentId: app.id,
        customerId: app.customerId,
        businessDate: todayStr,
      });
    });
  }

  // 6) Create Future Appointments (for the Appointments module)
  const futureAppointments = [
    { id: `APP-FUTURE-${prefix}-01`, customerId: `CUST-${prefix}-01`, date: tomorrowStr, time: "10:00", room: `ROOM-${prefix}-ตรวจผิวหนัง`, detail: "Review Lab" },
    { id: `APP-FUTURE-${prefix}-02`, customerId: `CUST-${prefix}-03`, date: tomorrowStr, time: "13:30", room: `ROOM-${prefix}-Laser`, detail: "Skin Consultation" },
    { id: `APP-FUTURE-${prefix}-03`, customerId: `CUST-${prefix}-05`, date: nextWeekStr, time: "11:00", room: `ROOM-${prefix}-Botox`, detail: "Botox Follow-up" },
    { id: `APP-FUTURE-${prefix}-04`, customerId: `CUST-${prefix}-07`, date: nextWeekStr, time: "15:00", room: `ROOM-${prefix}-ทันตกรรม`, detail: "Dental Treatment" },
  ];

  for (const app of futureAppointments) {
    const appointmentRecord = {
      branch_id: branchId,
      clinic_id: clinicId,
      customer_id: app.customerId,
      user_create: adminUserId,
      room: app.room,
      date_appointment: app.date,
      time_arrive: app.time,
      start_time: app.time,
      end_time: app.time,
      is_consult: false,
      apply_anesthetic: false,
      status_appointment: statusAppointment.APPOINT,
      appointment_detail: app.detail,
      opd_id: null,
      updated_at: now,
    };
    await prisma.$transaction(async (tx) => {
      await tx.appointment.upsert({
        where: { appointment_id: app.id },
        update: appointmentRecord,
        create: {
          ...appointmentRecord,
          appointment_id: app.id,
          created_at: now,
        },
      });
      await syncFixtureAppointmentTicket(tx, {
        clinicId,
        branchId,
        appointmentId: app.id,
        customerId: app.customerId,
        businessDate: app.date,
      });
    });
  }
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  
  // Future dates
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  
  const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const nextWeekStr = nextWeek.toISOString().slice(0, 10);

  console.log("🌱 Starting seed database...");

  await seedAppointmentReferenceOptions(now);

  // 1) Ensure document_form exists
  await prisma.document_form.upsert({
    where: { form_id: "FORM-UAT" },
    update: {},
    create: {
      form_id: "FORM-UAT",
      name: "UAT Form",
      preview: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=",
      created_at: now,
      updated_at: now,
    },
  });

  // ================= CLINIC 1: CLINIC-UAT =================
  const uatClinicId = "CLINIC-UAT";
  const uatBranchId = "BR-UAT-SRC";
  const uatAdminId = "UAT-ADMIN-USER";
  const uatDoctorId = "UAT-DOCTOR-USER";
  const uatNurseId = "UAT-NURSE-USER";

  // Ensure Clinic exists
  await prisma.clinic.upsert({
    where: { clinic_id: uatClinicId },
    update: { status: record_status.ACTIVE },
    create: {
      clinic_id: uatClinicId,
      clinic_name: "HealthX Clinic UAT",
      tel: "020000000",
      email: "clinic-source@example.com",
      status: record_status.ACTIVE,
      is_sync_with_erp: false,
      is_upload_image_course: false,
      status_send_password: false,
      created_at: now,
      updated_at: now,
    },
  });

  // Ensure Branch exists
  await prisma.branch.upsert({
    where: { branch_id: uatBranchId },
    update: { status: record_status.ACTIVE },
    create: {
      branch_id: uatBranchId,
      branch_name: "สาขา พระราม9",
      type_branch: type_branch.NORMAL,
      branch_no: "001",
      clinic_id: uatClinicId,
      branch_logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=",
      tel: "020000000",
      license_no: "LIC-UAT",
      email: "branch-uat@example.com",
      line_id: "-",
      address: "1 UAT Street",
      sub_district: "Sub",
      district: "Dist",
      province: "Bangkok",
      postcode: "10110",
      status: record_status.ACTIVE,
      round_decimal: false,
      sales_tax: vat_type.NO_VAT,
      purchase_tax: vat_type.NO_VAT,
      condition_wallet: condition_wallet_enum.AFTER_REDEEM,
      percent_commission: 0,
      document_form_id: "FORM-UAT",
      is_upload_image_course: false,
      created_at: now,
      updated_at: now,
    },
  });

  // Ensure Roles exist
  await prisma.role.upsert({
    where: { role_id: role_enum.ADMIN },
    update: { status: record_status.ACTIVE },
    create: {
      role_id: role_enum.ADMIN,
      role_description_EN: "Administrator",
      status: record_status.ACTIVE,
      operable: true,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.role.upsert({
    where: { role_id: role_enum.NURSE },
    update: { status: record_status.ACTIVE },
    create: {
      role_id: role_enum.NURSE,
      role_description_EN: "Nurse",
      status: record_status.ACTIVE,
      operable: true,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.role.upsert({
    where: { role_id: role_enum.THERAPIST },
    update: { status: record_status.ACTIVE },
    create: {
      role_id: role_enum.THERAPIST,
      role_description_EN: "Therapist",
      status: record_status.ACTIVE,
      operable: true,
      created_at: now,
      updated_at: now,
    },
  });
  
  await prisma.role.upsert({
    where: { role_id: role_enum.DOCTOR },
    update: { status: record_status.ACTIVE },
    create: {
      role_id: role_enum.DOCTOR,
      role_description_EN: "Doctor",
      status: record_status.ACTIVE,
      operable: true,
      created_at: now,
      updated_at: now,
    },
  });

  // Ensure Users exist
  await prisma.user.upsert({
    where: { user_id: uatAdminId },
    update: { hash_password: passwordHash, status: record_status.ACTIVE },
    create: {
      user_id: uatAdminId,
      clinic_id: uatClinicId,
      email: EMAIL,
      title: "นพ.",
      name: "สมชาย",
      lastname: "ใจดี",
      nickname: "หมอสมชาย",
      hash_password: passwordHash,
      status: record_status.ACTIVE,
      is_clinic_root_user: true,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.user.upsert({
    where: { user_id: uatNurseId },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: uatNurseId,
      clinic_id: uatClinicId,
      email: "nurse.test@healthx.local",
      title: "พว.",
      name: "แอน",
      lastname: "ใจดี",
      nickname: "แอน",
      hash_password: passwordHash,
      status: record_status.ACTIVE,
      is_clinic_root_user: false,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.user.upsert({
    where: { user_id: uatDoctorId },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: uatDoctorId,
      clinic_id: uatClinicId,
      email: "doctor.test@healthx.local",
      title: "พญ.",
      name: "นิภา",
      lastname: "รักสุข",
      nickname: "หมอนิภา",
      hash_password: passwordHash,
      status: record_status.ACTIVE,
      is_clinic_root_user: false,
      created_at: now,
      updated_at: now,
    },
  });

  // Link Users to Branch
  await prisma.user_branch.upsert({
    where: { user_id_branch_id: { user_id: uatAdminId, branch_id: uatBranchId } },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: uatAdminId,
      branch_id: uatBranchId,
      role_id: role_enum.ADMIN,
      status: record_status.ACTIVE,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.user_branch.upsert({
    where: { user_id_branch_id: { user_id: uatNurseId, branch_id: uatBranchId } },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: uatNurseId,
      branch_id: uatBranchId,
      role_id: role_enum.NURSE,
      status: record_status.ACTIVE,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.user_branch.upsert({
    where: { user_id_branch_id: { user_id: uatDoctorId, branch_id: uatBranchId } },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: uatDoctorId,
      branch_id: uatBranchId,
      role_id: role_enum.DOCTOR,
      status: record_status.ACTIVE,
      created_at: now,
      updated_at: now,
    },
  });

  // Seed the UAT branch
  await seedClinicAndBranch(
    uatClinicId,
    uatBranchId,
    uatAdminId,
    uatDoctorId,
    "UAT",
    now,
    todayStr,
    tomorrowStr,
    nextWeekStr
  );

  // ================= CLINIC 2: THE RITZ CLINIC =================
  const ritzClinicId = "d02fe812-5519-4e79-92b1-2a749f23695a";
  const ritzBranchId = "76d8b237-ae8f-49d5-b793-91f75f80b5e5"; // สำนักงานใหญ่
  const ritzAdminId = "test-admin-cc61abae-afa5-4807-b3a6-01f649061fca";
  const ritzDoctorId = "16a69f4c-317d-40d9-a503-403befbae363";
  const ritzNurseId = "RITZ-NURSE-USER";

  // Ensure branch relationship is active for doctor in Ritz Clinic
  await prisma.user_branch.upsert({
    where: { user_id_branch_id: { user_id: ritzDoctorId, branch_id: ritzBranchId } },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: ritzDoctorId,
      branch_id: ritzBranchId,
      role_id: role_enum.DOCTOR,
      status: record_status.ACTIVE,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.user.upsert({
    where: { user_id: ritzNurseId },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: ritzNurseId,
      clinic_id: ritzClinicId,
      email: "nurse.ritz@healthx.local",
      title: "พว.",
      name: "แอน",
      lastname: "ริทซ์",
      nickname: "Ann",
      hash_password: passwordHash,
      status: record_status.ACTIVE,
      is_clinic_root_user: false,
      created_at: now,
      updated_at: now,
    },
  });

  await prisma.user_branch.upsert({
    where: { user_id_branch_id: { user_id: ritzNurseId, branch_id: ritzBranchId } },
    update: { status: record_status.ACTIVE },
    create: {
      user_id: ritzNurseId,
      branch_id: ritzBranchId,
      role_id: role_enum.NURSE,
      status: record_status.ACTIVE,
      created_at: now,
      updated_at: now,
    },
  });

  // Seed THE RITZ CLINIC branch
  await seedClinicAndBranch(
    ritzClinicId,
    ritzBranchId,
    ritzAdminId,
    ritzDoctorId,
    "RITZ",
    now,
    todayStr,
    tomorrowStr,
    nextWeekStr
  );

  console.log("✅ Seed database complete!");
}

main()
  .catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

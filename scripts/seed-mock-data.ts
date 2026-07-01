import { randomUUID } from "crypto";
import * as argon2 from "argon2";
import { PrismaClient, record_status, role_enum, type_branch, vat_type, condition_wallet_enum, statusAppointment, opdStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/healthx_optionb_test?schema=public";
const EMAIL = "admin.test@healthx.local";
const PASSWORD = "Admin@1234";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

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

  // 3) Clean existing seed operational data for this branch safely
  await prisma.sale_order_item.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.sale_order.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_course_usage_log.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_coures.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.wallet_log.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_wallet.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_attendant.deleteMany({ where: { branch_id: branchId } }).catch(() => {});
  await prisma.customer_registration.deleteMany({ where: { branch_id: branchId } }).catch(() => {});

  // Safe delete appointments, OPDs, and customer references using target mock IDs
  await prisma.appointment.deleteMany({
    where: { appointment_id: { in: mockAppIds } },
  });
  await prisma.opd.deleteMany({
    where: { opd_id: { in: mockOpdIds } },
  });
  await prisma.customer_info.deleteMany({
    where: { customer_id: { in: mockCustomerIds } },
  });
  await prisma.customer.deleteMany({
    where: { customer_id: { in: mockCustomerIds } },
  });

  // 4) Create Mock Customers
  const customerData = [
    { id: `CUST-${prefix}-01`, name: "สมชาย", lastname: "ใจดี", nickname: "ชาย", gender: "male", personal_id: `HN-${prefix}-12345`, status_vip: false, allergy: "Penicillin" },
    { id: `CUST-${prefix}-02`, name: "อนัญญา", lastname: "ประเสริฐ", nickname: "ญา", gender: "female", personal_id: `HN-${prefix}-12346`, status_vip: true, allergy: "" },
    { id: `CUST-${prefix}-03`, name: "ธนัง", lastname: "คิม", nickname: "ต้น", gender: "male", personal_id: `HN-${prefix}-12347`, status_vip: false, allergy: "Aspirin, NSAIDs" },
    { id: `CUST-${prefix}-04`, name: "ชนิตา", lastname: "ปาร์ค", nickname: "แนน", gender: "female", personal_id: `HN-${prefix}-12348`, status_vip: false, allergy: "" },
    { id: `CUST-${prefix}-05`, name: "พลอย", lastname: "รัตนา", nickname: "พลอย", gender: "female", personal_id: `HN-${prefix}-12349`, status_vip: true, allergy: "Sulfa" },
    { id: `CUST-${prefix}-06`, name: "กฤษต", lastname: "สมหวัง", nickname: "กิ๊ก", gender: "male", personal_id: `HN-${prefix}-12350`, status_vip: false, allergy: "" },
    { id: `CUST-${prefix}-07`, name: "สุภาพร", lastname: "วิริยะ", nickname: "พร", gender: "female", personal_id: `HN-${prefix}-12351`, status_vip: true, allergy: "Ibuprofen" },
    { id: `CUST-${prefix}-08`, name: "ธนวัฒน์", lastname: "สุขใจ", nickname: "วัฒน์", gender: "male", personal_id: `HN-${prefix}-12352`, status_vip: false, allergy: "" },
  ];

  for (const c of customerData) {
    await prisma.customer.create({
      data: {
        customer_id: c.id,
        clinic_id: clinicId,
        branch_id: branchId,
        title: c.gender === "male" ? "นาย" : "นางสาว",
        name: c.name,
        lastname: c.lastname,
        nickname: c.nickname,
        gender: c.gender,
        personal_id: c.personal_id,
        customer_status: true,
        status_vip: c.status_vip,
        user_create: adminUserId,
        created_at: now,
        updated_at: now,
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
      await prisma.opd.create({
        data: {
          opd_id: opdId,
          branch_id: branchId,
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
          created_at: now,
          updated_at: now,
        },
      });
    }

    await prisma.appointment.create({
      data: {
        appointment_id: app.id,
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
        created_at: now,
        updated_at: now,
      },
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
    await prisma.appointment.create({
      data: {
        appointment_id: app.id,
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
        created_at: now,
        updated_at: now,
      },
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

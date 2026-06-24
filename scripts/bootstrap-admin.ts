/**
 * One-off: bootstrap a test ADMIN user for local e2e against healthx_optionb_test.
 *
 * - Picks an ACTIVE clinic that has at least one ACTIVE branch.
 * - Upserts a `user` row (email + MD5 password, ACTIVE, is_clinic_root_user=true).
 * - Grants ADMIN role on every ACTIVE branch of that clinic via `user_branch`.
 *
 * Idempotent: re-running updates the same user (matched by email + clinic) and
 * re-asserts the password/role. Run from the backend dir:
 *   node --env-file=.env --import tsx scripts/bootstrap-admin.ts
 */
import { createHash, randomUUID } from "crypto";
import { PrismaClient, record_status, role_enum } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const EMAIL = "admin.test@healthx.local";
const PASSWORD = "Admin@1234";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const md5 = createHash("md5").update(Buffer.from(PASSWORD)).digest("hex");
  const now = new Date();

  // 1) Pick an ACTIVE clinic that has an ACTIVE branch.
  const branch = await prisma.branch.findFirst({
    where: { status: record_status.ACTIVE, clinic: { status: record_status.ACTIVE } },
    select: { branch_id: true, clinic_id: true, clinic: { select: { clinic_name: true } } },
    orderBy: { created_at: "asc" },
  });
  if (!branch) throw new Error("No ACTIVE clinic with an ACTIVE branch found.");
  const { clinic_id: clinicId } = branch;

  const activeBranches = await prisma.branch.findMany({
    where: { clinic_id: clinicId, status: record_status.ACTIVE },
    select: { branch_id: true, branch_name: true },
  });

  // 2) Ensure the ADMIN role row exists (FK target for user_branch).
  await prisma.role.upsert({
    where: { role_id: role_enum.ADMIN },
    update: {},
    create: {
      role_id: role_enum.ADMIN,
      role_description_EN: "Administrator",
      status: record_status.ACTIVE,
      operable: true,
      created_at: now,
      updated_at: now,
    },
  });

  // 3) Upsert the user (email is NOT unique → match on email + clinic).
  const existing = await prisma.user.findFirst({
    where: { email: EMAIL, clinic_id: clinicId },
    select: { user_id: true },
  });
  const userId = existing?.user_id ?? `test-admin-${randomUUID()}`;

  if (existing) {
    await prisma.user.update({
      where: { user_id: userId },
      data: {
        hash_password: md5,
        status: record_status.ACTIVE,
        is_clinic_root_user: true,
        updated_at: now,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        user_id: userId,
        clinic_id: clinicId,
        email: EMAIL,
        title: "",
        name: "Admin",
        lastname: "Test",
        nickname: "admin",
        hash_password: md5,
        status: record_status.ACTIVE,
        is_clinic_root_user: true,
        created_at: now,
        updated_at: now,
      },
    });
  }

  // 4) Grant ADMIN on every active branch (idempotent upsert on [user_id, branch_id]).
  for (const b of activeBranches) {
    await prisma.user_branch.upsert({
      where: { user_id_branch_id: { user_id: userId, branch_id: b.branch_id } },
      update: { role_id: role_enum.ADMIN, status: record_status.ACTIVE, updated_at: now },
      create: {
        user_id: userId,
        branch_id: b.branch_id,
        role_id: role_enum.ADMIN,
        status: record_status.ACTIVE,
        created_at: now,
        updated_at: now,
      },
    });
  }

  console.log("✅ Admin test user ready");
  console.log(JSON.stringify({
    email: EMAIL,
    password: PASSWORD,
    userId,
    clinicId,
    clinicName: branch.clinic?.clinic_name,
    branches: activeBranches.map((b) => ({ branchId: b.branch_id, branchName: b.branch_name })),
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("❌ bootstrap failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

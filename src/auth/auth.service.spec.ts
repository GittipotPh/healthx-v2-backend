import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash } from "crypto";
import { record_status } from "@prisma/client";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma.service";
import type { RefreshSessionService } from "./refresh-session.service";

function md5(password: string): string {
  return createHash("md5").update(Buffer.from(password)).digest("hex");
}

function user(overrides: Record<string, unknown>) {
  return {
    user_id: "user-1",
    email: "user@example.com",
    title: "",
    name: "User",
    lastname: "Example",
    clinic_id: "clinic-1",
    is_clinic_root_user: false,
    hash_password: "",
    clinic: { status: record_status.ACTIVE, clinic_name: "Clinic One" },
    ...overrides,
  };
}

function makeService(users: unknown[]) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(users),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
  const jwt = {
    signAsync: jest.fn().mockResolvedValue("access-token"),
  } as unknown as JwtService;
  const refreshSessions = {
    issue: jest.fn().mockResolvedValue("refresh-token"),
  } as unknown as RefreshSessionService;

  return {
    service: new AuthService(prisma, jwt, refreshSessions),
    prisma,
    jwt,
    refreshSessions,
  };
}

describe("AuthService", () => {
  it("logs in with Argon2 hashes without rewriting the password", async () => {
    const hash = await argon2.hash("secret", { type: argon2.argon2id });
    const { service, prisma } = makeService([user({ hash_password: hash })]);

    const result = await service.login("user@example.com", "secret");

    expect(result.accessToken).toBe("access-token");
    expect(result.refreshToken).toBe("refresh-token");
    expect(result.clinics).toHaveLength(1);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("allows legacy MD5 login and upgrades matching rows to Argon2", async () => {
    const { service, prisma } = makeService([
      user({ user_id: "user-1", hash_password: md5("secret") }),
      user({
        user_id: "user-2",
        clinic_id: "clinic-2",
        hash_password: md5("secret"),
      }),
    ]);

    await service.login("user@example.com", "secret");

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { user_id: { in: ["user-1", "user-2"] } },
      data: { hash_password: expect.stringMatching(/^\$argon2/) },
    });
  });

  it("rejects invalid passwords without issuing tokens or upgrading rows", async () => {
    const { service, prisma, jwt, refreshSessions } = makeService([
      user({ hash_password: md5("secret") }),
    ]);

    await expect(service.login("user@example.com", "wrong")).rejects.toThrow(
      UnauthorizedException,
    );

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(refreshSessions.issue).not.toHaveBeenCalled();
  });
});

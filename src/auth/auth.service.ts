import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import * as argon2 from "argon2";
import { record_status, type Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { RefreshSessionService } from "./refresh-session.service";
import type { JwtPrincipalPayload } from "./auth.types";

export interface LoginClinic {
  clinicId: string;
  clinicName: string;
  isClinicRootUser: boolean;
}

export interface LoginProfile {
  email: string;
  title: string;
  name: string;
  lastname: string;
}

/** Non-sensitive session payload returned to the browser (no token). */
export interface SessionResult {
  profile: LoginProfile;
  clinics: LoginClinic[];
}

/** Login/refresh add the tokens, which the controller turns into cookies. */
export interface LoginResult extends SessionResult {
  accessToken: string;
  refreshToken: string;
}

type UserWithClinic = Prisma.userGetPayload<{ include: { clinic: true } }>;

/**
 * Email is not unique on `user` — a person registered with several clinics has one
 * `user` row per clinic. Login matches all ACTIVE rows for (email, MD5 password),
 * issues a person-scoped token, and returns every clinic the person can enter.
 * Clinic/branch authorization itself happens per-request in ScopeGuard.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshSessions: RefreshSessionService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const candidates = await this.activeUsers({
      email,
      status: record_status.ACTIVE,
    });
    const checks = await Promise.all(
      candidates.map(async (user) => ({
        user,
        result: await this.verifyPassword(user.hash_password ?? "", password),
      })),
    );
    const matched = checks
      .filter(({ result }) => result.matched)
      .map(({ user }) => user);

    if (matched.length === 0) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const legacyUserIds = checks
      .filter(({ result }) => result.matched && result.legacy)
      .map(({ user }) => user.user_id);
    await this.upgradeLegacyPasswords(legacyUserIds, password);

    const [primary] = matched;
    const accessToken = await this.signAccessToken(primary.email, primary.name);
    const refreshToken = await this.refreshSessions.issue(primary.email);

    // The LOGIN audit entry is recorded later, when the user enters a specific
    // clinic+branch (POST /clinic/audit-log/login). A login is person-scoped here
    // (the token is a person, not a clinic), so there is no single branch to
    // attribute it to yet — and the audit log is read branch-scoped.
    return { accessToken, refreshToken, ...this.toSession(matched) };
  }

  /**
   * Rotates the refresh token and re-issues a fresh access token. The principal
   * is taken from the refresh session (Redis), not from an access token — the
   * whole point is to recover after the access token has expired.
   */
  async refresh(rawRefreshToken: string | undefined): Promise<LoginResult> {
    const { email, token: refreshToken } =
      await this.refreshSessions.rotate(rawRefreshToken);

    const matched = await this.activeUsers({
      email,
      status: record_status.ACTIVE,
    });
    if (matched.length === 0) {
      // Account deactivated since the session was issued — kill the session.
      await this.refreshSessions.revoke(rawRefreshToken);
      throw new UnauthorizedException("Session is no longer valid");
    }

    const [primary] = matched;
    const accessToken = await this.signAccessToken(primary.email, primary.name);
    return { accessToken, refreshToken, ...this.toSession(matched) };
  }

  /**
   * Re-resolves the current session from the authenticated principal — used by
   * `/authentication/me` to confirm the cookie session is still valid on hydrate.
   */
  async session(email: string): Promise<SessionResult> {
    const matched = await this.activeUsers({
      email,
      status: record_status.ACTIVE,
    });
    if (matched.length === 0) {
      throw new UnauthorizedException("Session is no longer valid");
    }
    return this.toSession(matched);
  }

  /** Revokes the refresh session (logout). */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    await this.refreshSessions.revoke(rawRefreshToken);
  }

  private signAccessToken(email: string, name: string | null): Promise<string> {
    const payload: JwtPrincipalPayload = { email, name: name ?? email };
    return this.jwtService.signAsync(payload);
  }

  private async verifyPassword(
    storedHash: string,
    password: string,
  ): Promise<{ matched: boolean; legacy: boolean }> {
    if (this.isArgon2Hash(storedHash)) {
      try {
        return {
          matched: await argon2.verify(storedHash, password),
          legacy: false,
        };
      } catch {
        return { matched: false, legacy: false };
      }
    }

    return { matched: this.md5(password) === storedHash, legacy: true };
  }

  private async upgradeLegacyPasswords(
    userIds: string[],
    password: string,
  ): Promise<void> {
    if (userIds.length === 0) return;

    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await this.prisma.user.updateMany({
      where: { user_id: { in: userIds } },
      data: { hash_password: hash },
    });
  }

  private md5(password: string): string {
    return createHash("md5").update(Buffer.from(password)).digest("hex");
  }

  private isArgon2Hash(storedHash: string): boolean {
    return storedHash.startsWith("$argon2");
  }

  /** ACTIVE user rows for the filter whose clinic is also ACTIVE. */
  private async activeUsers(
    where: Prisma.userWhereInput,
  ): Promise<UserWithClinic[]> {
    const users = await this.prisma.user.findMany({
      where,
      include: { clinic: true },
    });
    return users.filter(
      (user) =>
        user.clinic !== null && user.clinic.status === record_status.ACTIVE,
    );
  }

  private toSession(matched: UserWithClinic[]): SessionResult {
    const [primary] = matched;
    const seen = new Set<string>();
    const clinics: LoginClinic[] = [];
    for (const user of matched) {
      if (!user.clinic_id || seen.has(user.clinic_id)) continue;
      seen.add(user.clinic_id);
      clinics.push({
        clinicId: user.clinic_id,
        clinicName: user.clinic?.clinic_name ?? "",
        isClinicRootUser: user.is_clinic_root_user,
      });
    }
    return {
      profile: {
        email: primary.email,
        title: primary.title ?? "",
        name: primary.name ?? "",
        lastname: primary.lastname ?? "",
      },
      clinics,
    };
  }
}

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { record_status, type Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
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

/** Login adds the access token, which the controller turns into a cookie. */
export interface LoginResult extends SessionResult {
  accessToken: string;
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
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const hashedPassword = createHash("md5").update(Buffer.from(password)).digest("hex");

    const matched = await this.activeUsers({
      email,
      status: record_status.ACTIVE,
      hash_password: hashedPassword,
    });
    if (matched.length === 0) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const [primary] = matched;
    const payload: JwtPrincipalPayload = {
      email: primary.email,
      name: primary.name ?? primary.email,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken, ...this.toSession(matched) };
  }

  /**
   * Re-resolves the current session from the authenticated principal — used by
   * `/authentication/me` to confirm the cookie session is still valid on hydrate.
   */
  async session(email: string): Promise<SessionResult> {
    const matched = await this.activeUsers({ email, status: record_status.ACTIVE });
    if (matched.length === 0) {
      throw new UnauthorizedException("Session is no longer valid");
    }
    return this.toSession(matched);
  }

  /** ACTIVE user rows for the filter whose clinic is also ACTIVE. */
  private async activeUsers(where: Prisma.userWhereInput): Promise<UserWithClinic[]> {
    const users = await this.prisma.user.findMany({ where, include: { clinic: true } });
    return users.filter(
      (user) => user.clinic !== null && user.clinic.status === record_status.ACTIVE,
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

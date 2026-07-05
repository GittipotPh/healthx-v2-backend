import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { AuthService, SessionResult } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../common/openapi/api-envelope";
import {
  REFRESH_COOKIE_NAME,
  clearAuthCookie,
  clearRefreshCookie,
  setAuthCookie,
  setRefreshCookie,
} from "./auth.cookie";
import { CurrentPrincipal, NoScope, Public } from "./scope.decorator";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator";
import type { Principal } from "./auth.types";

/** Success payload of `POST /authentication/logout`. */
export class LogoutResult {
  @ApiProperty({ enum: [true], description: "Always true — cookies cleared" })
  success!: true;
}

@ApiTags("Authentication")
@BaseOpenApiErrorResponses()
@Controller("authentication")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Validates credentials, then sets the HttpOnly access (`hx_token`) and refresh
   * (`hx_refresh`) cookies. The body carries only non-sensitive session data —
   * neither token reaches frontend JS. Rate-limited to blunt credential stuffing.
   */
  @Public()
  @RateLimit({ limit: 10, windowSeconds: 60, by: "ip-email" })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @BaseOpenApiResponse(SessionResult)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResult> {
    const { accessToken, refreshToken, profile, clinics } =
      await this.authService.login(dto.email, dto.password);
    setAuthCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    return { profile, clinics };
  }

  /**
   * Rotates the refresh token (single-use) and issues a fresh access token. Driven
   * by the frontend when an access token expires. Public — it authenticates via
   * the refresh cookie, not an access token. On any failure the cookies are
   * cleared so the client falls back to login.
   */
  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, by: "ip" })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @BaseOpenApiResponse(SessionResult)
  async refresh(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResult> {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    try {
      const { accessToken, refreshToken, profile, clinics } =
        await this.authService.refresh(raw);
      setAuthCookie(res, accessToken);
      setRefreshCookie(res, refreshToken);
      return { profile, clinics };
    } catch (error) {
      clearAuthCookie(res);
      clearRefreshCookie(res);
      throw error;
    }
  }

  /**
   * Returns the current session for the authenticated cookie. Used by the
   * frontend on hydrate to confirm the stored profile/scope is still valid.
   */
  @NoScope()
  @Get("me")
  @BaseOpenApiResponse(SessionResult)
  me(@CurrentPrincipal() principal: Principal): Promise<SessionResult> {
    return this.authService.session(principal.email);
  }

  /**
   * Revokes the refresh session and clears both cookies. Public so it always
   * succeeds (and clears stale cookies) even when the access token has expired.
   */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @BaseOpenApiResponse(LogoutResult)
  async logout(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResult> {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
    clearAuthCookie(res);
    clearRefreshCookie(res);
    return { success: true };
  }
}

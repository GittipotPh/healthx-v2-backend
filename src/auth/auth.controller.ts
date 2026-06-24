import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthService, type SessionResult } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { clearAuthCookie, setAuthCookie } from "./auth.cookie";
import { CurrentPrincipal, NoScope, Public } from "./scope.decorator";
import type { Principal } from "./auth.types";

@Controller("authentication")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Validates credentials and sets the HttpOnly `hx_token` cookie. The response
   * body carries only non-sensitive session data (profile + clinics) — the token
   * never reaches frontend JS.
   */
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResult> {
    const { accessToken, profile, clinics } = await this.authService.login(
      dto.email,
      dto.password,
    );
    setAuthCookie(res, accessToken);
    return { profile, clinics };
  }

  /**
   * Returns the current session for the authenticated cookie. Used by the
   * frontend on hydrate to confirm the stored profile/scope is still valid.
   */
  @NoScope()
  @Get("me")
  me(@CurrentPrincipal() principal: Principal): Promise<SessionResult> {
    return this.authService.session(principal.email);
  }

  /**
   * Clears the session cookie. Public so it always succeeds (and clears a stale
   * cookie) even when the token has already expired.
   */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    clearAuthCookie(res);
    return { success: true };
  }
}

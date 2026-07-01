import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/scope.decorator";
import { HealthService, type HealthResult } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  async health(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResult> {
    const result = await this.healthService.check();
    if (result.status !== "ok") {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}

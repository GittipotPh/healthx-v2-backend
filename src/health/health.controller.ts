import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/scope.decorator";
import { HealthService, HealthResult } from "./health.service";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../common/openapi/api-envelope";

@ApiTags("Health")
@BaseOpenApiErrorResponses()
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @BaseOpenApiResponse(HealthResult)
  @BaseOpenApiResponse(HealthResult, {
    status: 503,
    description: "Degraded — same envelope, HTTP 503",
  })
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

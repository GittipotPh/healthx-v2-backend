import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiParam, ApiTags } from "@nestjs/swagger";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { RequirePermissions } from "../../auth/permissions.decorator";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import {
  OpdOrderReleasePreflightDto,
  ReleaseOpdOrderDto,
  VoidReleasedOpdOrderDto,
} from "./dto/opd-order-release.dto";
import {
  OpdOrderReleasePreflightResult,
  OpdOrderReleaseResult,
  VoidOpdOrderReleaseResult,
} from "./opd-order-release.mapper";
import { OpdOrderReleaseService } from "./opd-order-release.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Medication Release")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdOrderReleaseController {
  constructor(private readonly service: OpdOrderReleaseService) {}

  @Post(":encounterId/orders/:orderId/release-preflight")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("OPD_EDIT", "TREATMENT_EDIT", "SALE-ORDER_CREATE")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "orderId", format: "uuid" })
  @BaseOpenApiResponse(OpdOrderReleasePreflightResult)
  preflight(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() dto: OpdOrderReleasePreflightDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdOrderReleasePreflightResult> {
    return this.service.preflight(encounterId, orderId, dto, scope);
  }

  @Post(":encounterId/orders/:orderId/release")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("OPD_EDIT", "TREATMENT_EDIT", "SALE-ORDER_CREATE")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "orderId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Stable 8-200 character key reused only for this exact release",
  })
  @BaseOpenApiResponse(OpdOrderReleaseResult, { status: 201 })
  release(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() dto: ReleaseOpdOrderDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdOrderReleaseResult> {
    return this.service.release(
      encounterId,
      orderId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Post(":encounterId/orders/:orderId/release/void")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("OPD_EDIT", "TREATMENT_EDIT", "SALE-ORDER_CREATE")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "orderId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable 8-200 character key reused only for this exact void",
  })
  @BaseOpenApiResponse(VoidOpdOrderReleaseResult)
  voidRelease(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() dto: VoidReleasedOpdOrderDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<VoidOpdOrderReleaseResult> {
    return this.service.voidRelease(
      encounterId,
      orderId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
  CreateOpdCourseReservationDto,
  OpdCourseReservationPreflightDto,
  QueryOpdCourseEntitlementsDto,
  VoidOpdCourseReservationDto,
} from "./dto/opd-course-reservation.dto";
import {
  OpdCourseEntitlementListResult,
  OpdCourseReservationPreflightResult,
  OpdCourseReservationResult,
  OpdCurrentCourseReservationResult,
} from "./opd-course-reservation.mapper";
import { OpdCourseReservationService } from "./opd-course-reservation.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Existing Course Reservation")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdCourseReservationController {
  constructor(private readonly service: OpdCourseReservationService) {}

  @Get(":encounterId/course-entitlements")
  @RequirePermissions("OPD_READ", "TREATMENT_READ", "CUSTOMER_COURSE_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdCourseEntitlementListResult)
  entitlements(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Query() query: QueryOpdCourseEntitlementsDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdCourseEntitlementListResult> {
    return this.service.entitlements(encounterId, query, scope);
  }

  @Post(":encounterId/course-reservations/preflight")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("OPD_READ", "TREATMENT_READ", "CUSTOMER_COURSE_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdCourseReservationPreflightResult)
  preflight(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: OpdCourseReservationPreflightDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdCourseReservationPreflightResult> {
    return this.service.preflight(encounterId, dto, scope);
  }

  @Post(":encounterId/course-reservations")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("OPD_EDIT", "TREATMENT_EDIT", "PURCHASE-COURSE_CREATE")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable 8-200 character key reused only for this reservation",
  })
  @BaseOpenApiResponse(OpdCourseReservationResult, { status: 201 })
  reserve(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: CreateOpdCourseReservationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdCourseReservationResult> {
    return this.service.reserve(
      encounterId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Get(":encounterId/course-reservations/current")
  @RequirePermissions("OPD_READ", "TREATMENT_READ", "CUSTOMER_COURSE_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdCurrentCourseReservationResult)
  current(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdCurrentCourseReservationResult> {
    return this.service.current(encounterId, scope);
  }

  @Post(":encounterId/course-reservations/:reservationId/void")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("OPD_EDIT", "TREATMENT_EDIT", "PURCHASE-COURSE_DELETE")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable 8-200 character key reused only for this exact void",
  })
  @BaseOpenApiResponse(OpdCourseReservationResult)
  voidReservation(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Body() dto: VoidOpdCourseReservationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdCourseReservationResult> {
    return this.service.voidReservation(
      encounterId,
      reservationId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }
}

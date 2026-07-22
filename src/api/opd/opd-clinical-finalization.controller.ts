import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  AssignOpdAttendingClinicianDto,
  FinalizeOpdClinicalDto,
} from "./dto/opd-clinical-finalization.dto";
import {
  OpdAttendingClinicianResult,
  OpdClinicalFinalizationResult,
  OpdClinicalReadinessView,
  OpdPostVisitView,
} from "./opd-clinical-finalization.mapper";
import { OpdClinicalFinalizationService } from "./opd-clinical-finalization.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Clinical Finalization")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdClinicalFinalizationController {
  constructor(private readonly service: OpdClinicalFinalizationService) {}

  @Get(":encounterId/readiness")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdClinicalReadinessView)
  readiness(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdClinicalReadinessView> {
    return this.service.readiness(encounterId, scope);
  }

  @Patch(":encounterId/attending-clinician")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdAttendingClinicianResult)
  assignAttendingClinician(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: AssignOpdAttendingClinicianDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdAttendingClinicianResult> {
    return this.service.assignAttendingClinician(
      encounterId,
      dto,
      scope,
      principal,
    );
  }

  @Post(":encounterId/finalize-clinical")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("OPD_EDIT", "OPD_FINALIZE")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Stable 8-200 character key reused only for this exact finalization manifest",
  })
  @BaseOpenApiResponse(OpdClinicalFinalizationResult, { status: 201 })
  finalize(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: FinalizeOpdClinicalDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdClinicalFinalizationResult> {
    return this.service.finalize(
      encounterId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Get(":encounterId/post-visit")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdPostVisitView)
  postVisit(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdPostVisitView> {
    return this.service.postVisit(encounterId, scope);
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreateOpdExaminationCorrectionDto,
  CreateOpdExaminationDto,
  FinalizeOpdExaminationDto,
  PatchOpdVitalObservationDto,
  QueryOpdExaminationsDto,
} from "./dto/opd-examination.dto";
import { PatchOpdIntakeDto } from "./dto/opd-intake.dto";
import { OpdIntakeView } from "./opd-clinical-intake.mapper";
import { OpdClinicalIntakeService } from "./opd-clinical-intake.service";
import {
  CreateOpdExaminationCorrectionResult,
  CreateOpdExaminationResult,
  OpdExaminationListResult,
  OpdExaminationView,
} from "./opd-clinical.mapper";
import { OpdClinicalService } from "./opd-clinical.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Clinical")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdClinicalController {
  constructor(
    private readonly clinicalService: OpdClinicalService,
    private readonly intakeService: OpdClinicalIntakeService,
  ) {}

  @Get(":encounterId/examinations")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdExaminationListResult)
  listExaminations(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Query() query: QueryOpdExaminationsDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdExaminationListResult> {
    return this.clinicalService.listExaminations(encounterId, query, scope);
  }

  @Post(":encounterId/examinations")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(CreateOpdExaminationResult, { status: 201 })
  createExamination(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() _dto: CreateOpdExaminationDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CreateOpdExaminationResult> {
    return this.clinicalService.createExamination(
      encounterId,
      scope,
      principal,
    );
  }

  @Get(":encounterId/examinations/:examinationId")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdExaminationView)
  examination(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdExaminationView> {
    return this.clinicalService.examination(encounterId, examinationId, scope);
  }

  @Patch(":encounterId/examinations/:examinationId/vitals")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdExaminationView)
  patchVitals(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Body() dto: PatchOpdVitalObservationDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdExaminationView> {
    return this.clinicalService.patchVitals(
      encounterId,
      examinationId,
      dto,
      scope,
      principal,
    );
  }

  @Get(":encounterId/examinations/:examinationId/intake")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdIntakeView)
  intake(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdIntakeView> {
    return this.intakeService.intake(encounterId, examinationId, scope);
  }

  @Patch(":encounterId/examinations/:examinationId/intake")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdIntakeView)
  patchIntake(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Body() dto: PatchOpdIntakeDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdIntakeView> {
    return this.intakeService.patchIntake(
      encounterId,
      examinationId,
      dto,
      scope,
      principal,
    );
  }

  @Post(":encounterId/examinations/:examinationId/corrections")
  @RequirePermissions("OPD_EDIT", "OPD_CORRECT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "8-200 character key; reuse it when retrying this correction command",
  })
  @BaseOpenApiResponse(CreateOpdExaminationCorrectionResult, { status: 201 })
  createExaminationCorrection(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Body() dto: CreateOpdExaminationCorrectionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CreateOpdExaminationCorrectionResult> {
    return this.clinicalService.createExaminationCorrection(
      encounterId,
      examinationId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Post(":encounterId/examinations/:examinationId/finalize")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "8-200 character key; reuse it when retrying this finalization",
  })
  @BaseOpenApiResponse(OpdExaminationView)
  finalizeExamination(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Body() dto: FinalizeOpdExaminationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdExaminationView> {
    return this.clinicalService.finalizeExamination(
      encounterId,
      examinationId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }
}

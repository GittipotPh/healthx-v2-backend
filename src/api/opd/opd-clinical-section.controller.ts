import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiParam, ApiTags } from "@nestjs/swagger";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { RequirePermissions } from "../../auth/permissions.decorator";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import {
  CreateOpdClinicalSectionDto,
  CreateOpdDraftCheckpointDto,
  PatchOpdDiagnosisSectionDto,
  PatchOpdSymptomSectionDto,
} from "./dto/opd-clinical-section.dto";
import {
  CreateOpdDiagnosisSectionResult,
  CreateOpdSymptomSectionResult,
  OpdDiagnosisSectionResult,
  OpdDiagnosisSectionView,
  OpdDraftCheckpointView,
  OpdSymptomSectionResult,
  OpdSymptomSectionView,
} from "./opd-clinical-section.mapper";
import { OpdClinicalSectionService } from "./opd-clinical-section.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Clinical Sections")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdClinicalSectionController {
  constructor(private readonly service: OpdClinicalSectionService) {}

  @Get(":encounterId/examinations/:examinationId/symptoms")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdSymptomSectionResult)
  symptomSection(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdSymptomSectionResult> {
    return this.service.symptomSection(encounterId, examinationId, scope);
  }

  @Post(":encounterId/examinations/:examinationId/symptoms")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(CreateOpdSymptomSectionResult, { status: 201 })
  createSymptomSection(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Body() _dto: CreateOpdClinicalSectionDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CreateOpdSymptomSectionResult> {
    return this.service.createSymptomSection(
      encounterId,
      examinationId,
      scope,
      principal,
    );
  }

  @Patch(":encounterId/examinations/:examinationId/symptoms")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdSymptomSectionView)
  patchSymptoms(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Body() dto: PatchOpdSymptomSectionDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdSymptomSectionView> {
    return this.service.patchSymptoms(
      encounterId,
      examinationId,
      dto,
      scope,
      principal,
    );
  }

  @Get(":encounterId/diagnoses")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdDiagnosisSectionResult)
  diagnosisSection(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdDiagnosisSectionResult> {
    return this.service.diagnosisSection(encounterId, scope);
  }

  @Post(":encounterId/diagnoses")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(CreateOpdDiagnosisSectionResult, { status: 201 })
  createDiagnosisSection(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() _dto: CreateOpdClinicalSectionDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CreateOpdDiagnosisSectionResult> {
    return this.service.createDiagnosisSection(encounterId, scope, principal);
  }

  @Patch(":encounterId/diagnoses")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdDiagnosisSectionView)
  patchDiagnoses(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: PatchOpdDiagnosisSectionDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDiagnosisSectionView> {
    return this.service.patchDiagnoses(encounterId, dto, scope, principal);
  }

  @Post(":encounterId/draft-checkpoints")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdDraftCheckpointView, { status: 201 })
  createDraftCheckpoint(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: CreateOpdDraftCheckpointDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDraftCheckpointView> {
    return this.service.createDraftCheckpoint(
      encounterId,
      dto,
      scope,
      principal,
    );
  }
}

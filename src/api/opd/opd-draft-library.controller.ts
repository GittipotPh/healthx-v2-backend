import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
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
import { CreateOpdDraftCheckpointDto } from "./dto/opd-clinical-section.dto";
import {
  ImportOpdDraftDto,
  OpdDraftCopySectionCode,
  QueryReusableOpdDraftsDto,
  ReviewImportedOpdDraftSectionDto,
} from "./dto/opd-draft-library.dto";
import { OpdDraftCheckpointView } from "./opd-clinical-section.mapper";
import {
  CurrentOpdDraftImportView,
  OpdDraftImportView,
  ReusableOpdDraftListView,
  ReusableOpdDraftPreviewView,
  ReviewImportedOpdDraftSectionView,
} from "./opd-draft-library.mapper";
import { OpdDraftLibraryService } from "./opd-draft-library.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Reusable Drafts")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdDraftLibraryController {
  constructor(private readonly service: OpdDraftLibraryService) {}

  @Post(":encounterId/draft-checkpoints")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable client-generated key for this exact draft save",
  })
  @BaseOpenApiResponse(OpdDraftCheckpointView, { status: 201 })
  createDraftCheckpoint(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: CreateOpdDraftCheckpointDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDraftCheckpointView> {
    return this.service.createDraftCheckpoint(
      encounterId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Get(":targetEncounterId/reusable-drafts")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "targetEncounterId", format: "uuid" })
  @BaseOpenApiResponse(ReusableOpdDraftListView)
  listReusableDrafts(
    @Param("targetEncounterId", new ParseUUIDPipe()) targetEncounterId: string,
    @Query() query: QueryReusableOpdDraftsDto,
    @Scope() scope: RequestScope,
  ): Promise<ReusableOpdDraftListView> {
    return this.service.listReusableDrafts(targetEncounterId, query, scope);
  }

  @Get(":targetEncounterId/reusable-drafts/:snapshotId/preview")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "targetEncounterId", format: "uuid" })
  @ApiParam({ name: "snapshotId", format: "uuid" })
  @BaseOpenApiResponse(ReusableOpdDraftPreviewView)
  previewReusableDraft(
    @Param("targetEncounterId", new ParseUUIDPipe()) targetEncounterId: string,
    @Param("snapshotId", new ParseUUIDPipe()) snapshotId: string,
    @Scope() scope: RequestScope,
  ): Promise<ReusableOpdDraftPreviewView> {
    return this.service.previewReusableDraft(
      targetEncounterId,
      snapshotId,
      scope,
    );
  }

  @Get(":targetEncounterId/draft-imports/current")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "targetEncounterId", format: "uuid" })
  @BaseOpenApiResponse(CurrentOpdDraftImportView)
  currentImport(
    @Param("targetEncounterId", new ParseUUIDPipe()) targetEncounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<CurrentOpdDraftImportView> {
    return this.service.currentImport(targetEncounterId, scope);
  }

  @Post(":targetEncounterId/draft-imports")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "targetEncounterId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable client-generated key for this exact draft import",
  })
  @BaseOpenApiResponse(OpdDraftImportView, { status: 201 })
  importDraft(
    @Param("targetEncounterId", new ParseUUIDPipe()) targetEncounterId: string,
    @Body() dto: ImportOpdDraftDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDraftImportView> {
    return this.service.importDraft(
      targetEncounterId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Patch(
    ":targetEncounterId/draft-imports/:draftImportId/sections/:sectionCode/review",
  )
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "targetEncounterId", format: "uuid" })
  @ApiParam({ name: "draftImportId", format: "uuid" })
  @ApiParam({ name: "sectionCode", enum: OpdDraftCopySectionCode })
  @BaseOpenApiResponse(ReviewImportedOpdDraftSectionView)
  reviewImportedSection(
    @Param("targetEncounterId", new ParseUUIDPipe()) targetEncounterId: string,
    @Param("draftImportId", new ParseUUIDPipe()) draftImportId: string,
    @Param("sectionCode", new ParseEnumPipe(OpdDraftCopySectionCode))
    sectionCode: OpdDraftCopySectionCode,
    @Body() dto: ReviewImportedOpdDraftSectionDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ReviewImportedOpdDraftSectionView> {
    return this.service.reviewImportedSection(
      targetEncounterId,
      draftImportId,
      sectionCode,
      dto,
      scope,
      principal,
    );
  }
}

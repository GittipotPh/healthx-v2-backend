import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
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
  OpdNoteSectionCode,
  PatchOpdNoteModeDto,
  PatchOpdNoteSectionDto,
} from "./dto/opd-clinical-note.dto";
import {
  OpdNoteSectionView,
  OpdNoteWorkspaceView,
} from "./opd-clinical-note.mapper";
import { OpdClinicalNoteService } from "./opd-clinical-note.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Clinical Notes")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdClinicalNoteController {
  constructor(private readonly service: OpdClinicalNoteService) {}

  @Get(":encounterId/note-workspace")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdNoteWorkspaceView)
  workspace(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdNoteWorkspaceView> {
    return this.service.workspace(encounterId, scope);
  }

  @Patch(":encounterId/note-workspace/mode")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdNoteWorkspaceView)
  patchMode(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() dto: PatchOpdNoteModeDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdNoteWorkspaceView> {
    return this.service.patchMode(encounterId, dto, scope, principal);
  }

  @Get(":encounterId/sections/:sectionCode")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "sectionCode", enum: OpdNoteSectionCode })
  @BaseOpenApiResponse(OpdNoteSectionView)
  section(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("sectionCode", new ParseEnumPipe(OpdNoteSectionCode))
    sectionCode: OpdNoteSectionCode,
    @Scope() scope: RequestScope,
  ): Promise<OpdNoteSectionView> {
    return this.service.section(encounterId, sectionCode, scope);
  }

  @Patch(":encounterId/sections/:sectionCode")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "sectionCode", enum: OpdNoteSectionCode })
  @BaseOpenApiResponse(OpdNoteSectionView)
  patchSection(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("sectionCode", new ParseEnumPipe(OpdNoteSectionCode))
    sectionCode: OpdNoteSectionCode,
    @Body() dto: PatchOpdNoteSectionDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdNoteSectionView> {
    return this.service.patchSection(
      encounterId,
      sectionCode,
      dto,
      scope,
      principal,
    );
  }
}

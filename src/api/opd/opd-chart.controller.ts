import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { RequirePermissions } from "../../auth/permissions.decorator";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import {
  BaseOpenApiArrayResponse,
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import {
  FinalizeOpdChartDocumentDto,
  OpdChartArtifactFormat,
  SaveOpdChartDocumentDto,
} from "./dto/opd-chart.dto";
import {
  FinalizeOpdChartDocumentResult,
  OpdChartArtifactAccessResult,
  OpdChartDocumentListResult,
  SaveOpdChartDocumentResult,
  OpdChartTemplateView,
} from "./opd-chart.mapper";
import { OpdChartService } from "./opd-chart.service";
import { OpdChartRasterEnabledGuard } from "./opd-chart-raster-enabled.guard";
import { OpdChartTemplateCode } from "./opd-chart-template.registry";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

const CHART_RENDER_LIMIT_BYTES = 6 * 1024 * 1024;

@ApiTags("OPD Chart Documents")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdChartController {
  constructor(private readonly service: OpdChartService) {}

  @Get("chart-templates")
  @RequirePermissions("OPD_READ")
  @BaseOpenApiArrayResponse(OpdChartTemplateView)
  templates(): OpdChartTemplateView[] {
    return this.service.templates();
  }

  @Get(":encounterId/chart-documents")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdChartDocumentListResult)
  documents(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdChartDocumentListResult> {
    return this.service.documents(encounterId, scope);
  }

  @Put(":encounterId/chart-documents/:templateCode")
  @UseGuards(OpdChartRasterEnabledGuard)
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "templateCode", enum: OpdChartTemplateCode })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: [
        "expectedVersion",
        "templateVersion",
        "clientMutationId",
        "location",
        "character",
        "size",
        "side",
        "doctorNote",
        "renderedPng",
      ],
      properties: {
        expectedVersion: { type: "integer", minimum: 0 },
        templateVersion: { type: "string" },
        clientMutationId: { type: "string", format: "uuid" },
        location: { type: "string", maxLength: 2000 },
        character: { type: "string", maxLength: 2000 },
        size: { type: "string", maxLength: 2000 },
        side: { type: "string", maxLength: 2000 },
        doctorNote: { type: "string", maxLength: 4000 },
        renderedPng: {
          type: "string",
          format: "binary",
          description: "Complete flattened 960 x 680 PNG, maximum 6 MiB",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("renderedPng", {
      limits: {
        files: 1,
        fileSize: CHART_RENDER_LIMIT_BYTES,
        fields: 8,
      },
    }),
  )
  @BaseOpenApiResponse(SaveOpdChartDocumentResult)
  saveDraft(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("templateCode", new ParseEnumPipe(OpdChartTemplateCode))
    templateCode: OpdChartTemplateCode,
    @Body() dto: SaveOpdChartDocumentDto,
    @UploadedFile() renderedPng: Express.Multer.File | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SaveOpdChartDocumentResult> {
    return this.service.saveDraft(
      encounterId,
      templateCode,
      dto,
      renderedPng,
      scope,
      principal,
    );
  }

  @Post(":encounterId/chart-documents/:templateCode/finalize")
  @UseGuards(OpdChartRasterEnabledGuard)
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "templateCode", enum: OpdChartTemplateCode })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Stable 8-200 character key reused only for this exact Chart finalization",
  })
  @BaseOpenApiResponse(FinalizeOpdChartDocumentResult)
  finalize(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("templateCode", new ParseEnumPipe(OpdChartTemplateCode))
    templateCode: OpdChartTemplateCode,
    @Body() dto: FinalizeOpdChartDocumentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FinalizeOpdChartDocumentResult> {
    return this.service.finalize(
      encounterId,
      templateCode,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Get(":encounterId/chart-documents/:templateCode/artifacts/:artifactFormat")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "templateCode", enum: OpdChartTemplateCode })
  @ApiParam({ name: "artifactFormat", enum: OpdChartArtifactFormat })
  @BaseOpenApiResponse(OpdChartArtifactAccessResult)
  artifact(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("templateCode", new ParseEnumPipe(OpdChartTemplateCode))
    templateCode: OpdChartTemplateCode,
    @Param("artifactFormat", new ParseEnumPipe(OpdChartArtifactFormat))
    artifactFormat: OpdChartArtifactFormat,
    @Scope() scope: RequestScope,
  ): Promise<OpdChartArtifactAccessResult> {
    return this.service.artifactAccess(
      encounterId,
      templateCode,
      artifactFormat,
      scope,
    );
  }
}

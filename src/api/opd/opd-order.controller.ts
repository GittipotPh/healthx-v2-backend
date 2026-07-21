import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  CreateOpdDraftOrderDto,
  CreateOpdOrderItemDto,
  PatchOpdOrderItemDto,
  QueryOpdClinicalCatalogDto,
  VoidOpdOrderItemDto,
} from "./dto/opd-order.dto";
import {
  CreateOpdDraftOrderResult,
  OpdClinicalCatalogListResult,
  OpdDraftOrderResult,
  OpdDraftOrderView,
} from "./opd-order.mapper";
import { OpdOrderService } from "./opd-order.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Draft Orders")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdOrderController {
  constructor(private readonly service: OpdOrderService) {}

  @Get("clinical-catalog")
  @RequirePermissions("OPD_READ")
  @BaseOpenApiResponse(OpdClinicalCatalogListResult)
  catalog(
    @Query() query: QueryOpdClinicalCatalogDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdClinicalCatalogListResult> {
    return this.service.catalog(query, scope);
  }

  @Get(":encounterId/orders")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(OpdDraftOrderResult)
  draftOrder(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdDraftOrderResult> {
    return this.service.draftOrder(encounterId, scope);
  }

  @Post(":encounterId/orders")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @BaseOpenApiResponse(CreateOpdDraftOrderResult, { status: 201 })
  createDraftOrder(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Body() _dto: CreateOpdDraftOrderDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CreateOpdDraftOrderResult> {
    return this.service.createDraftOrder(encounterId, scope, principal);
  }

  @Post(":encounterId/orders/:orderId/items")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "orderId", format: "uuid" })
  @BaseOpenApiResponse(OpdDraftOrderView, { status: 201 })
  addItem(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() dto: CreateOpdOrderItemDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDraftOrderView> {
    return this.service.addItem(encounterId, orderId, dto, scope, principal);
  }

  @Patch(":encounterId/orders/:orderId/items/:itemId")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "orderId", format: "uuid" })
  @ApiParam({ name: "itemId", format: "uuid" })
  @BaseOpenApiResponse(OpdDraftOrderView)
  patchItem(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() dto: PatchOpdOrderItemDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDraftOrderView> {
    return this.service.patchItem(
      encounterId,
      orderId,
      itemId,
      dto,
      scope,
      principal,
    );
  }

  @Post(":encounterId/orders/:orderId/items/:itemId/void")
  @RequirePermissions("OPD_EDIT")
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "orderId", format: "uuid" })
  @ApiParam({ name: "itemId", format: "uuid" })
  @BaseOpenApiResponse(OpdDraftOrderView)
  voidItem(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() dto: VoidOpdOrderItemDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdDraftOrderView> {
    return this.service.voidItem(
      encounterId,
      orderId,
      itemId,
      dto,
      scope,
      principal,
    );
  }
}

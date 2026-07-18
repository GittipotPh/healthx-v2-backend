import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  QueueService,
  QueueAnestheticResult,
  QueueConsultationResult,
  QueueTodayResult,
  QueueTransitionResult,
} from "./queue.service";
import { QueueConfigView } from "./queue.mapper";
import { QueryQueueDto } from "./dto/query-queue.dto";
import { TransitionQueueDto } from "./dto/transition-queue.dto";
import { SaveConsultationDto } from "./dto/save-consultation.dto";
import { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import { SaveQueueConfigDto } from "./dto/save-queue-config.dto";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import type { Principal, RequestScope } from "../../auth/auth.types";

@ApiTags("Queue")
@BaseOpenApiErrorResponses()
@Controller("clinic/queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get("today")
  @BaseOpenApiResponse(QueueTodayResult)
  today(
    @Query() query: QueryQueueDto,
    @Scope() scope: RequestScope,
  ): Promise<QueueTodayResult> {
    return this.queueService.today(query, scope);
  }

  @Post("transition")
  @BaseOpenApiResponse(QueueTransitionResult, { status: 201 })
  transition(
    @Body() dto: TransitionQueueDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueTransitionResult> {
    return this.queueService.transition(dto, scope, principal);
  }

  @Post("consultation")
  @BaseOpenApiResponse(QueueConsultationResult, { status: 201 })
  saveConsultation(
    @Body() dto: SaveConsultationDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueConsultationResult> {
    return this.queueService.saveConsultation(dto, scope, principal);
  }

  @Post("anesthetic")
  @BaseOpenApiResponse(QueueAnestheticResult, { status: 201 })
  saveAnesthetic(
    @Body() dto: SaveAnestheticDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueAnestheticResult> {
    return this.queueService.saveAnesthetic(dto, scope, principal);
  }

  @Get("config")
  @BaseOpenApiResponse(QueueConfigView)
  getConfig(@Scope() scope: RequestScope): Promise<QueueConfigView> {
    return this.queueService.getQueueConfig(scope);
  }

  @Post("config")
  @BaseOpenApiResponse(QueueConfigView, { status: 201 })
  updateConfig(
    @Body() dto: SaveQueueConfigDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueConfigView> {
    return this.queueService.updateQueueConfig(dto, scope, principal);
  }
}

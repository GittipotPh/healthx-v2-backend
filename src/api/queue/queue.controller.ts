import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  QueueService,
  type QueueAnestheticResult,
  type QueueConsultationResult,
  type QueueTodayResult,
  type QueueTransitionResult,
} from "./queue.service";
import { QueryQueueDto } from "./dto/query-queue.dto";
import { TransitionQueueDto } from "./dto/transition-queue.dto";
import { SaveConsultationDto } from "./dto/save-consultation.dto";
import { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import type { Principal, RequestScope } from "../../auth/auth.types";

@Controller("clinic/queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get("today")
  today(@Query() query: QueryQueueDto, @Scope() scope: RequestScope): Promise<QueueTodayResult> {
    return this.queueService.today(query, scope);
  }

  @Post("transition")
  transition(
    @Body() dto: TransitionQueueDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueTransitionResult> {
    return this.queueService.transition(dto, scope, principal);
  }

  @Post("consultation")
  saveConsultation(
    @Body() dto: SaveConsultationDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueConsultationResult> {
    return this.queueService.saveConsultation(dto, scope, principal);
  }

  @Post("anesthetic")
  saveAnesthetic(
    @Body() dto: SaveAnestheticDto,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QueueAnestheticResult> {
    return this.queueService.saveAnesthetic(dto, scope, principal);
  }
}

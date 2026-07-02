import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  QueueService,
  type QueueTodayResult,
  type QueueTransitionResult,
} from "./queue.service";
import { QueryQueueDto } from "./dto/query-queue.dto";
import { TransitionQueueDto } from "./dto/transition-queue.dto";
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
}

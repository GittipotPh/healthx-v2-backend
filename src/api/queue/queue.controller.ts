import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  QueueService,
  type QueueTodayResult,
  type QueueTransitionResult,
} from "./queue.service";
import { QueryQueueDto } from "./dto/query-queue.dto";
import { TransitionQueueDto } from "./dto/transition-queue.dto";

@Controller("clinic/queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get("today")
  today(@Query() query: QueryQueueDto): Promise<QueueTodayResult> {
    return this.queueService.today(query);
  }

  @Post("transition")
  transition(@Body() dto: TransitionQueueDto): Promise<QueueTransitionResult> {
    return this.queueService.transition(dto);
  }
}

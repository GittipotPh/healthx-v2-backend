import { Controller, Get, Query } from "@nestjs/common";
import { AppointmentsService, type AppointmentListResult } from "./appointments.service";
import { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@Controller("clinic/appointments")
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  list(
    @Query() query: QueryAppointmentsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentListResult> {
    return this.appointmentsService.list(query, scope);
  }
}

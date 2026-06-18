import { Controller, Get, Query } from "@nestjs/common";
import { AppointmentsService, type AppointmentListResult } from "./appointments.service";
import { QueryAppointmentsDto } from "./dto/query-appointments.dto";

@Controller("clinic/appointments")
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  list(@Query() query: QueryAppointmentsDto): Promise<AppointmentListResult> {
    return this.appointmentsService.list(query);
  }
}

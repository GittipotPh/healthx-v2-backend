import { Controller, Get, Query } from "@nestjs/common";
import { AppointmentsService, type AppointmentListResult } from "./appointments.service";
import { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type {
  AppointmentOptionPage,
  AppointmentOptionsView,
  BranchScopedOption,
  StaffOption,
} from "./appointments.mapper";
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

  @Get("options")
  options(@Scope() scope: RequestScope): Promise<AppointmentOptionsView> {
    return this.appointmentsService.options(scope);
  }

  @Get("options/procedures")
  procedureOptions(
    @Query() query: QueryAppointmentOptionsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentOptionPage<BranchScopedOption>> {
    return this.appointmentsService.procedureOptions(query, scope);
  }

  @Get("options/doctors")
  doctorOptions(
    @Query() query: QueryAppointmentOptionsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.appointmentsService.doctorOptions(query, scope);
  }

  @Get("options/assistants")
  assistantOptions(
    @Query() query: QueryAppointmentOptionsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.appointmentsService.assistantOptions(query, scope);
  }
}

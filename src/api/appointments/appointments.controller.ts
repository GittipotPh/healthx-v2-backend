import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AppointmentsService, type AppointmentListResult } from "./appointments.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type {
  AppointmentOptionPage,
  AppointmentOptionsView,
  AppointmentView,
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

  @Post()
  create(
    @Body() dto: CreateAppointmentDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentView> {
    return this.appointmentsService.create(dto, scope);
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

  @Patch(":id/reschedule")
  reschedule(
    @Param("id") id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentView> {
    return this.appointmentsService.reschedule(id, dto, scope);
  }
}

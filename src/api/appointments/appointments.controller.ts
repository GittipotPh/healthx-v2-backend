import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiParam, ApiTags } from "@nestjs/swagger";
import { AppointmentsService, AppointmentListResult } from "./appointments.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import {
  AppointmentOptionsView,
  AppointmentView,
  BranchScopedOptionPage,
  StaffOptionPage,
  type AppointmentOptionPage,
  type BranchScopedOption,
  type StaffOption,
} from "./appointments.mapper";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@ApiTags("Appointments")
@BaseOpenApiErrorResponses()
@Controller("clinic/appointments")
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @BaseOpenApiResponse(AppointmentListResult)
  list(
    @Query() query: QueryAppointmentsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentListResult> {
    return this.appointmentsService.list(query, scope);
  }

  @Post()
  @BaseOpenApiResponse(AppointmentView, { status: 201 })
  create(
    @Body() dto: CreateAppointmentDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentView> {
    return this.appointmentsService.create(dto, scope);
  }

  @Get("options")
  @BaseOpenApiResponse(AppointmentOptionsView)
  options(@Scope() scope: RequestScope): Promise<AppointmentOptionsView> {
    return this.appointmentsService.options(scope);
  }

  @Get("options/procedures")
  @BaseOpenApiResponse(BranchScopedOptionPage)
  procedureOptions(
    @Query() query: QueryAppointmentOptionsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentOptionPage<BranchScopedOption>> {
    return this.appointmentsService.procedureOptions(query, scope);
  }

  @Get("options/doctors")
  @BaseOpenApiResponse(StaffOptionPage)
  doctorOptions(
    @Query() query: QueryAppointmentOptionsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.appointmentsService.doctorOptions(query, scope);
  }

  @Get("options/assistants")
  @BaseOpenApiResponse(StaffOptionPage)
  assistantOptions(
    @Query() query: QueryAppointmentOptionsDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.appointmentsService.assistantOptions(query, scope);
  }

  @Patch(":id/reschedule")
  @ApiParam({ name: "id", description: "Appointment id" })
  @BaseOpenApiResponse(AppointmentView)
  reschedule(
    @Param("id") id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Scope() scope: RequestScope,
  ): Promise<AppointmentView> {
    return this.appointmentsService.reschedule(id, dto, scope);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiParam, ApiTags } from "@nestjs/swagger";
import { CustomersService, CustomerListResult } from "./customers.service";
import { CustomerOptionsView, CustomerView } from "./customers.mapper";
import {
  CustomerAppointmentSummary,
  CustomerDocumentSummary,
  CustomerFileView,
  CustomerFinancialsView,
  CustomerNoteView,
  CustomerProfileView,
  CustomerTimelineItem,
} from "./customer-profile.mapper";
import { QueryCustomersDto } from "./dto/query-customers.dto";
import { CreateCustomerNoteDto } from "./dto/create-customer-note.dto";
import { UploadCustomerFileDto } from "./dto/upload-customer-file.dto";
import {
  BaseOpenApiArrayResponse,
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

const CUSTOMER_FILE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

@ApiTags("Customers")
@BaseOpenApiErrorResponses()
@Controller("clinic/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @BaseOpenApiResponse(CustomerListResult)
  list(
    @Query() query: QueryCustomersDto,
    @Scope() scope: RequestScope,
  ): Promise<CustomerListResult> {
    return this.customersService.list(query, scope);
  }

  @Get("options")
  @BaseOpenApiResponse(CustomerOptionsView)
  options(@Scope() scope: RequestScope): Promise<CustomerOptionsView> {
    return this.customersService.options(scope);
  }

  @Get(":customerId")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(CustomerView)
  detail(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerView> {
    return this.customersService.detail(customerId, scope.clinicId);
  }

  @Get(":customerId/profile")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(CustomerProfileView)
  profile(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerProfileView> {
    return this.customersService.profile(customerId, scope);
  }

  @Get(":customerId/timeline")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiArrayResponse(CustomerTimelineItem)
  timeline(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerTimelineItem[]> {
    return this.customersService.timeline(customerId, scope);
  }

  @Get(":customerId/appointments")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiArrayResponse(CustomerAppointmentSummary)
  appointments(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerAppointmentSummary[]> {
    return this.customersService.appointments(customerId, scope);
  }

  @Get(":customerId/financials")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(CustomerFinancialsView)
  financials(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerFinancialsView> {
    return this.customersService.financials(customerId, scope);
  }

  @Get(":customerId/documents")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiArrayResponse(CustomerDocumentSummary)
  documents(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerDocumentSummary[]> {
    return this.customersService.documents(customerId, scope);
  }

  @Get(":customerId/notes")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiArrayResponse(CustomerNoteView)
  notes(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerNoteView[]> {
    return this.customersService.notes(customerId, scope);
  }

  @Post(":customerId/notes")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(CustomerNoteView, { status: 201 })
  createNote(
    @Param("customerId") customerId: string,
    @Body() dto: CreateCustomerNoteDto,
    @Scope() scope: RequestScope,
  ): Promise<CustomerNoteView> {
    return this.customersService.createNote(customerId, dto, scope);
  }

  @Post(":customerId/files")
  @ApiParam({ name: "customerId" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        displayName: { type: "string" },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: CUSTOMER_FILE_UPLOAD_LIMIT_BYTES },
    }),
  )
  @BaseOpenApiResponse(CustomerFileView, { status: 201 })
  uploadFile(
    @Param("customerId") customerId: string,
    @Body() dto: UploadCustomerFileDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Scope() scope: RequestScope,
  ): Promise<CustomerFileView> {
    return this.customersService.uploadFile(customerId, dto, file, scope);
  }

  @Delete(":customerId/files/:fileId")
  @ApiParam({ name: "customerId" })
  @ApiParam({ name: "fileId" })
  @BaseOpenApiResponse(CustomerFileView)
  deleteFile(
    @Param("customerId") customerId: string,
    @Param("fileId") fileId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerFileView> {
    return this.customersService.deleteFile(customerId, fileId, scope);
  }
}

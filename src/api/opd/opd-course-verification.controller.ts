import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { RequirePermissions } from "../../auth/permissions.decorator";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import {
  OpdCourseVerificationPreflightDto,
  RequestOpdCourseCompensationDto,
  ReviewOpdCourseCompensationDto,
  VerifyOpdCourseReservationDto,
} from "./dto/opd-course-verification.dto";
import {
  OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS,
  OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS,
  OPD_COURSE_EVIDENCE_READ_PERMISSIONS,
  OPD_COURSE_VERIFY_PERMISSIONS,
  OpdCourseCompensationResult,
  OpdCourseVerificationDocumentResult,
  OpdCourseVerificationPreflightResult,
  OpdCourseVerificationResult,
} from "./opd-course-verification.mapper";
import { OpdCourseVerificationService } from "./opd-course-verification.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

const SIGNATURE_UPLOAD_LIMIT_BYTES = 1024 * 1024;
const COURSE_READ_PERMISSIONS = [
  "OPD_READ",
  "TREATMENT_READ",
  "CUSTOMER_COURSE_READ",
] as const;

@ApiTags("OPD Existing Course Verification")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/opd")
export class OpdCourseVerificationController {
  constructor(private readonly service: OpdCourseVerificationService) {}

  @Post(
    ":encounterId/course-reservations/:reservationId/verification/preflight",
  )
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(...COURSE_READ_PERMISSIONS)
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @BaseOpenApiResponse(OpdCourseVerificationPreflightResult)
  preflight(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Body() dto: OpdCourseVerificationPreflightDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdCourseVerificationPreflightResult> {
    return this.service.preflight(encounterId, reservationId, dto, scope);
  }

  @Post(":encounterId/course-reservations/:reservationId/verification")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(...OPD_COURSE_VERIFY_PERMISSIONS)
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable 8-200 character key reused only for this verification",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: [
        "preflightToken",
        "expectedVersion",
        "acknowledgementVersion",
        "acknowledgementLocale",
        "signature",
      ],
      properties: {
        preflightToken: { type: "string" },
        expectedVersion: { type: "integer", minimum: 1 },
        acknowledgementVersion: { type: "string" },
        acknowledgementLocale: {
          type: "string",
          enum: ["th-TH", "en-US"],
        },
        signature: {
          type: "string",
          format: "binary",
          description: "Fresh customer signature in PNG format",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("signature", {
      limits: {
        files: 1,
        fileSize: SIGNATURE_UPLOAD_LIMIT_BYTES,
        fields: 4,
      },
    }),
  )
  @BaseOpenApiResponse(OpdCourseVerificationResult, { status: 201 })
  verify(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Body() dto: VerifyOpdCourseReservationDto,
    @UploadedFile() signature: Express.Multer.File | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
    @Ip() clientIp: string,
    @Headers("user-agent") userAgent: string | undefined,
  ): Promise<OpdCourseVerificationResult> {
    return this.service.verify(
      encounterId,
      reservationId,
      dto,
      signature,
      idempotencyKey,
      scope,
      principal,
      { clientIp, userAgent },
    );
  }

  @Post(
    ":encounterId/course-reservations/:reservationId/verification/compensation-requests",
  )
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(...OPD_COURSE_COMPENSATION_REQUEST_PERMISSIONS)
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Stable 8-200 character key reused only for this compensation request",
  })
  @BaseOpenApiResponse(OpdCourseCompensationResult, { status: 201 })
  requestCompensation(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Body() dto: RequestOpdCourseCompensationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdCourseCompensationResult> {
    return this.service.requestCompensation(
      encounterId,
      reservationId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Post(
    ":encounterId/course-reservations/:reservationId/verification/compensation-requests/:requestId/reject",
  )
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(...OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS)
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @ApiParam({ name: "requestId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Stable 8-200 character key reused only for this compensation rejection",
  })
  @BaseOpenApiResponse(OpdCourseCompensationResult)
  rejectCompensation(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: ReviewOpdCourseCompensationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdCourseCompensationResult> {
    return this.service.rejectCompensation(
      encounterId,
      reservationId,
      requestId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Post(
    ":encounterId/course-reservations/:reservationId/verification/compensation-requests/:requestId/approve",
  )
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(...OPD_COURSE_COMPENSATION_REVIEW_PERMISSIONS)
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @ApiParam({ name: "requestId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Stable 8-200 character key reused only for this compensation approval",
  })
  @BaseOpenApiResponse(OpdCourseCompensationResult)
  approveCompensation(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: ReviewOpdCourseCompensationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpdCourseCompensationResult> {
    return this.service.approveCompensation(
      encounterId,
      reservationId,
      requestId,
      dto,
      idempotencyKey,
      scope,
      principal,
    );
  }

  @Get(":encounterId/course-reservations/:reservationId/verification/document")
  @RequirePermissions(...OPD_COURSE_EVIDENCE_READ_PERMISSIONS)
  @ApiParam({ name: "encounterId", format: "uuid" })
  @ApiParam({ name: "reservationId", format: "uuid" })
  @BaseOpenApiResponse(OpdCourseVerificationDocumentResult)
  document(
    @Param("encounterId", new ParseUUIDPipe()) encounterId: string,
    @Param("reservationId", new ParseUUIDPipe()) reservationId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdCourseVerificationDocumentResult> {
    return this.service.document(encounterId, reservationId, scope);
  }
}

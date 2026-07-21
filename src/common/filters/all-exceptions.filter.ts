import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

interface ErrorResponse {
  status: "8999" | "9999";
  message: string;
  code?: string;
  resourceType?: string;
  resourceId?: string;
  currentVersion?: number;
  currentStatus?: string;
  updatedAt?: string;
  details?: unknown;
}

/**
 * Maps all thrown errors to the standard error contract:
 *   { status: "8999", message }  -> known/business (HttpException)
 *   { status: "9999", message }  -> unexpected/technical
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const httpStatus = exception.getStatus();
      const details = this.extractDetails(exception);
      const body: ErrorResponse = {
        status: "8999",
        message: this.extractMessage(exception),
        ...details,
      };
      response.status(httpStatus).json(body);
      return;
    }

    this.logger.error(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception),
    );
    const body: ErrorResponse = {
      status: "9999",
      message: "Internal server error",
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }

  private extractMessage(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === "string") {
      return res;
    }
    if (typeof res === "object" && res !== null && "message" in res) {
      const message = (res as { message: unknown }).message;
      if (Array.isArray(message)) {
        return message.join(", ");
      }
      if (typeof message === "string") {
        return message;
      }
    }
    return exception.message;
  }

  private extractDetails(
    exception: HttpException,
  ): Omit<ErrorResponse, "status" | "message"> {
    const response = exception.getResponse();
    if (typeof response !== "object" || response === null) return {};

    const candidate = response as Record<string, unknown>;
    return {
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
      ...(typeof candidate.resourceType === "string"
        ? { resourceType: candidate.resourceType }
        : {}),
      ...(typeof candidate.resourceId === "string"
        ? { resourceId: candidate.resourceId }
        : {}),
      ...(typeof candidate.currentVersion === "number"
        ? { currentVersion: candidate.currentVersion }
        : {}),
      ...(typeof candidate.currentStatus === "string"
        ? { currentStatus: candidate.currentStatus }
        : {}),
      ...(typeof candidate.updatedAt === "string"
        ? { updatedAt: candidate.updatedAt }
        : {}),
      ...(candidate.details !== undefined
        ? { details: candidate.details }
        : {}),
    };
  }
}

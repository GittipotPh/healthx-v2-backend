import { applyDecorators, type Type } from "@nestjs/common";
import {
  ApiDefaultResponse,
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from "@nestjs/swagger";

/**
 * OpenAPI documentation for the global response contract (see
 * ResponseInterceptor / AllExceptionsFilter):
 *   success -> { status: "0000", data: ... }
 *   error   -> { status: "8999" | "9999", message: "..." }
 *
 * These decorators only shape the generated spec — they never touch the
 * runtime response.
 */

/** Error envelope produced by AllExceptionsFilter for every 4xx/5xx. */
export class ApiErrorEnvelope {
  @ApiProperty({
    enum: ["8999", "9999"],
    enumName: "ApiErrorStatus",
    description:
      '"8999" = known/business error (HttpException), "9999" = unexpected/technical error',
  })
  status!: "8999" | "9999";

  @ApiProperty({ description: "Human-readable error message" })
  message!: string;

  @ApiPropertyOptional({ description: "Stable business error code" })
  code?: string;

  @ApiPropertyOptional({ description: "Conflicted resource type" })
  resourceType?: string;

  @ApiPropertyOptional({ description: "Conflicted resource identity" })
  resourceId?: string;

  @ApiPropertyOptional({ description: "Current server resource version" })
  currentVersion?: number;

  @ApiPropertyOptional({ description: "Current server resource status" })
  currentStatus?: string;

  @ApiPropertyOptional({ description: "Current server update timestamp" })
  updatedAt?: string;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description:
      "Structured business-error context such as release blockers or replacement totals",
  })
  details?: Record<string, unknown>;
}

export interface EnvelopeResponseOptions {
  /** HTTP status of the success response (default 200). */
  status?: number;
  description?: string;
}

function envelopeSchema(
  dataSchema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    required: ["status", "data"],
    properties: {
      status: {
        type: "string",
        enum: ["0000"],
        description: 'Success marker — always "0000"',
      },
      data: dataSchema,
    },
  };
}

/** Documents a success response whose `data` is a single `model`. */
export function BaseOpenApiResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: EnvelopeResponseOptions = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? 200,
      description:
        options.description ?? `Success envelope wrapping ${model.name}`,
      schema: envelopeSchema({ $ref: getSchemaPath(model) }),
    }),
  );
}

/** Documents a success response whose `data` is an array of `model`. */
export function BaseOpenApiArrayResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: EnvelopeResponseOptions = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? 200,
      description:
        options.description ?? `Success envelope wrapping ${model.name}[]`,
      schema: envelopeSchema({
        type: "array",
        items: { $ref: getSchemaPath(model) },
      }),
    }),
  );
}

/**
 * Documents the shared error contract. Applied once per controller class so
 * every route advertises the `{ status, message }` error envelope for any
 * non-2xx outcome.
 */
export function BaseOpenApiErrorResponses(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorEnvelope),
    ApiDefaultResponse({
      description:
        'Error envelope — any 4xx/5xx: { status: "8999" | "9999", message }',
      schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
    }),
  );
}

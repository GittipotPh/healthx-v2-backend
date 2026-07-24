import Joi from "joi";

try {
  process.loadEnvFile();
} catch {
  // .env is optional; deployment environments usually provide variables directly.
}

export interface BackendEnv {
  NODE_ENV: "development" | "test" | "production";
  APP_PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN_SECONDS: number;
  REFRESH_TTL_DAYS: number;
  REDIS_URL: string;
  WEB_BASE_URL: string;
  API_PUBLIC_BASE_URL: string;
  STORAGE_PROVIDER: "minio" | "azure";
  STORAGE_BUCKET: string;
  STORAGE_PUBLIC_BASE_URL?: string;
  STORAGE_AUTO_CREATE_CONTAINER: boolean;
  STORAGE_READ_URL_TTL_SECONDS: number;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE: boolean;
  AZURE_STORAGE_ACCOUNT_URL?: string;
  AZURE_BLOB_CONTAINER?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_STORAGE_CONNECTION_STRING?: string;
  AZURE_BLOB_CONNECTION?: string;
  AZURE_STORAGE_ACCOUNT?: string;
  CUSTOMER_FILE_MAX_BYTES: number;
  CORS_ORIGINS?: string;
  AUTH_COOKIE_DOMAIN?: string;
  ERP_OUTBOX_ENABLED: boolean;
  RABBITMQ_URL?: string;
  ERP_OUTBOX_POLL_MS: number;
  ERP_COMMAND_API_ENABLED: boolean;
  ERP_SERVICE_KEY?: string;
  ERP_ALLOWED_BRANCH_IDS?: string;
  OPD_V2_ENABLED: boolean;
  OPD_COURSE_RESERVATION_ENABLED: boolean;
  OPD_COURSE_VERIFICATION_ENABLED: boolean;
  OPD_CHART_RASTER_AUTOSAVE_ENABLED: boolean;
}

const schema = Joi.object<BackendEnv>({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  APP_PORT: Joi.number().integer().port().default(8080),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN_SECONDS: Joi.number()
    .integer()
    .min(60)
    .default(15 * 60),
  REFRESH_TTL_DAYS: Joi.number().integer().min(1).default(30),
  REDIS_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .default("redis://localhost:6379"),
  WEB_BASE_URL: Joi.string().uri().default("http://localhost:3000"),
  API_PUBLIC_BASE_URL: Joi.string().uri().default("http://localhost:8080"),
  STORAGE_PROVIDER: Joi.string().valid("minio", "azure").default("minio"),
  STORAGE_BUCKET: Joi.string().min(3).default("healthx-local"),
  STORAGE_PUBLIC_BASE_URL: Joi.string().uri().optional(),
  STORAGE_AUTO_CREATE_CONTAINER: Joi.when("STORAGE_PROVIDER", {
    is: "azure",
    then: Joi.boolean().valid(false).default(false),
    otherwise: Joi.boolean().default(true),
  }),
  STORAGE_READ_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(600)
    .default(600),
  S3_ENDPOINT: Joi.when("STORAGE_PROVIDER", {
    is: "minio",
    then: Joi.string().uri().default("http://localhost:9000"),
    otherwise: Joi.string().optional(),
  }),
  S3_REGION: Joi.when("STORAGE_PROVIDER", {
    is: "minio",
    then: Joi.string().default("us-east-1"),
    otherwise: Joi.string().optional(),
  }),
  S3_ACCESS_KEY_ID: Joi.when("STORAGE_PROVIDER", {
    is: "minio",
    then: Joi.string().default("minioadmin"),
    otherwise: Joi.string().optional(),
  }),
  S3_SECRET_ACCESS_KEY: Joi.when("STORAGE_PROVIDER", {
    is: "minio",
    then: Joi.string().default("minioadmin"),
    otherwise: Joi.string().optional(),
  }),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  AZURE_STORAGE_ACCOUNT_URL: Joi.when("STORAGE_PROVIDER", {
    is: "azure",
    then: Joi.string()
      .uri({ scheme: ["https"] })
      .required(),
    otherwise: Joi.string().optional(),
  }),
  AZURE_BLOB_CONTAINER: Joi.when("STORAGE_PROVIDER", {
    is: "azure",
    then: Joi.string()
      .pattern(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/)
      .required(),
    otherwise: Joi.string().optional(),
  }),
  AZURE_CLIENT_ID: Joi.when("STORAGE_PROVIDER", {
    is: "azure",
    then: Joi.string()
      .guid({ version: ["uuidv4"] })
      .required(),
    otherwise: Joi.string().optional(),
  }),
  AZURE_STORAGE_CONNECTION_STRING: Joi.any().forbidden(),
  AZURE_BLOB_CONNECTION: Joi.any().forbidden(),
  AZURE_STORAGE_ACCOUNT: Joi.any().forbidden(),
  CUSTOMER_FILE_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(25 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  CORS_ORIGINS: Joi.when("NODE_ENV", {
    is: "production",
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  AUTH_COOKIE_DOMAIN: Joi.string().optional(),
  // ERP boundary (plan-latest §9): capability gates fail fast — enabling a
  // capability without its config is a boot error, not a runtime surprise.
  ERP_OUTBOX_ENABLED: Joi.boolean().default(false),
  RABBITMQ_URL: Joi.when("ERP_OUTBOX_ENABLED", {
    is: true,
    then: Joi.string()
      .uri({ scheme: ["amqp", "amqps"] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ["amqp", "amqps"] })
      .optional(),
  }),
  ERP_OUTBOX_POLL_MS: Joi.number()
    .integer()
    .min(500)
    .max(60_000)
    .default(5_000),
  ERP_COMMAND_API_ENABLED: Joi.boolean().default(false),
  ERP_SERVICE_KEY: Joi.when("ERP_COMMAND_API_ENABLED", {
    is: true,
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().optional(),
  }),
  // Comma-separated ERP branch codes the service key may touch. Required when
  // the command API is on: an empty allowlist would silently reject everything.
  ERP_ALLOWED_BRANCH_IDS: Joi.when("ERP_COMMAND_API_ENABLED", {
    is: true,
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().optional(),
  }),
  // Deployment kill switch for the new OPD worklist/start/workspace slice.
  // Existing legacy OPD list/history and shared Queue routes remain available.
  OPD_V2_ENABLED: Joi.boolean().default(true),
  // Phase 3C production kill switch. Local code and read models may exist while
  // all reserve/void commands remain disabled until the dual-writer gate passes.
  OPD_COURSE_RESERVATION_ENABLED: Joi.boolean().default(false),
  // Phase 3D production kill switch. Verification, evidence creation, inventory
  // deduction, and compensation stay independently disabled by default.
  OPD_COURSE_VERIFICATION_ENABLED: Joi.boolean().default(false),
  // Image-first Chart writes remain off in deployed environments until the
  // storage/RBAC/synthetic Azure rehearsal is separately approved.
  OPD_CHART_RASTER_AUTOSAVE_ENABLED: Joi.boolean().default(false),
}).unknown(true);

let cached: BackendEnv | undefined;

export function validateEnv(
  source: NodeJS.ProcessEnv = process.env,
): BackendEnv {
  const { error, value } = schema.validate(source, {
    abortEarly: false,
    convert: true,
    errors: { label: "key" },
  });

  if (error) {
    const details = error.details
      .map((detail) => `- ${detail.message}`)
      .join("\n");
    throw new Error(`Invalid backend environment:\n${details}`);
  }

  return value;
}

export function backendEnv(): BackendEnv {
  cached ??= validateEnv();
  return cached;
}

export function resetBackendEnvForTest(): void {
  cached = undefined;
}

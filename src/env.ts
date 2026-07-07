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
  STORAGE_PROVIDER: "minio" | "azure";
  STORAGE_BUCKET: string;
  STORAGE_PUBLIC_BASE_URL?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE: boolean;
  AZURE_STORAGE_CONNECTION_STRING?: string;
  AZURE_BLOB_CONTAINER?: string;
  CUSTOMER_FILE_MAX_BYTES: number;
  CORS_ORIGINS?: string;
  AUTH_COOKIE_DOMAIN?: string;
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
  STORAGE_PROVIDER: Joi.string().valid("minio", "azure").default("minio"),
  STORAGE_BUCKET: Joi.string().min(3).default("healthx-local"),
  STORAGE_PUBLIC_BASE_URL: Joi.string().uri().optional(),
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
  AZURE_STORAGE_CONNECTION_STRING: Joi.when("STORAGE_PROVIDER", {
    is: "azure",
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  AZURE_BLOB_CONTAINER: Joi.when("STORAGE_PROVIDER", {
    is: "azure",
    then: Joi.string().min(3).default("healthx-local"),
    otherwise: Joi.string().optional(),
  }),
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

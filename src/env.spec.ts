import { validateEnv } from "./env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/healthx_test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
};

describe("env", () => {
  it("throws a clear error when required variables are missing", () => {
    expect(() => validateEnv({})).toThrow(/Invalid backend environment/);
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({})).toThrow(/JWT_SECRET/);
  });

  it("parses defaults and numeric values", () => {
    const env = validateEnv({
      ...BASE_ENV,
      APP_PORT: "9090",
      JWT_EXPIRES_IN_SECONDS: "600",
      REFRESH_TTL_DAYS: "7",
    });

    expect(env.APP_PORT).toBe(9090);
    expect(env.JWT_EXPIRES_IN_SECONDS).toBe(600);
    expect(env.REFRESH_TTL_DAYS).toBe(7);
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.API_PUBLIC_BASE_URL).toBe("http://localhost:8080");
    expect(env.STORAGE_PROVIDER).toBe("minio");
    expect(env.STORAGE_BUCKET).toBe("healthx-local");
    expect(env.S3_ENDPOINT).toBe("http://localhost:9000");
    expect(env.STORAGE_AUTO_CREATE_CONTAINER).toBe(true);
    expect(env.STORAGE_READ_URL_TTL_SECONDS).toBe(600);
  });

  it("requires managed-identity Azure settings when Azure is selected", () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, STORAGE_PROVIDER: "azure" }),
    ).toThrow(/AZURE_STORAGE_ACCOUNT_URL/);

    const env = validateEnv({
      ...BASE_ENV,
      STORAGE_PROVIDER: "azure",
      AZURE_STORAGE_ACCOUNT_URL: "https://healthxv2dev.blob.core.windows.net",
      AZURE_BLOB_CONTAINER: "healthx-dev",
      AZURE_CLIENT_ID: "0a737a07-f038-4c2f-bc17-1cf1c65590cc",
      STORAGE_AUTO_CREATE_CONTAINER: "false",
    });
    expect(env.STORAGE_PROVIDER).toBe("azure");
    expect(env.AZURE_BLOB_CONTAINER).toBe("healthx-dev");
    expect(env.STORAGE_AUTO_CREATE_CONTAINER).toBe(false);
  });

  it("rejects Shared Key Azure settings", () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        STORAGE_PROVIDER: "azure",
        AZURE_STORAGE_ACCOUNT_URL: "https://healthxv2dev.blob.core.windows.net",
        AZURE_BLOB_CONTAINER: "healthx-dev",
        AZURE_CLIENT_ID: "0a737a07-f038-4c2f-bc17-1cf1c65590cc",
        AZURE_STORAGE_CONNECTION_STRING: "AccountName=forbidden",
      }),
    ).toThrow(/AZURE_STORAGE_CONNECTION_STRING/);
  });

  it("requires explicit CORS origins in production", () => {
    expect(() => validateEnv({ ...BASE_ENV, NODE_ENV: "production" })).toThrow(
      /CORS_ORIGINS/,
    );

    const env = validateEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.healthx-pro.com",
    });
    expect(env.CORS_ORIGINS).toBe("https://app.healthx-pro.com");
  });

  it("requires RABBITMQ_URL when the outbox dispatcher is enabled", () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, ERP_OUTBOX_ENABLED: "true" }),
    ).toThrow(/RABBITMQ_URL/);

    const env = validateEnv({
      ...BASE_ENV,
      ERP_OUTBOX_ENABLED: "true",
      RABBITMQ_URL: "amqp://user:pass@localhost:5672",
    });
    expect(env.ERP_OUTBOX_ENABLED).toBe(true);
    expect(env.ERP_OUTBOX_POLL_MS).toBe(5000);
  });

  it("requires the service key and branch allowlist when the command API is enabled", () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, ERP_COMMAND_API_ENABLED: "true" }),
    ).toThrow(/ERP_SERVICE_KEY/);
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        ERP_COMMAND_API_ENABLED: "true",
        ERP_SERVICE_KEY: "phase4-test-service-key-0123456789abcdef",
      }),
    ).toThrow(/ERP_ALLOWED_BRANCH_IDS/);

    const env = validateEnv({
      ...BASE_ENV,
      ERP_COMMAND_API_ENABLED: "true",
      ERP_SERVICE_KEY: "phase4-test-service-key-0123456789abcdef",
      ERP_ALLOWED_BRANCH_IDS: "BR-001,BR-002",
    });
    expect(env.ERP_COMMAND_API_ENABLED).toBe(true);
    // Both capabilities stay off by default — dev without a broker must boot.
    expect(validateEnv(BASE_ENV).ERP_OUTBOX_ENABLED).toBe(false);
    expect(validateEnv(BASE_ENV).ERP_COMMAND_API_ENABLED).toBe(false);
    expect(validateEnv(BASE_ENV).OPD_V2_ENABLED).toBe(true);
    expect(validateEnv(BASE_ENV).OPD_COURSE_RESERVATION_ENABLED).toBe(false);
    expect(validateEnv(BASE_ENV).OPD_COURSE_VERIFICATION_ENABLED).toBe(false);
    expect(validateEnv(BASE_ENV).OPD_CHART_RASTER_AUTOSAVE_ENABLED).toBe(false);
  });
});

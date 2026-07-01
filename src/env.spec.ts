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
});

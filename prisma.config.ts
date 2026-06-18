import { defineConfig, env } from "prisma/config";

// Load .env into process.env so env("DATABASE_URL") resolves (Node >= 22).
try {
  process.loadEnvFile();
} catch {
  // .env is optional; the variable may already be present in the environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { allowedOrigins } from "./common/origins";
import { backendEnv } from "./env";

async function bootstrap(): Promise<void> {
  const env = backendEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind Azure's reverse proxy: trust the first hop so req.ip / X-Forwarded-For
  // reflect the real client (used by the rate limiter), not the proxy.
  app.set("trust proxy", 1);

  app.setGlobalPrefix("api/v1");
  // Security headers (HSTS, no-sniff, frameguard, etc.). The API serves JSON only,
  // so the default CSP isn't needed and would only complicate non-HTML responses.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Cookie auth requires explicit origins (never `*`) and credentialed requests.
  app.enableCors({ origin: allowedOrigins(), credentials: true });

  // OpenAPI spec + Swagger UI — tooling only, never exposed in production.
  // UI at /api, JSON spec at /api-json (consumed by the frontend's `pnpm codegen`).
  if (env.NODE_ENV !== "production") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("HealthX Clinic Operations API")
      .setVersion("1.0")
      .setDescription(
        'Every response is wrapped by the global contract: success `{ status: "0000", data }`, ' +
          'error `{ status: "8999" | "9999", message }`. Auth rides in the HttpOnly `hx_token` cookie; ' +
          "the active clinic/branch scope is sent via the `x-clinic-id` / `x-branch-id` headers.",
      )
      .addCookieAuth("hx_token")
      .addGlobalParameters(
        {
          name: "x-clinic-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description: "Active clinic scope (validated by ScopeGuard)",
        },
        {
          name: "x-branch-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description: "Active branch scope (validated by ScopeGuard)",
        },
      )
      .build();
    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup("api", app, document);
  }

  await app.listen(env.APP_PORT);
}

void bootstrap();

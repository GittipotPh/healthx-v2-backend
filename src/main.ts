import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
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

  await app.listen(env.APP_PORT);
}

void bootstrap();

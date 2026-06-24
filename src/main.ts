import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { allowedOrigins } from "./common/origins";

// Load .env into process.env (Node >= 22) before anything reads it.
try {
  process.loadEnvFile();
} catch {
  // .env is optional; variables may already be in the environment.
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api/v1");
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

  const port = Number(process.env.APP_PORT ?? 8080);
  await app.listen(port);
}

void bootstrap();

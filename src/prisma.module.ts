import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Global so every feature module shares one PrismaService (one connection
 * pool). Never redeclare PrismaService in a feature module's providers —
 * that creates a second client with its own pool.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

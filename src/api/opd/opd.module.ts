import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { OpdController } from "./opd.controller";
import { OpdService } from "./opd.service";
import { OpdRepository } from "./opd.repository";

@Module({
  controllers: [OpdController],
  providers: [OpdService, OpdRepository, PrismaService],
  exports: [OpdService],
})
export class OpdModule {}

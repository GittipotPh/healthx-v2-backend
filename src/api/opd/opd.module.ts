import { Module } from "@nestjs/common";
import { OpdController } from "./opd.controller";
import { OpdService } from "./opd.service";
import { OpdRepository } from "./opd.repository";

@Module({
  controllers: [OpdController],
  providers: [OpdService, OpdRepository],
  exports: [OpdService],
})
export class OpdModule {}

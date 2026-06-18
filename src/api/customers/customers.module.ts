import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { CustomersRepository } from "./customers.repository";

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository, PrismaService],
  exports: [CustomersService],
})
export class CustomersModule {}

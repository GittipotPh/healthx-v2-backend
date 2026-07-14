import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../auth/scope.decorator";
import { ErpCommandDto } from "./dto/erp-command.dto";
import { ErpCommandService, type ErpCommandResult } from "./erp-command.service";
import { ServiceKeyGuard } from "./service-key.guard";

/**
 * Internal service-to-service surface: POST /api/v1/internal/erp/commands.
 * @Public() skips the user JWT/scope guards; ServiceKeyGuard is the gate
 * (constant-time x-service-key). Not part of the frontend OpenAPI contract.
 */
@ApiExcludeController()
@Public()
@UseGuards(ServiceKeyGuard)
@Controller("internal/erp")
export class ErpCommandController {
  constructor(private readonly commands: ErpCommandService) {}

  @Post("commands")
  apply(@Body() dto: ErpCommandDto): Promise<ErpCommandResult> {
    return this.commands.apply(dto);
  }
}

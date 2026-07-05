import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ClinicService, type BranchView } from "./clinic.service";
import { AccessibleBranch } from "../../common/branch-access/branch-access.service";
import {
  BaseOpenApiArrayResponse,
  BaseOpenApiErrorResponses,
} from "../../common/openapi/api-envelope";
import { RequireClinic, Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@ApiTags("Clinic")
@BaseOpenApiErrorResponses()
@Controller("clinic")
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @Get("branches")
  @RequireClinic()
  @BaseOpenApiArrayResponse(AccessibleBranch)
  branches(@Scope() scope: RequestScope): Promise<BranchView[]> {
    return this.clinicService.branches(scope);
  }
}

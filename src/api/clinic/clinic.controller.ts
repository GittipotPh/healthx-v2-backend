import { Controller, Get } from "@nestjs/common";
import { ClinicService, type BranchView } from "./clinic.service";
import { RequireClinic, Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@Controller("clinic")
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @Get("branches")
  @RequireClinic()
  branches(@Scope() scope: RequestScope): Promise<BranchView[]> {
    return this.clinicService.branches(scope);
  }
}

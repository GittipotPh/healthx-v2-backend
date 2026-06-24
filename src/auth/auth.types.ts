import type { role_enum } from "@prisma/client";

/** Identity carried by the access token — a person (email), not a clinic. */
export interface JwtPrincipalPayload {
  email: string;
  name: string;
}

/** Authenticated principal attached to the request by JwtAuthGuard. */
export type Principal = JwtPrincipalPayload;

/**
 * Validated clinic/branch scope attached to the request by ScopeGuard.
 * `branchId` is "" for clinic-only routes (e.g. branch listing).
 */
export interface RequestScope {
  userId: string;
  clinicId: string;
  branchId: string;
  isClinicRootUser: boolean;
  roles: role_enum[];
}

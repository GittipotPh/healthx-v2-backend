import type { AppointmentOption } from "./appointments.mapper";

export const CONSULT_TYPE_OPTIONS: AppointmentOption[] = [
  { id: "consult", label: "Consult" },
  { id: "procedure", label: "Procedure" },
  { id: "follow-up", label: "Follow-up" },
];

export const MARKETING_PLATFORM_OPTIONS: AppointmentOption[] = [
  { id: "facebook", label: "Facebook" },
  { id: "line", label: "LINE" },
  { id: "google-ads", label: "Google Ads" },
  { id: "walk-in", label: "Walk-in" },
  { id: "instagram", label: "Instagram" },
];

export const MARKETING_CAMPAIGN_OPTIONS: AppointmentOption[] = [
  { id: "birthday-promotion", label: "Birthday Promotion" },
  { id: "member-special", label: "Member Special" },
  { id: "flash-sale", label: "Flash Sale" },
  { id: "new-year-campaign", label: "New Year Campaign" },
];

export const PREPARATION_TAG_OPTIONS: AppointmentOption[] = [
  { id: "no-vitamins", label: "No vitamins" },
  { id: "no-alcohol", label: "No alcohol" },
  { id: "fasting", label: "Fasting" },
  { id: "wash-face", label: "Wash face" },
  { id: "numbing-cream", label: "Numbing cream" },
];

export const INTERNAL_TAG_OPTIONS: AppointmentOption[] = [
  { id: "laser-zone", label: "Laser zone" },
  { id: "vip", label: "VIP patient" },
  { id: "special-care", label: "Special care" },
];

export const NUMBING_DURATION_OPTIONS: number[] = [30, 45, 60];

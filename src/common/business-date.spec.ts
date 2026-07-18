import { bangkokBusinessDate, isIsoBusinessDate } from "./business-date";

describe("Bangkok business dates", () => {
  it("uses the Bangkok day when UTC is still on the previous date", () => {
    expect(bangkokBusinessDate(new Date("2026-07-17T18:30:00.000Z"))).toBe("2026-07-18");
  });

  it("keeps the prior Bangkok date immediately before midnight rollover", () => {
    expect(bangkokBusinessDate(new Date("2026-07-17T16:59:59.999Z"))).toBe("2026-07-17");
  });

  it.each(["2026-07-18", "2024-02-29"])("accepts a real ISO date: %s", (value) => {
    expect(isIsoBusinessDate(value)).toBe(true);
  });

  it.each(["2026-2-03", "2026-02-30", "not-a-date", ""])(
    "rejects an invalid business date: %s",
    (value) => {
      expect(isIsoBusinessDate(value)).toBe(false);
    },
  );
});

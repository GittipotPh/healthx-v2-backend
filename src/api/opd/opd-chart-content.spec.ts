import {
  OPD_CHART_TEMPLATE_VERSION,
} from "./opd-chart-template.registry";
import type { SaveOpdChartDocumentDto } from "./dto/opd-chart.dto";
import {
  hashOpdChartContent,
  normalizeOpdChartContent,
} from "./opd-chart-content";

describe("opd-chart-content", () => {
  it("trims bounded metadata and produces a stable raster content hash", () => {
    const dto = chartDto();
    const first = normalizeOpdChartContent(dto, "a".repeat(64));
    const second = normalizeOpdChartContent(dto, "a".repeat(64));

    expect(first).toEqual(second);
    expect(first.metadata).toEqual({
      location: "left cheek",
      character: "",
      size: "",
      side: "left",
      doctorNote: "",
    });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.hasClinicalMetadata).toBe(true);
  });

  it("changes the content hash when either PNG or metadata changes", () => {
    const dto = chartDto();
    const first = normalizeOpdChartContent(dto, "a".repeat(64));
    const changedPng = normalizeOpdChartContent(dto, "b".repeat(64));
    const changedMetadata = normalizeOpdChartContent(
      { ...dto, doctorNote: "reviewed" },
      "a".repeat(64),
    );

    expect(changedPng.contentHash).not.toBe(first.contentHash);
    expect(changedMetadata.contentHash).not.toBe(first.contentHash);
  });

  it("canonicalizes metadata key order", () => {
    expect(
      hashOpdChartContent("a".repeat(64), {
        side: "left",
        location: "face",
      }),
    ).toBe(
      hashOpdChartContent("a".repeat(64), {
        location: "face",
        side: "left",
      }),
    );
  });
});

function chartDto(): SaveOpdChartDocumentDto {
  return {
    expectedVersion: 0,
    templateVersion: OPD_CHART_TEMPLATE_VERSION,
    clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    location: " left cheek ",
    character: "",
    size: "",
    side: " left ",
    doctorNote: "",
  };
}

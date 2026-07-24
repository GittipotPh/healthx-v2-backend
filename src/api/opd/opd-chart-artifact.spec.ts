import { deflateSync } from "node:zlib";
import {
  normalizeOpdChartPng,
  renderOpdChartPdf,
} from "./opd-chart-artifact";
import {
  OPD_CHART_CANVAS_HEIGHT,
  OPD_CHART_CANVAS_WIDTH,
  OPD_CHART_TEMPLATE_VERSION,
} from "./opd-chart-template.registry";

describe("OPD Chart render artifacts", () => {
  it("normalizes a canonical Chart PNG and renders a hash-linked PDF", () => {
    const image = normalizeOpdChartPng(
      rgbPng(OPD_CHART_CANVAS_WIDTH, OPD_CHART_CANVAS_HEIGHT),
    );
    const pdf = renderOpdChartPdf({
      templateCode: "male-face-front",
      templateVersion: OPD_CHART_TEMPLATE_VERSION,
      contentHash: "a".repeat(64),
      finalizedAt: "2026-07-23T12:00:00.000Z",
      image,
    });
    const pdfText = pdf.toString("latin1");

    expect(image.width).toBe(OPD_CHART_CANVAS_WIDTH);
    expect(image.height).toBe(OPD_CHART_CANVAS_HEIGHT);
    expect(image.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(pdfText.startsWith("%PDF-1.7")).toBe(true);
    expect(pdfText).toContain("HealthX OPD Chart");
    expect(pdfText).toContain(`PNG SHA-256 ${image.hash}`);
    expect(pdfText).toContain("%%EOF");
  });

  it("rejects a PNG with non-canonical Chart dimensions", () => {
    expect(() => normalizeOpdChartPng(rgbPng(960, 700))).toThrow(
      "exact 960 x 680",
    );
  });

  it("rejects a PNG whose checksum changed", () => {
    const source = rgbPng(
      OPD_CHART_CANVAS_WIDTH,
      OPD_CHART_CANVAS_HEIGHT,
    );
    source[source.length - 5] ^= 0xff;

    expect(() => normalizeOpdChartPng(source)).toThrow("PNG checksum failed");
  });
});

function rgbPng(width: number, height: number): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    rows[row * (width * 3 + 1)] = 0;
    const column = Math.min(width - 1, Math.floor((row * width) / height));
    const pixel = row * (width * 3 + 1) + 1 + column * 3;
    rows[pixel] = 30;
    rows[pixel + 1] = 80;
    rows[pixel + 2] = 180;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length,
  );
  return output;
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

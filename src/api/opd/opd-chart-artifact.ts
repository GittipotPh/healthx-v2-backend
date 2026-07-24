import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import {
  OPD_CHART_CANVAS_HEIGHT,
  OPD_CHART_CANVAS_WIDTH,
} from "./opd-chart-template.registry";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_CHART_DIMENSION = 2880;
const MAX_DECODED_CHART_BYTES =
  MAX_CHART_DIMENSION * MAX_CHART_DIMENSION * 4 + MAX_CHART_DIMENSION;

export interface NormalizedOpdChartPng {
  bytes: Buffer;
  rgb: Buffer;
  width: number;
  height: number;
  hash: string;
}

export interface OpdChartPdfInput {
  templateCode: string;
  templateVersion: string;
  contentHash: string;
  finalizedAt: string;
  image: NormalizedOpdChartPng;
}

interface ParsedPng {
  width: number;
  height: number;
  colorType: 2 | 6;
  compressed: Buffer;
}

export function normalizeOpdChartPng(source: Buffer): NormalizedOpdChartPng {
  const parsed = parsePng(source);
  if (
    parsed.width !== OPD_CHART_CANVAS_WIDTH ||
    parsed.height !== OPD_CHART_CANVAS_HEIGHT
  ) {
    throw new Error(
      "CHART_RENDER_INVALID: PNG must use the exact 960 x 680 Chart dimensions",
    );
  }

  const bytesPerPixel = parsed.colorType === 6 ? 4 : 3;
  const rowBytes = parsed.width * bytesPerPixel;
  const expectedBytes = (rowBytes + 1) * parsed.height;
  const inflated = inflateSync(parsed.compressed, {
    maxOutputLength: Math.min(MAX_DECODED_CHART_BYTES, expectedBytes + 1),
  });
  if (inflated.length !== expectedBytes) {
    throw new Error("CHART_RENDER_INVALID: PNG pixel data is incomplete");
  }

  const reconstructed = unfilterPng(
    inflated,
    parsed.width,
    parsed.height,
    bytesPerPixel,
  );
  const rgb = Buffer.alloc(parsed.width * parsed.height * 3);
  for (let pixel = 0; pixel < parsed.width * parsed.height; pixel += 1) {
    const sourceOffset = pixel * bytesPerPixel;
    const targetOffset = pixel * 3;
    const alpha =
      parsed.colorType === 6 ? reconstructed[sourceOffset + 3] : 255;
    rgb[targetOffset] = blendOnWhite(reconstructed[sourceOffset], alpha);
    rgb[targetOffset + 1] = blendOnWhite(
      reconstructed[sourceOffset + 1],
      alpha,
    );
    rgb[targetOffset + 2] = blendOnWhite(
      reconstructed[sourceOffset + 2],
      alpha,
    );
  }

  const normalizedRows = Buffer.alloc((parsed.width * 3 + 1) * parsed.height);
  for (let row = 0; row < parsed.height; row += 1) {
    const targetOffset = row * (parsed.width * 3 + 1);
    normalizedRows[targetOffset] = 0;
    rgb.copy(
      normalizedRows,
      targetOffset + 1,
      row * parsed.width * 3,
      (row + 1) * parsed.width * 3,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(parsed.width, 0);
  ihdr.writeUInt32BE(parsed.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bytes = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(normalizedRows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  return {
    bytes,
    rgb,
    width: parsed.width,
    height: parsed.height,
    hash: sha256(bytes),
  };
}

export function renderOpdChartPdf(input: OpdChartPdfInput): Buffer {
  const compressedImage = deflateSync(input.image.rgb, { level: 9 });
  const pageWidth = 842;
  const pageHeight = 595;
  const maxImageWidth = 782;
  const maxImageHeight = 520;
  const imageScale = Math.min(
    maxImageWidth / input.image.width,
    maxImageHeight / input.image.height,
  );
  const imageWidth = Math.round(input.image.width * imageScale * 100) / 100;
  const imageHeight = Math.round(input.image.height * imageScale * 100) / 100;
  const imageX = Math.round(((pageWidth - imageWidth) / 2) * 100) / 100;
  const imageY = 48;
  const footer = escapePdfText(
    `HealthX OPD Chart | ${input.templateCode} | ${input.templateVersion} | finalized ${input.finalizedAt}`,
  );
  const hashFooter = escapePdfText(
    `Content SHA-256 ${input.contentHash} | PNG SHA-256 ${input.image.hash}`,
  );
  const content = Buffer.from(
    [
      `q ${imageWidth} 0 0 ${imageHeight} ${imageX} ${imageY} cm /Im1 Do Q`,
      `BT /F1 7.5 Tf 1 0 0 1 30 29 Tm (${footer}) Tj ET`,
      `BT /F1 6.5 Tf 1 0 0 1 30 16 Tm (${hashFooter}) Tj ET`,
    ].join("\n"),
    "ascii",
  );
  const objects = new Map<number, Buffer>([
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii")],
    [
      2,
      Buffer.from("<< /Type /Pages /Count 1 /Kids [5 0 R] >>", "ascii"),
    ],
    [
      3,
      Buffer.from(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "ascii",
      ),
    ],
    [
      4,
      pdfStream(
        `<< /Type /XObject /Subtype /Image /Width ${input.image.width} /Height ${input.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressedImage.length} >>`,
        compressedImage,
      ),
    ],
    [
      5,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents 6 0 R >>`,
        "ascii",
      ),
    ],
    [6, pdfStream(`<< /Length ${content.length} >>`, content)],
  ]);
  return assemblePdf(objects);
}

export function hashOpdChartArtifact(value: Buffer | string): string {
  return sha256(value);
}

function parsePng(source: Buffer): ParsedPng {
  if (
    source.length < PNG_SIGNATURE.length + 12 ||
    !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("CHART_RENDER_INVALID: finalized Chart must be a PNG");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType: 2 | 6 | null = null;
  let sawIhdr = false;
  let sawIend = false;
  const idat: Buffer[] = [];
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > source.length) {
      throw new Error("CHART_RENDER_INVALID: malformed PNG chunk");
    }
    const typeBuffer = source.subarray(typeStart, dataStart);
    const type = typeBuffer.toString("ascii");
    const data = source.subarray(dataStart, dataEnd);
    const expectedCrc = source.readUInt32BE(dataEnd);
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) {
      throw new Error("CHART_RENDER_INVALID: PNG checksum failed");
    }
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) {
        throw new Error("CHART_RENDER_INVALID: invalid PNG header");
      }
      sawIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const candidateColorType = data[9];
      if (
        bitDepth !== 8 ||
        (candidateColorType !== 2 && candidateColorType !== 6) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new Error(
          "CHART_RENDER_INVALID: PNG must be 8-bit RGB/RGBA and non-interlaced",
        );
      }
      colorType = candidateColorType;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      sawIend = true;
      offset = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4;
  }
  if (
    !sawIhdr ||
    !sawIend ||
    colorType === null ||
    idat.length === 0 ||
    offset !== source.length ||
    width > MAX_CHART_DIMENSION ||
    height > MAX_CHART_DIMENSION
  ) {
    throw new Error(
      "CHART_RENDER_INVALID: PNG dimensions or structure are invalid",
    );
  }
  return { width, height, colorType, compressed: Buffer.concat(idat) };
}

function unfilterPng(
  inflated: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer {
  const rowBytes = width * bytesPerPixel;
  const result = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    if (filter > 4) {
      throw new Error("CHART_RENDER_INVALID: unsupported PNG filter");
    }
    const rowOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[sourceOffset + column];
      const left =
        column >= bytesPerPixel
          ? result[rowOffset + column - bytesPerPixel]
          : 0;
      const up = row > 0 ? result[rowOffset - rowBytes + column] : 0;
      const upLeft =
        row > 0 && column >= bytesPerPixel
          ? result[rowOffset - rowBytes + column - bytesPerPixel]
          : 0;
      const value =
        filter === 0
          ? raw
          : filter === 1
            ? raw + left
            : filter === 2
              ? raw + up
              : filter === 3
                ? raw + Math.floor((left + up) / 2)
                : raw + paeth(left, up, upLeft);
      result[rowOffset + column] = value & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return result;
}

function paeth(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function blendOnWhite(value: number, alpha: number): number {
  return Math.round((value * alpha + 255 * (255 - alpha)) / 255);
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

function escapePdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function pdfStream(dictionary: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`${dictionary}\nstream\n`, "ascii"),
    content,
    Buffer.from("\nendstream", "ascii"),
  ]);
}

function assemblePdf(objects: Map<number, Buffer>): Buffer {
  const maxObjectId = Math.max(...objects.keys());
  const chunks: Buffer[] = [
    Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary"),
  ];
  const offsets = new Array<number>(maxObjectId + 1).fill(0);
  let offset = chunks[0].length;
  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const object = objects.get(objectId);
    if (!object) throw new Error(`Missing PDF object ${objectId}`);
    offsets[objectId] = offset;
    const prefix = Buffer.from(`${objectId} 0 obj\n`, "ascii");
    const suffix = Buffer.from("\nendobj\n", "ascii");
    chunks.push(prefix, object, suffix);
    offset += prefix.length + object.length + suffix.length;
  }
  const xrefOffset = offset;
  chunks.push(
    Buffer.from(
      [
        `xref\n0 ${maxObjectId + 1}`,
        "0000000000 65535 f ",
        ...offsets
          .slice(1)
          .map((entry) => `${String(entry).padStart(10, "0")} 00000 n `),
        `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>`,
        `startxref\n${xrefOffset}`,
        "%%EOF\n",
      ].join("\n"),
      "ascii",
    ),
  );
  return Buffer.concat(chunks);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_SIGNATURE_DIMENSION = 2048;
const MAX_DECODED_SIGNATURE_BYTES =
  MAX_SIGNATURE_DIMENSION * MAX_SIGNATURE_DIMENSION * 4 +
  MAX_SIGNATURE_DIMENSION;

export interface NormalizedSignature {
  bytes: Buffer;
  rgb: Buffer;
  width: number;
  height: number;
  hash: string;
}

export interface CourseVerificationPdfItem {
  courseName: string;
  itemName: string;
  quantity: string;
  reservedBefore: string;
  usedBefore: string;
  reservedAfter: string;
  usedAfter: string;
  remaining: string;
}

export interface CourseVerificationPdfComponent {
  productName: string;
  lotId: string;
  expiryAt: string;
  quantity: string;
}

export interface CourseVerificationPdfOperator {
  displayName: string;
  roleId: string;
  operatorType: string;
}

export interface CourseVerificationPdfInput {
  verificationId: string;
  verifiedAt: string;
  clinicName: string;
  branchName: string;
  customerDisplayName: string;
  legacyServiceUsageId: string;
  acknowledgementVersion: string;
  acknowledgementLocale: string;
  acknowledgementText: string;
  acknowledgementHash: string;
  manifestHash: string;
  verificationActorName: string;
  items: CourseVerificationPdfItem[];
  components: CourseVerificationPdfComponent[];
  operators: CourseVerificationPdfOperator[];
  signature: NormalizedSignature;
}

interface ParsedPng {
  width: number;
  height: number;
  colorType: 2 | 6;
  compressed: Buffer;
}

export function normalizeCourseVerificationSignature(
  source: Buffer,
): NormalizedSignature {
  const parsed = parsePng(source);
  const bytesPerPixel = parsed.colorType === 6 ? 4 : 3;
  const rowBytes = parsed.width * bytesPerPixel;
  const expectedBytes = (rowBytes + 1) * parsed.height;
  const inflated = inflateSync(parsed.compressed, {
    maxOutputLength: Math.min(MAX_DECODED_SIGNATURE_BYTES, expectedBytes + 1),
  });
  if (inflated.length !== expectedBytes) {
    throw new Error("COURSE_SIGNATURE_INVALID: PNG pixel data is incomplete");
  }

  const reconstructed = unfilterPng(
    inflated,
    parsed.width,
    parsed.height,
    bytesPerPixel,
  );
  const rgb = Buffer.alloc(parsed.width * parsed.height * 3);
  let inkPixels = 0;
  for (let pixel = 0; pixel < parsed.width * parsed.height; pixel += 1) {
    const sourceOffset = pixel * bytesPerPixel;
    const targetOffset = pixel * 3;
    const alpha =
      parsed.colorType === 6 ? reconstructed[sourceOffset + 3] : 255;
    const red = blendOnWhite(reconstructed[sourceOffset], alpha);
    const green = blendOnWhite(reconstructed[sourceOffset + 1], alpha);
    const blue = blendOnWhite(reconstructed[sourceOffset + 2], alpha);
    rgb[targetOffset] = red;
    rgb[targetOffset + 1] = green;
    rgb[targetOffset + 2] = blue;
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    if (alpha >= 16 && luminance < 245) inkPixels += 1;
  }

  const minimumInkPixels = Math.max(
    12,
    Math.floor(parsed.width * parsed.height * 0.0002),
  );
  if (inkPixels < minimumInkPixels) {
    throw new Error(
      "COURSE_SIGNATURE_INVALID: signature canvas is blank or nearly blank",
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
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const normalized = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(normalizedRows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  return {
    bytes: normalized,
    rgb,
    width: parsed.width,
    height: parsed.height,
    hash: sha256(normalized),
  };
}

export function renderCourseVerificationPdf(
  input: CourseVerificationPdfInput,
): Buffer {
  const lines = [
    "HealthX OPD Course Use Verification",
    "Template: opd-course-use-verification-v1",
    `Verification ID: ${input.verificationId}`,
    `Verified at: ${input.verifiedAt}`,
    `Clinic: ${input.clinicName}`,
    `Branch: ${input.branchName}`,
    `Customer: ${input.customerDisplayName}`,
    `Service usage: ${input.legacyServiceUsageId}`,
    `Verified by: ${input.verificationActorName}`,
    "",
    "Course balance effects",
    ...input.items.flatMap((item, index) => [
      `${index + 1}. ${item.courseName} / ${item.itemName}`,
      `   quantity ${item.quantity}; reserved ${item.reservedBefore} -> ${item.reservedAfter}; used ${item.usedBefore} -> ${item.usedAfter}; remaining ${item.remaining}`,
    ]),
    "",
    "Actual component lots",
    ...(input.components.length === 0
      ? ["No component stock movement."]
      : input.components.map(
          (component, index) =>
            `${index + 1}. ${component.productName}; lot ${component.lotId}; expiry ${component.expiryAt}; quantity ${component.quantity}`,
        )),
    "",
    "Treatment operators",
    ...(input.operators.length === 0
      ? ["No operator snapshot."]
      : input.operators.map(
          (operator, index) =>
            `${index + 1}. ${operator.displayName}; ${operator.roleId}; ${operator.operatorType}`,
        )),
    "",
    `Acknowledgement: ${input.acknowledgementVersion} (${input.acknowledgementLocale})`,
    input.acknowledgementText,
    `Acknowledgement hash: ${input.acknowledgementHash}`,
    `Manifest hash: ${input.manifestHash}`,
    "",
    "The signature below was freshly captured for this exact course-use manifest.",
  ].flatMap(wrapPdfLine);

  const linesPerPage = 53;
  const pageLines: string[][] = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pageLines.push(lines.slice(index, index + linesPerPage));
  }
  if (pageLines.length === 0) pageLines.push([]);

  const fontObjectId = 3;
  const imageObjectId = 4;
  const firstPageObjectId = 5;
  const pageObjectIds = pageLines.map(
    (_, index) => firstPageObjectId + index * 2,
  );
  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"));
  objects.set(
    2,
    Buffer.from(
      `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] >>`,
      "ascii",
    ),
  );
  objects.set(
    fontObjectId,
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "ascii",
    ),
  );
  const compressedImage = deflateSync(input.signature.rgb, { level: 9 });
  objects.set(
    imageObjectId,
    pdfStream(
      `<< /Type /XObject /Subtype /Image /Width ${input.signature.width} /Height ${input.signature.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressedImage.length} >>`,
      compressedImage,
    ),
  );

  pageLines.forEach((page, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const finalPage = index === pageLines.length - 1;
    const commands: string[] = [];
    page.forEach((line, lineIndex) => {
      const y = 805 - lineIndex * 14;
      commands.push(
        `BT /F1 ${lineIndex === 0 && index === 0 ? 13 : 8.5} Tf 1 0 0 1 40 ${y} Tm (${escapePdfText(line)}) Tj ET`,
      );
    });
    if (finalPage) {
      const imageWidth = Math.min(260, input.signature.width);
      const imageHeight = Math.max(
        40,
        Math.round(
          (imageWidth * input.signature.height) / input.signature.width,
        ),
      );
      commands.push(`q ${imageWidth} 0 0 ${imageHeight} 40 35 cm /Im1 Do Q`);
      commands.push(
        `BT /F1 8 Tf 1 0 0 1 40 22 Tm (Customer signature - SHA-256 ${input.signature.hash}) Tj ET`,
      );
    }
    const content = Buffer.from(commands.join("\n"), "ascii");
    objects.set(
      pageObjectId,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> /XObject << /Im1 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        "ascii",
      ),
    );
    objects.set(
      contentObjectId,
      pdfStream(`<< /Length ${content.length} >>`, content),
    );
  });

  return assemblePdf(objects);
}

function parsePng(source: Buffer): ParsedPng {
  if (
    source.length < PNG_SIGNATURE.length + 12 ||
    !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("COURSE_SIGNATURE_INVALID: signature must be a PNG");
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
    const crcOffset = dataEnd;
    if (dataEnd + 4 > source.length) {
      throw new Error("COURSE_SIGNATURE_INVALID: malformed PNG chunk");
    }
    const typeBuffer = source.subarray(typeStart, dataStart);
    const type = typeBuffer.toString("ascii");
    const data = source.subarray(dataStart, dataEnd);
    const expectedCrc = source.readUInt32BE(crcOffset);
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) {
      throw new Error("COURSE_SIGNATURE_INVALID: PNG checksum failed");
    }
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) {
        throw new Error("COURSE_SIGNATURE_INVALID: invalid PNG header");
      }
      sawIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const candidateColorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (
        bitDepth !== 8 ||
        (candidateColorType !== 2 && candidateColorType !== 6) ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        throw new Error(
          "COURSE_SIGNATURE_INVALID: PNG must be 8-bit RGB/RGBA and non-interlaced",
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
    width < 16 ||
    height < 16 ||
    width > MAX_SIGNATURE_DIMENSION ||
    height > MAX_SIGNATURE_DIMENSION
  ) {
    throw new Error(
      "COURSE_SIGNATURE_INVALID: PNG dimensions or structure are invalid",
    );
  }
  return {
    width,
    height,
    colorType,
    compressed: Buffer.concat(idat),
  };
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
      throw new Error("COURSE_SIGNATURE_INVALID: unsupported PNG filter");
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
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          value = raw;
      }
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

function wrapPdfLine(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const lines: string[] = [];
  let remaining = normalized;
  while (remaining.length > 92) {
    const candidate = remaining.slice(0, 92);
    const split = Math.max(candidate.lastIndexOf(" "), 40);
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  lines.push(remaining);
  return lines;
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
  const xrefRows = [
    `xref\n0 ${maxObjectId + 1}`,
    "0000000000 65535 f ",
    ...offsets
      .slice(1)
      .map((entry) => `${String(entry).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF\n",
  ];
  chunks.push(Buffer.from(xrefRows.join("\n"), "ascii"));
  return Buffer.concat(chunks);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

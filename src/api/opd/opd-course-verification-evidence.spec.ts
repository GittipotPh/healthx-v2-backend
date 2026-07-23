import { deflateSync } from "node:zlib";
import {
  normalizeCourseVerificationSignature,
  renderCourseVerificationPdf,
} from "./opd-course-verification-evidence";

describe("OPD course verification evidence", () => {
  it("normalizes a non-blank RGB PNG deterministically", () => {
    const source = signaturePng(false);

    const first = normalizeCourseVerificationSignature(source);
    const second = normalizeCourseVerificationSignature(source);

    expect(first.width).toBe(32);
    expect(first.height).toBe(32);
    expect(first.bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.hash).toBe(first.hash);
    expect(second.bytes).toEqual(first.bytes);
  });

  it("rejects a blank signature canvas", () => {
    expect(() =>
      normalizeCourseVerificationSignature(signaturePng(true)),
    ).toThrow("blank or nearly blank");
  });

  it("rejects a PNG whose chunk checksum was changed", () => {
    const source = signaturePng(false);
    source[source.length - 5] ^= 0xff;

    expect(() => normalizeCourseVerificationSignature(source)).toThrow(
      "PNG checksum failed",
    );
  });

  it("renders a self-contained signed PDF with immutable hashes", () => {
    const signature = normalizeCourseVerificationSignature(signaturePng(false));
    const pdf = renderCourseVerificationPdf({
      verificationId: "verification-1",
      verifiedAt: "2026-07-23T08:00:00.000Z",
      clinicName: "HealthX Clinic",
      branchName: "Branch A",
      customerDisplayName: "Customer One",
      legacyServiceUsageId: "service-usage-1",
      acknowledgementVersion: "opd-course-use-ack-v1",
      acknowledgementLocale: "en-US",
      acknowledgementText: "I confirm receipt of the listed course services.",
      acknowledgementHash: "a".repeat(64),
      manifestHash: "b".repeat(64),
      verificationActorName: "Operator One",
      items: [
        {
          courseName: "Course A",
          itemName: "Session A",
          quantity: "1",
          reservedBefore: "1",
          usedBefore: "0",
          reservedAfter: "0",
          usedAfter: "1",
          remaining: "2",
        },
      ],
      components: [
        {
          productName: "Product A",
          lotId: "LOT-1",
          expiryAt: "2027-01-01T00:00:00.000Z",
          quantity: "1",
        },
      ],
      operators: [
        {
          displayName: "Operator One",
          roleId: "doctor",
          operatorType: "OPERATOR",
        },
      ],
      signature,
    });
    const text = pdf.toString("latin1");

    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toContain("HealthX OPD Course Use Verification");
    expect(text).toContain(`Customer signature - SHA-256 ${signature.hash}`);
    expect(text).toContain("%%EOF");
  });
});

function signaturePng(blank: boolean): Buffer {
  const width = 32;
  const height = 32;
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    rows[row * (width * 3 + 1)] = 0;
    if (!blank) {
      for (let offset = -1; offset <= 1; offset += 1) {
        const column = Math.max(0, Math.min(width - 1, row + offset));
        const pixel = row * (width * 3 + 1) + 1 + column * 3;
        rows[pixel] = 20;
        rows[pixel + 1] = 20;
        rows[pixel + 2] = 20;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
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

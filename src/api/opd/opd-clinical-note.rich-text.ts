import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export const CLINICAL_RICH_TEXT_SCHEMA = "clinical-rich-text-v1" as const;
export const CLINICAL_RICH_TEXT_MAX_PLAIN_TEXT = 50_000;
export const CLINICAL_RICH_TEXT_MAX_JSON_BYTES = 128 * 1024;

const MAX_NODE_COUNT = 5_000;
const MAX_DEPTH = 12;
const MARK_ORDER = ["bold", "italic", "underline", "highlight"] as const;
type AllowedMark = (typeof MARK_ORDER)[number];
const INLINE_TYPES = new Set(["text", "hardBreak"]);
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
]);

type Placement = "root" | "block" | "inline" | "list" | "listItem";

interface NormalizedNode {
  json: Prisma.InputJsonObject;
  plainText: string;
}

export interface NormalizedClinicalRichText {
  content: Prisma.InputJsonObject;
  plainText: string;
}

export function emptyClinicalRichTextContent(): Prisma.InputJsonObject {
  return {
    schema: CLINICAL_RICH_TEXT_SCHEMA,
    doc: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  };
}

export function normalizeClinicalRichText(
  value: unknown,
): NormalizedClinicalRichText {
  const wrapper = requireRecord(value, "content");
  assertExactKeys(wrapper, ["schema", "doc"], "content");
  if (wrapper.schema !== CLINICAL_RICH_TEXT_SCHEMA) {
    invalid(`content.schema must be ${CLINICAL_RICH_TEXT_SCHEMA}`);
  }

  const state = { nodeCount: 0 };
  const doc = normalizeNode(wrapper.doc, "root", 0, state);
  const content: Prisma.InputJsonObject = {
    schema: CLINICAL_RICH_TEXT_SCHEMA,
    doc: doc.json,
  };
  const plainText = doc.plainText.replace(/[\t ]+\n/gu, "\n").trimEnd();
  if (plainText.length > CLINICAL_RICH_TEXT_MAX_PLAIN_TEXT) {
    invalid(
      `Clinical note plain text exceeds ${CLINICAL_RICH_TEXT_MAX_PLAIN_TEXT} characters`,
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(content), "utf8");
  if (bytes > CLINICAL_RICH_TEXT_MAX_JSON_BYTES) {
    invalid(
      `Clinical note JSON exceeds ${CLINICAL_RICH_TEXT_MAX_JSON_BYTES} bytes`,
    );
  }
  return { content, plainText };
}

function normalizeNode(
  value: unknown,
  placement: Placement,
  depth: number,
  state: { nodeCount: number },
): NormalizedNode {
  if (depth > MAX_DEPTH) invalid(`Clinical note nesting exceeds ${MAX_DEPTH}`);
  state.nodeCount += 1;
  if (state.nodeCount > MAX_NODE_COUNT) {
    invalid(`Clinical note contains more than ${MAX_NODE_COUNT} nodes`);
  }

  const node = requireRecord(value, "node");
  const type = requireString(node.type, "node.type");
  assertPlacement(type, placement);

  switch (type) {
    case "doc": {
      assertExactKeys(node, ["type", "content"], "doc");
      const children = requireArray(node.content, "doc.content", true);
      const normalized = children.map((child) =>
        normalizeNode(child, "block", depth + 1, state),
      );
      return {
        json: { type, content: normalized.map((child) => child.json) },
        plainText: joinBlocks(normalized),
      };
    }
    case "paragraph": {
      assertExactKeys(node, ["type", "content"], "paragraph");
      const normalized = normalizeOptionalChildren(
        node.content,
        "inline",
        depth,
        state,
        "paragraph.content",
      );
      return blockWithOptionalContent(type, normalized);
    }
    case "heading": {
      assertExactKeys(node, ["type", "attrs", "content"], "heading");
      const attrs = requireRecord(node.attrs, "heading.attrs");
      assertExactKeys(attrs, ["level"], "heading.attrs");
      if (attrs.level !== 2 && attrs.level !== 3) {
        invalid("heading.attrs.level must be 2 or 3");
      }
      const normalized = normalizeOptionalChildren(
        node.content,
        "inline",
        depth,
        state,
        "heading.content",
      );
      const json: Prisma.InputJsonObject = {
        type,
        attrs: { level: attrs.level },
        ...(normalized.length > 0
          ? { content: normalized.map((child) => child.json) }
          : {}),
      };
      return {
        json,
        plainText: normalized.map((child) => child.plainText).join(""),
      };
    }
    case "blockquote": {
      assertExactKeys(node, ["type", "content"], "blockquote");
      const children = requireArray(node.content, "blockquote.content", true);
      const normalized = children.map((child) =>
        normalizeNode(child, "block", depth + 1, state),
      );
      return {
        json: { type, content: normalized.map((child) => child.json) },
        plainText: joinBlocks(normalized),
      };
    }
    case "bulletList":
    case "orderedList": {
      assertExactKeys(node, ["type", "attrs", "content"], type);
      const children = requireArray(node.content, `${type}.content`, true);
      const normalized = children.map((child) =>
        normalizeNode(child, "list", depth + 1, state),
      );
      let start = 1;
      let attrsJson: Prisma.InputJsonObject | undefined;
      if (type === "orderedList" && node.attrs !== undefined) {
        const attrs = requireRecord(node.attrs, "orderedList.attrs");
        assertExactKeys(attrs, ["start", "type"], "orderedList.attrs");
        if (!Number.isInteger(attrs.start) || Number(attrs.start) < 1) {
          invalid("orderedList.attrs.start must be a positive integer");
        }
        if (attrs.type !== undefined && attrs.type !== null) {
          invalid("orderedList.attrs.type must be null when supplied");
        }
        start = Number(attrs.start);
        attrsJson = { start };
      } else if (node.attrs !== undefined) {
        invalid("bulletList does not accept attrs");
      }
      const json: Prisma.InputJsonObject = {
        type,
        content: normalized.map((child) => child.json),
        ...(attrsJson ? { attrs: attrsJson } : {}),
      };
      return {
        json,
        plainText: normalized
          .map(
            (child, index) =>
              `${type === "bulletList" ? "•" : `${start + index}.`} ${child.plainText}`,
          )
          .join("\n"),
      };
    }
    case "listItem": {
      assertExactKeys(node, ["type", "content"], "listItem");
      const children = requireArray(node.content, "listItem.content", true);
      const normalized = children.map((child) =>
        normalizeNode(child, "listItem", depth + 1, state),
      );
      if (normalized[0]?.json.type !== "paragraph") {
        invalid("listItem.content must start with a paragraph");
      }
      return {
        json: { type, content: normalized.map((child) => child.json) },
        plainText: joinBlocks(normalized),
      };
    }
    case "text": {
      assertExactKeys(node, ["type", "text", "marks"], "text");
      const text = requireString(node.text, "text.text");
      if (text.length === 0) invalid("text.text cannot be empty");
      if (/\r|\n/u.test(text)) {
        invalid(
          "text.text cannot contain line breaks; use hardBreak or blocks",
        );
      }
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
        invalid("text.text contains unsupported control characters");
      }
      const marks = normalizeMarks(node.marks);
      const json: Prisma.InputJsonObject = {
        type,
        text,
        ...(marks.length > 0 ? { marks } : {}),
      };
      return { json, plainText: text };
    }
    case "hardBreak":
      assertExactKeys(node, ["type"], "hardBreak");
      return { json: { type }, plainText: "\n" };
    default:
      invalid(`Unsupported clinical-rich-text-v1 node: ${type}`);
  }
}

function normalizeOptionalChildren(
  value: unknown,
  placement: Placement,
  depth: number,
  state: { nodeCount: number },
  label: string,
): NormalizedNode[] {
  if (value === undefined) return [];
  return requireArray(value, label, false).map((child) =>
    normalizeNode(child, placement, depth + 1, state),
  );
}

function blockWithOptionalContent(
  type: string,
  normalized: NormalizedNode[],
): NormalizedNode {
  const json: Prisma.InputJsonObject = {
    type,
    ...(normalized.length > 0
      ? { content: normalized.map((child) => child.json) }
      : {}),
  };
  return {
    json,
    plainText: normalized.map((child) => child.plainText).join(""),
  };
}

function normalizeMarks(value: unknown): Prisma.InputJsonObject[] {
  if (value === undefined) return [];
  const marks = requireArray(value, "text.marks", false);
  const seen = new Set<string>();
  const normalized = marks.map((markValue) => {
    const mark = requireRecord(markValue, "text.mark");
    assertExactKeys(mark, ["type"], "text.mark");
    const type = requireString(mark.type, "text.mark.type");
    if (!isAllowedMark(type)) {
      invalid(`Unsupported clinical-rich-text-v1 mark: ${type}`);
    }
    if (seen.has(type))
      invalid(`Duplicate clinical-rich-text-v1 mark: ${type}`);
    seen.add(type);
    return { type } satisfies Prisma.InputJsonObject;
  });
  return normalized.sort(
    (left, right) =>
      MARK_ORDER.indexOf(left.type) - MARK_ORDER.indexOf(right.type),
  );
}

function isAllowedMark(value: string): value is AllowedMark {
  return MARK_ORDER.some((mark) => mark === value);
}

function assertPlacement(type: string, placement: Placement): void {
  const valid =
    (placement === "root" && type === "doc") ||
    (placement === "block" && BLOCK_TYPES.has(type)) ||
    (placement === "inline" && INLINE_TYPES.has(type)) ||
    (placement === "list" && type === "listItem") ||
    (placement === "listItem" && BLOCK_TYPES.has(type));
  if (!valid) invalid(`Node ${type} is not valid in ${placement} content`);
}

function joinBlocks(nodes: NormalizedNode[]): string {
  return nodes.map((node) => node.plainText).join("\n");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalid(`${label} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function requireArray(
  value: unknown,
  label: string,
  nonEmpty: boolean,
): unknown[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    invalid(`${label} must be ${nonEmpty ? "a non-empty" : "an"} array`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string`);
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) invalid(`${label}.${unexpected} is not supported`);
}

function invalid(message: string): never {
  throw new BadRequestException(message);
}

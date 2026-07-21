import { BadRequestException } from "@nestjs/common";
import {
  CLINICAL_RICH_TEXT_MAX_PLAIN_TEXT,
  normalizeClinicalRichText,
} from "./opd-clinical-note.rich-text";

describe("clinical-rich-text-v1", () => {
  it("canonicalizes allowed nodes and derives the plain-text projection", () => {
    const result = normalizeClinicalRichText({
      schema: "clinical-rich-text-v1",
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [
              {
                type: "text",
                text: "Assessment",
                marks: [{ type: "highlight" }, { type: "bold" }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Hydration" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(result.plainText).toBe("Assessment\n• Hydration");
    expect(result.content).toEqual({
      schema: "clinical-rich-text-v1",
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [
              {
                type: "text",
                text: "Assessment",
                marks: [{ type: "bold" }, { type: "highlight" }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Hydration" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("rejects unsupported nodes, marks, and raw attributes", () => {
    expect(() =>
      normalizeClinicalRichText({
        schema: "clinical-rich-text-v1",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "unsafe",
                  marks: [
                    { type: "link", attrs: { href: "https://example.com" } },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      normalizeClinicalRichText({
        schema: "clinical-rich-text-v1",
        doc: {
          type: "doc",
          content: [{ type: "rawHtml", html: "<script>alert(1)</script>" }],
        },
      }),
    ).toThrow(BadRequestException);
  });

  it("accepts ProseMirror paragraph block content after the first list paragraph", () => {
    const result = normalizeClinicalRichText({
      schema: "clinical-rich-text-v1",
      doc: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 2, type: null },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Review" }],
                  },
                  {
                    type: "blockquote",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Return if worse" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(result.plainText).toBe("2. Review\nReturn if worse");
  });

  it("enforces the clinical plain-text limit", () => {
    expect(() =>
      normalizeClinicalRichText({
        schema: "clinical-rich-text-v1",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "x".repeat(CLINICAL_RICH_TEXT_MAX_PLAIN_TEXT + 1),
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(BadRequestException);
  });
});

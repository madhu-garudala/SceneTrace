import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/traces/extract-image/route";
import { normalizeRawExtractionPayload } from "@/lib/video/extract";
import {
  ExtractImageRequestSchema,
  MAX_IMAGE_BASE64_CHARS,
} from "@/lib/video/image-input";

const TINY_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQg=";

const validBody = {
  imageBase64: TINY_JPEG_BASE64,
  mimeType: "image/jpeg",
  question: "Which headphones are these?",
};

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/traces/extract-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Camera still extraction request validation", () => {
  it("accepts a well-formed JPEG capture and defaults bypassCache to false", () => {
    const parsed = ExtractImageRequestSchema.safeParse(validBody);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.bypassCache).toBe(false);
  });

  it("rejects non-image mime types", () => {
    for (const mimeType of ["video/mp4", "application/pdf", "image/gif", ""]) {
      const parsed = ExtractImageRequestSchema.safeParse({
        ...validBody,
        mimeType,
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/JPEG, PNG, or WebP/);
    }
  });

  it("rejects oversized payloads", () => {
    const parsed = ExtractImageRequestSchema.safeParse({
      ...validBody,
      imageBase64: "A".repeat(MAX_IMAGE_BASE64_CHARS + 4),
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/too large/);
  });

  it("rejects missing or too-short questions and non-base64 data", () => {
    const { question: _omit, ...noQuestion } = validBody;
    void _omit;
    expect(ExtractImageRequestSchema.safeParse(noQuestion).success).toBe(false);
    expect(
      ExtractImageRequestSchema.safeParse({ ...validBody, question: "  a " })
        .success,
    ).toBe(false);
    expect(
      ExtractImageRequestSchema.safeParse({
        ...validBody,
        imageBase64: `data:image/jpeg;base64,${TINY_JPEG_BASE64}`,
      }).success,
    ).toBe(false);
  });

  it("returns HTTP 400 from the route for bad mime, oversized, and missing question", async () => {
    const badMime = await POST(postJson({ ...validBody, mimeType: "video/mp4" }));
    expect(badMime.status).toBe(400);

    const oversized = await POST(
      postJson({
        ...validBody,
        imageBase64: "A".repeat(MAX_IMAGE_BASE64_CHARS + 4),
      }),
    );
    expect(oversized.status).toBe(400);

    const noQuestion = await POST(
      postJson({ imageBase64: TINY_JPEG_BASE64, mimeType: "image/jpeg" }),
    );
    expect(noQuestion.status).toBe(400);
    const body = (await noQuestion.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
  });

  it("pins still-image timestamps to 0 and keeps one sighting per item", () => {
    const normalized = normalizeRawExtractionPayload(
      {
        videoSummary: "Black over-ear headphones on a desk.",
        shopperConstraints: {
          maxPriceMajor: 0,
          currency: "",
          requestedSize: "",
          requestedColor: "",
        },
        items: [
          {
            category: "headphones",
            label: "Black Over-Ear Headphones",
            summary: "Matte black over-ear headphones.",
            brand: "",
            modelReference: "",
            bestEvidenceSec: 3,
            bestBox2d: [120, 200, 880, 800],
            sightings: [
              { startSec: 2, endSec: 4, evidenceSec: 3, observation: "Photo" },
              { startSec: 7, endSec: 9, evidenceSec: 8, observation: "Dup" },
            ],
            features: [
              { name: "primary_color", value: "black", atSec: 5, source: "visible" },
            ],
            searchQueries: ["black over-ear headphones"],
          },
        ],
      },
      { stillImage: true },
    );

    const [item] = normalized.items;
    expect(item.bestEvidenceSec).toBe(0);
    expect(item.sightings).toEqual([
      { startSec: 0, endSec: 0, evidenceSec: 0, observation: "Photo" },
    ]);
    expect(item.features[0].atSec).toBe(0);
    expect(item.bestBox2d).toEqual([120, 200, 880, 800]);
  });
});

import { z } from "zod";

// ~6 MB of decoded image; base64 is ~4/3 larger.
export const MAX_REPAIR_IMAGE_BASE64_CHARS = 8_000_000;

const TracedItemSchema = z.object({
  itemId: z.string().min(1).max(200),
  category: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  summary: z.string().max(1000).default(""),
  sightings: z.array(z.any()).default([]),
  bestEvidenceSec: z.number().default(0),
  bestBox2d: z.array(z.number()).nullable().optional(),
  features: z
    .array(
      z.object({
        name: z.string().max(200),
        value: z.string().max(500),
        atSec: z.number().default(0),
        source: z.enum(["visible", "spoken", "inferred"]),
      }),
    )
    .max(30)
    .default([]),
  brand: z.string().max(200).nullable().default(null),
  modelReference: z.string().max(300).nullable().default(null),
  searchQueries: z.array(z.string().max(300)).max(8).default([]),
  constraints: z.any().optional(),
});

export const RepairRequestSchema = z.object({
  imageBase64: z
    .string()
    .min(100, "imageBase64 is missing or too small.")
    .max(MAX_REPAIR_IMAGE_BASE64_CHARS, "Image is too large."),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  item: TracedItemSchema,
  note: z.string().trim().max(500).optional(),
  bypassCache: z.boolean().optional().default(false),
});

export type RepairRequest = z.infer<typeof RepairRequestSchema>;

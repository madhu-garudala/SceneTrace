import { z } from "zod";

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// ~3 MB of binary image data; keeps the JSON body under Vercel's 4.5 MB request limit.
export const MAX_IMAGE_BASE64_CHARS = 4_000_000;

export const ExtractImageRequestSchema = z.object({
  imageBase64: z
    .string()
    .min(1, "Capture a photo before tracing.")
    .max(
      MAX_IMAGE_BASE64_CHARS,
      "Captured image is too large (limit ~3 MB). Retake at a lower resolution.",
    )
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Image must be raw base64 data."),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES, {
    message: "Only JPEG, PNG, or WebP images are supported.",
  }),
  question: z
    .string()
    .trim()
    .min(3, "Please enter a question about the products in the photo.")
    .max(500),
  videoModel: z.string().max(80).optional(),
  bypassCache: z.boolean().optional().default(false),
});

export type ExtractImageRequest = z.infer<typeof ExtractImageRequestSchema>;

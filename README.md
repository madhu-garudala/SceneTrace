# SceneTrace

SceneTrace uses **Gemini 4** (`gemini-4-neon` / `gemini-4-carbon`) to identify products across YouTube video scenes, a persistent **Gemini Managed Agent** (`scenetrace-investigator-v1` on `/v1beta/agents` running in a remote Linux sandbox) for autonomous SKU/MSRP forensics and stateful shopper refinements, **Shop MCP** (`https://mcp.shop.com/`) to retrieve live Shopify listings, the **Gemini Decisions API** (`gemini-decision-1`) to rank variants by calibrated match probability, and **Shopify-hosted checkout** to complete the purchase.

## Architecture

- **`POST /api/traces/extract`** (`src/lib/video/`): Normalizes public YouTube links (`watch`, `youtu.be`, `shorts`), runs Gemini 4 via `POST /v1beta/interactions` with structured JSON validation, and returns cross-scene sightings, `bestEvidenceSec`, and provenance-tagged traits (`visible | spoken | inferred`).
- **Browser `<canvas>` Frame Evidence** (`src/lib/video/frames-client.ts`): When an optional companion `.mp4`/still is attached, extracts crisp JPEG frames locally at Gemini's exact timestamps — requiring zero server `ffmpeg` binaries and staying lightweight for Vercel Serverless.
- **`POST /api/traces/agent`** (`src/lib/agent/managed-agent.ts`): Registers and invokes our saved **Gemini Managed Agent** (`scenetrace-investigator-v1`, extending `antigravity-preview-latest` with `environment: "remote"`), autonomously running multi-step `google_search` + Python `code_execution` inside a hosted Linux container to resolve SKUs, retail MSRP ranges, and refined Shopify search strings — plus stateful multi-turn refinements via `previous_interaction_id`.
- **`POST /api/traces/match`** (`src/lib/shop/` & `src/lib/matching/`): Queries Shop MCP (`2026-07-28`, text + `catalog.like` visual search + `get_product` verification), scores candidate variants via `POST /v1beta/decisions` (`gemini-decision-1` `noul` probabilities + hard-conflict gates), and signs tamper-proof `offerToken`s with HMAC-SHA256.
- **`POST /api/checkout` & `/api/checkout/status`** (`src/lib/security/tokens.ts`): Re-verifies live stock, options, and price via `get_product`, creates a real hosted Shopify checkout (`create_checkout`), and encrypts `checkoutRef` with AES-256-GCM so status polling (`get_checkout`) works statelessly across Vercel serverless instances.

## Local Quickstart

1. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies and start the dev server:
   ```bash
   pnpm install
   pnpm dev
   ```
3. Open [http://localhost:3000](http://localhost:3000).

## Verification & Eval Commands

```bash
pnpm typecheck        # Strict TypeScript check
pnpm test             # Unit & regression tests (URL normalization, HMAC/AES tokens, Decisions gates)
pnpm build            # Production Next.js / Vercel build check
pnpm smoke:shop       # Live Shop MCP search -> get_product -> create_checkout -> get_checkout
pnpm smoke:decisions  # Live Gemini Decisions API (/v1beta/decisions) rerank check
pnpm smoke:gemini     # Live Gemini 4 Interactions YouTube extraction check
pnpm eval             # Single-frame vs. cross-scene & Shop order vs. Decisions rerank evaluation
```

## Deploying to Vercel

SceneTrace is built statelessly for Vercel Serverless (`nodejs` runtime + `maxDuration` + signed/encrypted tokens):
1. Import the repository into Vercel (or run `vercel`).
2. Add `GEMINI_API_KEY` (and optional `APP_SECRET`, `GEMINI_VIDEO_MODEL`) in Vercel Environment Variables.
3. Deploy — `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` automatically configures YouTube IFrame player origin.

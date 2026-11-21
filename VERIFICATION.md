# SceneTrace — Live Verification & Proof Record

Recorded on **2026-11-21** against live providers (`generativelanguage.googleapis.com/v1beta` and `https://mcp.shop.com/`). All API keys and raw checkout secret query parameters have been redacted.

---

## 1. Static Checks, Unit/Regression Suite & Production Build

Commands run:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Observed results:
- **`pnpm lint`** (`eslint src scripts evals`): **0 errors, 0 warnings**
- **`pnpm typecheck`** (`tsc --noEmit`): **0 errors**
- **`pnpm test`** (`vitest run`): **16/16 passed** (`src/lib/__tests__/core.test.ts` — covers YouTube URL normalization, playlist/host rejection, timestamp offset/clamping, per-item `safeParse` isolation, HMAC `offerToken` tamper rejection, AES-256-GCM `checkoutRef` auth-tag tamper rejection, SSE frame parsing, `orderPlaced` requiring `status: "completed"` + `order`, option disappearance & empty-to-populated freshness handling, photo+text interleaving & CAD budget/size filter preservation, ISO-4217 0/2/3-decimal currency formatting, `noul` vs `confidence` ranking, seller-domain brand matching, `Sony WH-1000XM5` vs `WH-1000XM4` SKU conflict, variant-option `Color: Navy` precedence over `"Grey"` title, unbranded listing capping at `possible`, and uncorroborated `exact_supported` refusal).
- **`pnpm build`** (`next build`, Next.js `15.5.29`): **Compiled & generated 9/9 routes cleanly**.

---

## 2. Empirical Wire-Protocol Verification

### A. Shop MCP (`https://mcp.shop.com/`) Stateless `2026-07-28` Envelope
- Omitting `Mcp-Method` / `Mcp-Name` headers or `params._meta["io.modelcontextprotocol/protocolVersion"]` returns HTTP `400`:
  ```json
  {"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"missing required Mcp-Method header"}}
  {"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"missing required Mcp-Name header for `tools/call`"}}
  {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid params: request _meta is missing or has malformed required fields: io.modelcontextprotocol/protocolVersion, io.modelcontextprotocol/clientCapabilities"}}
  ```
- Sending `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call`, `Mcp-Name: <tool>`, and `_meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} }` returns **HTTP `200 OK`**.

### B. Shop MCP `catalog.like` Array Requirement
- Sending `catalog.like` as a single object returns JSON-RPC `-32602`:
  ```json
  {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"$.catalog.like: expected type \"array\""}}
  ```
- Sending `catalog.like: [{ image: { content_type, data } }]` passes schema validation cleanly (`src/lib/shop/client.ts`).

### C. Gemini Decisions API (`POST /v1beta/decisions`) Native Shopify CDN Image URI Support
- Sending `{ "type": "image", "uri": "https://cdn.shopify.com/...", "resolution": "medium" }` directly inside `input[]` succeeded with **HTTP `200 OK`** and tokenized the remote product photo (`1,089` image tokens, `0` output tokens):
  ```json
  {
    "answers": {
      "c0": {
        "confidence": 0.8848518570657969,
        "noul": 0.8848518570657969,
        "type": "noul"
      }
    },
    "usage": {
      "total_tokens": 1206,
      "total_input_tokens": 1206,
      "input_tokens_by_modality": [
        {"modality": "text", "tokens": 117},
        {"modality": "image", "tokens": 1089}
      ],
      "total_output_tokens": 0
    }
  }
  ```

---

## 3. Live Provider Smoke Tests (`2026-11-21T18:17Z`)

### `pnpm smoke:shop` (Search → `get_product` → `create_checkout` → `get_checkout` + Fixture Saved)
Saved anonymized fixture to `evals/fixtures/shop-sample.json`.
```text
[smoke:shop] 1. Searching Shop MCP for "ceramic coffee mug"...
[smoke:shop] Retrieved 6 verified Shopify variants in 748ms.
[smoke:shop] 2. Re-reading chosen variant with get_product: {
  title: 'Monsoon Cup 16oz',
  sellerName: 'Nova Ceramics',
  sellerDomain: 'nova-ceramics.myshopify.com',
  amountMinor: 3499,
  currency: 'USD'
}
[smoke:shop] 3. Creating hosted Shopify checkout...
[smoke:shop] Checkout created successfully: {
  status: 'requires_escalation',
  orderPlaced: false,
  currency: 'USD',
  subtotalMinor: 3499,
  hasHttpsContinueUrl: true
}
[smoke:shop] 4. get_checkout status verified: { status: 'requires_escalation', orderPlaced: false }
```

### `pnpm smoke:decisions` (`gemini-decision-1` Calibrated `noul` vs `confidence`)
Note how candidate #1 from search (`Adidas Gazelle`, wrong model/color) received **`confidence: 0.9765`** with **`exactMatchYes (noul): 0.0235`** — proving `gemini-decision-1` independently scored it as a confident "No" while promoting `Adidas Originals Samba OG` (`noul: 0.9718`) from `#2` to `#1`:
```text
[smoke:decisions] Result: {
  decisionsLive: true,
  model: 'gemini-decision-1',
  evidenceMode: 'text_observations',
  durationMs: 574,
  comparison: [
    {
      offerId: 'cand_exact_samba',
      title: 'Adidas Originals Samba OG Cloud White / Core Black / Gum',
      originalRank: 2,
      finalRank: 1,
      exactMatchYes: 0.9717586063543273,
      confidence: 0.9717586063543273,
      matchLabel: 'exact_supported',
      hardConflict: null
    },
    {
      offerId: 'cand_wrong_color',
      title: 'Adidas Gazelle Indoor Collegiate Green Sneakers',
      originalRank: 1,
      finalRank: 2,
      exactMatchYes: 0.023458096441804882,
      confidence: 0.9765419035581951,
      matchLabel: 'similar',
      hardConflict: 'Listing does not match observed model reference "Samba OG".'
    }
  ]
}
```

### `pnpm smoke:agent` (Saved Managed Agent `scenetrace-investigator-v1` in Hosted Linux Sandbox)
```text
[smoke:agent] Report: {
  "agentId": "scenetrace-investigator-v1",
  "baseAgent": "antigravity-preview-latest",
  "environmentId": "85cdebb042216265497045b8bb314377",
  "durationMs": 21443,
  "resolvedBrand": "Casio",
  "resolvedReference": "F91W-1",
  "msrpEstimate": "$29.95 USD (street ~$20-$30)",
  "steps": [
    {
      "stepIndex": 1,
      "kind": "google_search",
      "summary": "Web search (2 queries)"
    },
    {
      "stepIndex": 2,
      "kind": "code_execution",
      "summary": "Remote sandbox (bash)"
    }
  ]
}
```

### `pnpm smoke:gemini` on `gemini-4-carbon` (YouTube `video/mp4` URI + Bounding Box)
Verified both `gemini-4-neon` (in `pnpm eval` below) and `gemini-4-carbon`:
```text
[smoke:gemini] Extracting items from https://www.youtube.com/watch?v=8nJbKQYEH2M (model=gemini-4-carbon) ...
[smoke:gemini] Diagnostics: {
  videoModel: 'gemini-4-carbon',
  geminiLive: true,
  durationMs: 15764,
  totalTokens: 9052,
  droppedItemCount: 0
}
Extracted item: "Casio F-91W Black Resin Digital Watch" (8 sightings, bestEvidenceSec: 10, bestBox2d: [0, 72, 875, 925])
```

---

## 4. End-to-End Evaluation Suite (`pnpm eval` → `evals/results/latest.json`)

### Part 1 — Controlled Single-Frame vs. Cross-Scene & Non-Match Abstention
- **Baseline Top-1**: `0 / 2`
- **Single-Frame Decisions Top-1**: `2 / 2` (held back from `exact_supported` at `noul = 0.177` & `0.165` due to ambiguous distant view)
- **Cross-Scene Decisions Top-1**: `2 / 2` (upgraded to `exact_supported` at `noul = 0.975` & `0.964` once close-up corroborates)
- **Non-Match Abstention (`Patagonia Yellow` vs Black Patagonia / Yellow Columbia)**: `noul = 0.038` (`similar`, **0 false `exact_supported`**)

### Part 2 — Live Pipeline Across 3 Real Public YouTube Clips (`evals/manifest.json`)
| Clip ID | Canonical YouTube URL | Extracted Item (`gemini-4-neon`) | Shop MCP #1 Match | Decisions Rerank #1 (`catalog_images_and_text`) | `noul` Score | Stage Timings |
|---|---|---|---|---|---|---|
| `clip_casio_f91w_short` | `https://www.youtube.com/watch?v=8nJbKQYEH2M` | Casio F-91W Black Resin Digital Watch (8 sightings) | **No** (rank #4 was exact) | **Yes** — promoted Shop **#4 → #1** (`Casio Vintage F-91W-1YEG`) | `0.921` | Extract `26.3s` · Shop `0.58s` · Decisions `6.97s` |
| `clip_aeropress_short` | `https://www.youtube.com/watch?v=b_jiA2jZjXw` | AeroPress Original Coffee Maker (4 sightings) | Yes | **Yes** — `AeroPress Coffee Maker - Original` | `0.908` | Extract `37.1s` · Shop `0.77s` · Decisions `7.31s` |
| `clip_adidas_samba_review` | `https://www.youtube.com/watch?v=t-oFOuz-vFY` | Adidas Samba White/Black/Gum Sneakers (3 sightings) | Yes | **Yes** — promoted Shop **#3 → #1** (`adidas Samba OG | B75806`) | `0.938` | Extract `24.3s` · Shop `0.71s` · Decisions `6.98s` |

- **Retrieval Hit Rate**: `3 / 3` (`100%`)
- **Raw Shop MCP Top-1 Accuracy**: `2 / 3` (`66.7%`)
- **Decisions API Rerank Top-1 Accuracy**: **`3 / 3` (`100%`)**

---

## 5. Full Localhost Production Server End-to-End Run (`2026-11-21T18:22Z`)

Booted `PORT=3456 pnpm start` and executed the complete shopper HTTP flow through live Shopify checkout handoff and encrypted status polling:

```text
1. GET / status: 200 has SCENETRACE: True
2. POST /api/traces/extract: 200 traceId: trace_33abd389-d400-4734-b213-83309277c941 items: 1 first: Casio F-91W Digital Wristwatch
3. POST /api/traces/match: 200 offers: 6 mode: catalog_images_and_text top1: Montre Casio Mixte F-91W-1 Quartz Digitale Noir Bleu noul: 0.9392034951785259 label: exact_supported
4. POST /api/checkout: 200 seller: PSB WATCHES status: incomplete orderPlaced: False continueHost: shop.app isHttps: True
5. Hosted continue_url HTTP status: 200 finalHost: shop.app
6. GET /api/checkout/:checkoutRef: 200 status: incomplete orderPlaced: False
```

*Checkout verification level*: **Verified live Shopify hosted checkout handoff (`200 OK` on `https://shop.app/...`) + stateless `GET /api/checkout/:checkoutRef` status polling** (ready for human shopper payment completion on a low-cost item during live demo rehearsal).

# Future Nice-to-Have Features

Roadmap items intentionally deferred past the initial hackathon build so we prioritize a rock-solid end-to-end demo first:

## 1. Deploy Everything on Google Cloud Platform (GCP) Instead of Vercel
- **Goal**: Host the Next.js application and worker endpoints on **Google Cloud Run** (with **Cloud Build**, **Artifact Registry**, and **Secret Manager**) instead of Vercel so the entire stack lives natively inside the **GCP ecosystem** alongside Gemini 4, Gemini Managed Agents, and the Gemini Decisions API (barring Shopify / Shop MCP for merchant commerce and checkout).
- **Benefits**:
  - Eliminates Vercel's 4.5 MB serverless request payload ceiling, allowing direct high-bitrate clip or multi-frame uploads when needed.
  - Supports longer streaming HTTP timeouts (up to 60 minutes on Cloud Run) for deep multi-minute video forensics and extended Managed Agent sandbox sessions.
  - Consolidates IAM, Secret Manager credentials, Cloud Logging, and Vertex/AI Studio billing under a single GCP project.

## 2. Voice Interactivity (Hands-Free Conversational Shopping)
- **Goal**: Let shoppers talk naturally to SceneTrace while watching a clip — e.g., *"What jacket is he wearing right now, and can you find it in medium under $120?"* — and hear concise spoken answers while offers update live on screen.
- **Approach**:
  - Pair **Gemini Live / multimodal audio input** (capturing the current playback timestamp `player.getCurrentTime()` automatically when the user speaks) with **`gemini-3.8-flash-tts`** for low-latency spoken responses.
  - Route spoken refinements ("show me cheaper options" or "switch to size 10") directly into the stateful **Gemini Managed Agent** (`previous_interaction_id`) and live **Shop MCP** variant selector.

## 3. Additional Post-Hackathon Enhancements
- **Optional Demo Access Guard / Rate Limiting**: Per-IP token bucket and optional passcode header when sharing public preview links broadly.
- **Multi-Merchant Cart Tracking**: Track multiple checkouts side-by-side when buying an entire outfit spanning several Shopify merchants.

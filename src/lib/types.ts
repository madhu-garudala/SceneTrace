export type EvidenceSource = "visible" | "spoken" | "inferred";

export type ObservedFeature = {
  name: string;
  value: string;
  atSec: number;
  source: EvidenceSource;
};

export type Sighting = {
  startSec: number;
  endSec: number;
  evidenceSec: number;
  observation: string;
};

export type BoundingBox2D = [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0..1000

export type ShopperConstraints = {
  maxPriceMajor: number | null;
  currency: string | null;
  requestedSize: string | null;
  requestedColor: string | null;
};

export type TracedItem = {
  itemId: string;
  category: string;
  label: string;
  summary: string;
  sightings: Sighting[];
  bestEvidenceSec: number;
  bestBox2d?: BoundingBox2D | null;
  features: ObservedFeature[];
  brand: string | null;
  modelReference: string | null;
  searchQueries: string[];
  constraints?: ShopperConstraints;
};

export type EvidenceFrame = {
  kind: "video_frame" | "video_crop" | "uploaded_still";
  atSec: number | null;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
  dataUrl: string;
  width: number;
  height: number;
  label: string;
};

export type ManagedAgentStep = {
  stepIndex: number;
  kind: "google_search" | "code_execution" | "output";
  summary: string;
  detail?: string;
};

export type ManagedAgentReport = {
  agentId: string;
  baseAgent: string;
  interactionId: string;
  environmentId: string | null;
  durationMs: number;
  resolvedBrand: string | null;
  resolvedReference: string | null;
  msrpEstimate: string | null;
  buyingBrief: string;
  refinedSearchQueries: string[];
  steps: ManagedAgentStep[];
};

export type MatchLabel =
  | "exact_supported"
  | "possible"
  | "similar"
  | "unscored";

export type OfferOption = {
  name: string;
  label: string;
};

export type AvailableOptionGroup = {
  name: string;
  values: string[];
};

export type SignedOfferPayload = {
  offerId: string;
  itemId: string;
  productId: string;
  variantId: string;
  sellerDomain: string;
  sellerName: string;
  title: string;
  options: OfferOption[];
  amountMinor: number | null;
  currency: string | null;
  availability: "available" | "unavailable" | "unknown";
  productUrl: string;
  imageUrl: string | null;
  issuedAt: number;
  expiresAt: number;
};

export type Offer = {
  offerId: string;
  offerToken: string;
  itemId: string;
  productId: string;
  variantId: string;
  sellerDomain: string;
  sellerName: string;
  title: string;
  options: OfferOption[];
  availableOptions?: AvailableOptionGroup[];
  amountMinor: number | null;
  currency: string | null;
  availability: "available" | "unavailable" | "unknown";
  condition: string | null;
  productUrl: string;
  imageUrl: string | null;
  warnings: string[];
  originalSearchRank: number;
  exactMatchYes: number | null;
  confidence: number | null;
  matchLabel: MatchLabel;
  hardConflict: string | null;
  rationale: string;
};

export type EvidenceMode =
  | "multimodal_frames_and_catalog"
  | "frames_and_text"
  | "catalog_images_and_text"
  | "text_observations"
  | "catalog_fallback";

export type RankComparisonEntry = {
  offerId: string;
  title: string;
  sellerName: string;
  originalRank: number;
  finalRank: number;
  exactMatchYes: number | null;
  confidence: number | null;
  matchLabel: MatchLabel;
  hardConflict: string | null;
};

export type ItemMatchDiagnostics = {
  itemId: string;
  shopLive: boolean;
  decisionsLive: boolean;
  evidenceMode: EvidenceMode;
  decisionModel: string;
  candidateCount: number;
  queriesRun: string[];
  usedVisualSearch: boolean;
  photoSearchError: string | null;
  shopDurationMs: number;
  decisionsDurationMs: number;
  shopError: string | null;
  rankingError: string | null;
  rankComparison: RankComparisonEntry[];
};

export type ExtractDiagnostics = {
  videoModel: string;
  geminiLive: boolean;
  durationMs: number;
  videoSummary: string;
  totalTokens: number | null;
  droppedItemCount: number;
};

export type ExtractResponse = {
  traceId: string;
  videoId: string;
  canonicalUrl: string;
  question: string;
  items: TracedItem[];
  diagnostics: ExtractDiagnostics;
};

export type MatchItemResponse = {
  traceId: string;
  itemId: string;
  offers: Offer[];
  diagnostics: ItemMatchDiagnostics;
};

export type CheckoutPriceChange = {
  previousAmountMinor: number | null;
  previousCurrency: string | null;
  currentAmountMinor: number | null;
  currentCurrency: string | null;
  updatedOfferToken: string;
};

export type CheckoutTotalLine = {
  type: string;
  label: string;
  amountMinor: number;
};

export type CheckoutLink = {
  label: string;
  url: string;
};

export type CheckoutSummary = {
  checkoutRef: string;
  continueUrl: string;
  status: string;
  orderPlaced: boolean;
  sellerDomain: string;
  sellerName: string;
  variantId: string;
  title: string;
  options: OfferOption[];
  subtotalMinor: number | null;
  totalMinor: number | null;
  totalsBreakdown?: CheckoutTotalLine[];
  currency: string | null;
  warnings: string[];
  links?: CheckoutLink[];
  orderId: string | null;
  orderPermalink: string | null;
  updatedAt: string;
};

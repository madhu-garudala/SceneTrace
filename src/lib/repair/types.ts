export type RepairDecision = "repair" | "replace" | "no_action" | "abstain";

export type RepairOffer = {
  offerId: string;
  productId: string;
  variantId: string;
  sellerDomain: string;
  sellerName: string;
  title: string;
  amountMinor: number;
  currency: string;
  productUrl: string;
  imageUrl: string | null;
};

export type RepairFault = {
  question: string;
  /** P(this is a real fault), already corrected for polarity. */
  faultProbability: number;
  polarity: "fault" | "healthy";
  weight: number;
};

export type RepairDiagnostics = {
  questionBankMs: number;
  scoringMs: number;
  queryMs: number;
  searchMs: number;
  summaryMs: number;
  totalMs: number;
  questionCount: number;
  summaryFallback: boolean;
  cacheHit?: boolean;
};

export type RepairVerdict = {
  decision: RepairDecision;
  summary: string;
  damageLevel: number;
  faults: RepairFault[];
  part: RepairOffer | null;
  replacement: RepairOffer | null;
  partQuery: string;
  replacementQuery: string;
  genericMatch: boolean;
  diagnostics: RepairDiagnostics;
};

export type BankQuestion = {
  text: string;
  weight: number;
  polarity: "fault" | "healthy";
};

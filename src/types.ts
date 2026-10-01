/** Product keys accepted by every top-up and allocation call — see `products.list()`. */
export type ProductKey = "residential" | "premium" | "isp" | "mobile" | "ipv4" | "ipv6";
export type PlanName = "free" | "pro" | "business" | "advanced" | "enterprise";
/** Plans you can buy by card. */
export type PaidPlan = "pro" | "business" | "advanced";
export type BillingInterval = "month" | "year";
export type ProxyProtocol = "http" | "socks5";
export type CustomerStatus = "active" | "suspended";
export type TransactionStatus = "pending" | "succeeded" | "failed";

// --- Catalog ---------------------------------------------------------------

export interface Product {
  productKey: ProductKey;
  productId: string;
  name: string;
  description: string;
  /** Smallest purchasable amount, in GB. */
  minGb: number;
  /** Live price per GB in cents, or `null` if pricing is momentarily unavailable. */
  pricePerGbCents: number | null;
  currency: string;
}

export interface Catalog {
  products: Product[];
  /** Top-ups of `thresholdGb` or more get `floor(gb × rate)` extra GB free. */
  volumeBonus: { thresholdGb: number; rate: number };
  plans: { plan: PaidPlan; monthlyPriceCents: number; includedGb: number }[];
}

// --- Account ---------------------------------------------------------------

export interface Account {
  email: string;
  name: string;
  plan: PlanName;
  planExpiresAt: string | null;
  /** Lifetime GB credited. Spendable per-product balances come from `balances.list()`. */
  balanceGb: number;
  createdAt: string;
}

export interface Balance {
  productKey: ProductKey | null;
  productId: string;
  /** Pass to `plans.generate()`. `null` until the product has been funded once. */
  planId: string | null;
  activeGb: number;
  /** Paid for but still being added to the plan — becomes `activeGb` within seconds. */
  pendingGb: number;
  totalGb: number;
  expiresAt: string | null;
}

export interface PlanGenerateCapabilities {
  maxCount: number;
  /** `0` means this product has no sticky sessions. */
  maxStickyMinutes: number;
  protocols: ProxyProtocol[];
  targeting: { country: boolean; state: boolean; city: boolean; isp: boolean };
}

export interface Plan {
  id: string;
  productId: string;
  productKey: ProductKey | null;
  name: string;
  label: string | null;
  dataGbRemaining: number;
  dataGbTotal: number;
  expiresAt: string | null;
  createdAt: string;
  /** What this plan's `generate` call accepts. */
  generate: PlanGenerateCapabilities | null;
}

// --- Proxy generation ------------------------------------------------------

export interface GenerateParams {
  /** Default `"http"`. */
  protocol?: ProxyProtocol;
  /** 1–1000. Default 1. */
  count?: number;
  /** ISO 3166-1 alpha-2 country code, e.g. `"US"`. */
  country?: string;
  state?: string;
  city?: string;
  isp?: string;
  /** Omit for a fresh IP per request (rotating). Set for a sticky session. */
  stickyMinutes?: number;
}

// --- Payments --------------------------------------------------------------

export type CardCheckoutParams =
  | { kind: "topup"; productKey: ProductKey; gb: number }
  | { kind: "plan"; plan: PaidPlan; interval?: BillingInterval };

export interface CardCheckout {
  /** Stripe Checkout (or the subscription settings page, when switching an existing plan). */
  payUrl: string;
  /** `null` when `payUrl` is the subscription portal rather than a new payment. */
  transactionId: string | null;
}

export interface CryptoTopupParams {
  productKey: ProductKey;
  gb: number;
}

export interface CryptoCheckout {
  url: string;
  transactionId: string;
}

export interface Transaction {
  id: string;
  kind: "plan" | "topup";
  status: TransactionStatus;
  paymentMethod: "card" | "crypto";
  interval: BillingInterval | null;
  amountCents: number;
  currency: string;
  /** GB credited, including any volume bonus. */
  gb: number | null;
  productKey: ProductKey | null;
  plan: PlanName | null;
  /** `true` for a reseller pool purchase. */
  resellerPool: boolean;
  createdAt: string;
}

// --- Reseller --------------------------------------------------------------

export interface PoolEntry {
  productKey: ProductKey;
  productId: string;
  label: string;
  gb: number;
}

export interface ResellerSummary {
  email: string;
  customerCount: number;
  activeCustomerCount: number;
  pool: PoolEntry[];
}

export interface Customer {
  username: string;
  label: string;
  status: CustomerStatus;
  createdAt: string;
}

export interface PendingAllocation {
  productId: string;
  productKey: ProductKey | null;
  gb: number;
}

export interface CustomerDetail extends Customer {
  plans: (Plan & { remainingGb: number })[];
  /** GB allocated but still being added to a plan. */
  pending: PendingAllocation[];
}

export interface CustomerUsage {
  plans: {
    id: string;
    productId: string;
    productKey: ProductKey | null;
    remainingGb: number;
    totalGb: number;
    usedGb: number;
    expiresAt: string | null;
  }[];
  pending: PendingAllocation[];
}

export interface AllocateParams {
  productKey: ProductKey;
  /** Whole GB, at least the product's `minGb`. */
  gb: number;
  /** Makes retries safe: repeating a key returns `alreadyApplied: true` and moves nothing. */
  idempotencyKey?: string;
}

export interface Allocation {
  productKey: ProductKey;
  productId: string;
  gb: number;
  alreadyApplied: boolean;
  poolRemainingGb: number;
}

export interface CustomerGenerateParams extends GenerateParams {
  /** A plan id from `customers.get()`. */
  planId: string;
}

export interface PoolTopupParams {
  productKey: ProductKey;
  gb: number;
}

// --- Account creation (no API key) ----------------------------------------

export interface SignupParams {
  email: string;
  password: string;
  name?: string;
}

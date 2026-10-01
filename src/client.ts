import { HttpClient, type FetchLike } from "./http.js";
import { toGeneratedProxies, type GeneratedProxies } from "./proxy.js";
import { BuyProxyError } from "./errors.js";
import type {
  Account, AllocateParams, Allocation, Balance, CardCheckout, CardCheckoutParams, Catalog, CryptoCheckout,
  CryptoTopupParams, Customer, CustomerDetail, CustomerGenerateParams, CustomerStatus, CustomerUsage,
  GenerateParams, Plan, PoolEntry, PoolTopupParams, ResellerSummary, SignupParams, Transaction,
} from "./types.js";

export const VERSION = "1.0.0";
export const DEFAULT_BASE_URL = "https://www.buyproxy.org";

export interface BuyProxyOptions {
  /** `bp_key_…` (personal) or `bp_live_…` (reseller). Defaults to the `BUYPROXY_API_KEY` environment variable. */
  apiKey?: string;
  /** Default `https://www.buyproxy.org`. */
  baseUrl?: string;
  /** Per-request timeout. Default 30 000. */
  timeoutMs?: number;
  /** Retries for rate limits and transient failures. Default 2. */
  maxRetries?: number;
  /** Bring your own `fetch` (proxies, tests, older runtimes). Defaults to the global one. */
  fetch?: FetchLike;
}

function envKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.BUYPROXY_API_KEY : undefined;
}

/**
 * BuyProxy API client.
 *
 * ```ts
 * const bp = new BuyProxy({ apiKey: process.env.BUYPROXY_API_KEY });
 * const { proxies } = await bp.plans.generate(planId, { country: "US", count: 5 });
 * ```
 */
export class BuyProxy {
  readonly apiKey: string | undefined;
  private readonly http: HttpClient;

  constructor(options: BuyProxyOptions = {}) {
    this.apiKey = options.apiKey ?? envKey();
    const fetchImpl = options.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) throw new BuyProxyError("No global fetch — use Node 18+ or pass `fetch` in the options.");

    this.http = new HttpClient({
      apiKey: this.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
      fetch: fetchImpl,
      userAgent: `buyproxy-node/${VERSION}`,
    });
  }

  /** `"reseller"` for `bp_live_` keys, `"personal"` for `bp_key_` keys, `undefined` if no key is set. */
  get keyKind(): "reseller" | "personal" | undefined {
    if (!this.apiKey) return undefined;
    return this.apiKey.startsWith("bp_live_") ? "reseller" : "personal";
  }

  // --- Public ---------------------------------------------------------------

  readonly products = {
    /** Every product with its `productKey`, minimum GB and live price. No API key needed. */
    list: (): Promise<Catalog> => this.http.request({ method: "GET", path: "/v1/products", requireKey: false }),
  };

  /** Create an account without a browser: `signup`, then `verifyOtp` with the emailed code. */
  readonly auth = {
    signup: (params: SignupParams): Promise<{ ok: boolean; cooldownSeconds?: number }> =>
      this.http.request({ method: "POST", path: "/api/auth/signup", body: params, requireKey: false }),
    verifyOtp: (params: { email: string; code: string }): Promise<{ ok: boolean; isNew: boolean; user: { email: string; name: string } }> =>
      this.http.request({ method: "POST", path: "/api/auth/verify-otp", body: params, requireKey: false }),
    resendOtp: (params: { email: string }): Promise<{ ok: boolean }> =>
      this.http.request({ method: "POST", path: "/api/auth/resend-otp", body: params, requireKey: false }),
  };

  // --- Personal API -----------------------------------------------------------

  readonly account = {
    get: (): Promise<Account> => this.http.request({ method: "GET", path: "/v1/account" }),
  };

  readonly balances = {
    /** Spendable GB per product, including GB still being added after a payment. */
    list: async (): Promise<Balance[]> => (await this.http.request<{ balances: Balance[] }>({ method: "GET", path: "/v1/balances" })).balances,
  };

  readonly plans = {
    list: async (): Promise<Plan[]> => (await this.http.request<{ plans: Plan[] }>({ method: "GET", path: "/v1/plans" })).plans,

    /** Generate proxy lines against one of your plans. Lines are on-demand — don't store them. */
    generate: async (planId: string, params: GenerateParams = {}): Promise<GeneratedProxies> => {
      const { lines } = await this.http.request<{ lines: string[] }>({
        method: "POST",
        path: `/v1/plans/${encodeURIComponent(planId)}/generate`,
        body: params,
      });
      return toGeneratedProxies(lines, params.protocol);
    },
  };

  readonly topup = {
    /** Card checkout via Stripe — a pay-as-you-go top-up or a plan subscription. Open `payUrl` to pay. */
    card: (params: CardCheckoutParams): Promise<CardCheckout> =>
      this.http.request({ method: "POST", path: "/v1/topup/card", body: params }),

    /** Crypto top-up (pay-as-you-go only). Open `url` to pay. */
    crypto: (params: CryptoTopupParams): Promise<CryptoCheckout> =>
      this.http.request({ method: "POST", path: "/v1/topup/crypto", body: { kind: "topup", ...params } }),
  };

  readonly transactions = {
    list: async (params: { limit?: number } = {}): Promise<Transaction[]> =>
      (await this.http.request<{ transactions: Transaction[] }>({ method: "GET", path: "/v1/transactions", query: { limit: params.limit } })).transactions,

    get: (id: string): Promise<Transaction> => this.http.request({ method: "GET", path: `/v1/transactions/${encodeURIComponent(id)}` }),

    /** Polls until the payment settles (`succeeded` or `failed`) or the timeout passes. */
    wait: async (id: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<Transaction> => {
      const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
      const interval = options.intervalMs ?? 3000;
      for (;;) {
        const tx = await this.transactions.get(id);
        if (tx.status !== "pending") return tx;
        if (Date.now() + interval > deadline) throw new BuyProxyError(`Payment ${id} is still pending after waiting`);
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
  };

  // --- Reseller API (bp_live_ keys, Business plan or higher) -----------------

  readonly reseller = {
    me: (): Promise<ResellerSummary> => this.http.request({ method: "GET", path: "/v1/me" }),

    customers: {
      list: async (params: { status?: CustomerStatus } = {}): Promise<Customer[]> =>
        (await this.http.request<{ customers: Customer[] }>({ method: "GET", path: "/v1/customers", query: { status: params.status } })).customers,

      /** Creates an isolated sub-account with no bandwidth — fund it with `allocate`. */
      create: (params: { label: string }): Promise<Customer> =>
        this.http.request({ method: "POST", path: "/v1/customers", body: params }),

      get: (username: string): Promise<CustomerDetail> =>
        this.http.request({ method: "GET", path: `/v1/customers/${encodeURIComponent(username)}` }),

      /** Rename and/or suspend/reactivate. */
      update: (username: string, params: { label?: string; status?: CustomerStatus }): Promise<Customer> =>
        this.http.request({ method: "PATCH", path: `/v1/customers/${encodeURIComponent(username)}`, body: params }),

      usage: (username: string): Promise<CustomerUsage> =>
        this.http.request({ method: "GET", path: `/v1/customers/${encodeURIComponent(username)}/usage` }),

      /** Moves GB from your pool onto a customer. Pass `idempotencyKey` to make retries safe. */
      allocate: (username: string, params: AllocateParams): Promise<Allocation> => {
        const { idempotencyKey, ...body } = params;
        return this.http.request({
          method: "POST",
          path: `/v1/customers/${encodeURIComponent(username)}/allocate`,
          body,
          headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
          retryOnServerError: Boolean(idempotencyKey),
        });
      },

      generate: async (username: string, params: CustomerGenerateParams): Promise<GeneratedProxies> => {
        const { lines } = await this.http.request<{ lines: string[] }>({
          method: "POST",
          path: `/v1/customers/${encodeURIComponent(username)}/generate`,
          body: params,
        });
        return toGeneratedProxies(lines, params.protocol);
      },
    },

    pool: {
      /** Your unallocated bandwidth, per product. */
      get: async (): Promise<PoolEntry[]> => (await this.http.request<{ pool: PoolEntry[] }>({ method: "GET", path: "/v1/pool" })).pool,
      topupCard: (params: PoolTopupParams): Promise<CardCheckout> =>
        this.http.request({ method: "POST", path: "/v1/pool/topup/card", body: params }),
      topupCrypto: (params: PoolTopupParams): Promise<CryptoCheckout> =>
        this.http.request({ method: "POST", path: "/v1/pool/topup/crypto", body: params }),
    },
  };
}

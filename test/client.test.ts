import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError, BuyProxy, InsufficientBandwidthError, NotFoundError, RateLimitError, ServerError, TimeoutError,
} from "../src/index.js";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(handler: (url: string, init: RequestInit) => Response | Promise<Response>, extra = {}) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => handler(url, init ?? {}));
  return { bp: new BuyProxy({ apiKey: "bp_key_x", fetch, maxRetries: 2, ...extra }), fetch };
}

describe("BuyProxy client", () => {
  it("sends the key, JSON body and a buyproxy-node user agent", async () => {
    const { bp, fetch } = client(() => reply(200, { lines: ["u:p@gw.buyproxy.org:6969"] }));
    const out = await bp.plans.generate("plan 1", { protocol: "socks5", count: 1 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://www.buyproxy.org/v1/plans/plan%201/generate");
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("bp_key_x");
    expect(headers["User-Agent"]).toMatch(/^buyproxy-node\//);
    expect(JSON.parse(init!.body as string)).toEqual({ protocol: "socks5", count: 1 });
    expect(out.proxies[0]!.protocol).toBe("socks5");
  });

  it("refuses authenticated calls without a key, but allows the public catalog", async () => {
    const fetch = vi.fn(async () => reply(200, { products: [], volumeBonus: { thresholdGb: 100, rate: 0.1 }, plans: [] }));
    const bp = new BuyProxy({ fetch, apiKey: "" });
    await expect(bp.account.get()).rejects.toBeInstanceOf(AuthenticationError);
    await expect(bp.products.list()).resolves.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP statuses to typed errors", async () => {
    const cases: [number, new (...a: never[]) => Error][] = [
      [401, AuthenticationError], [402, InsufficientBandwidthError], [404, NotFoundError],
    ];
    for (const [status, type] of cases) {
      const { bp } = client(() => reply(status, { error: "nope" }));
      await expect(bp.account.get()).rejects.toBeInstanceOf(type);
    }
    const { bp } = client(() => reply(401, { error: "Invalid BuyProxy API key" }));
    await expect(bp.account.get()).rejects.toMatchObject({ message: "Invalid BuyProxy API key", status: 401 });
  });

  it("retries a 429 after Retry-After and then succeeds", async () => {
    let calls = 0;
    const { bp } = client(() => (++calls === 1 ? reply(429, { error: "slow down" }, { "retry-after": "0" }) : reply(200, { plan: "pro" })));
    await expect(bp.account.get()).resolves.toEqual({ plan: "pro" });
    expect(calls).toBe(2);
  });

  it("gives up with RateLimitError after maxRetries", async () => {
    const { bp, fetch } = client(() => reply(429, { error: "slow" }, { "retry-after": "0" }));
    const err = await bp.account.get().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-idempotent POST on 503, but does with an idempotency key", async () => {
    const plain = client(() => reply(503, { error: "down" }));
    await expect(plain.bp.reseller.customers.allocate("c", { productKey: "premium", gb: 1 })).rejects.toBeInstanceOf(ServerError);
    expect(plain.fetch).toHaveBeenCalledTimes(1);

    let calls = 0;
    const keyed = client(() => (++calls < 2 ? reply(503, { error: "down" }) : reply(201, { gb: 1, alreadyApplied: false })));
    await keyed.bp.reseller.customers.allocate("c", { productKey: "premium", gb: 1, idempotencyKey: "k1" });
    expect(calls).toBe(2);
    expect((keyed.fetch.mock.calls[0]![1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(keyed.fetch.mock.calls[0]![1]!.body as string)).toEqual({ productKey: "premium", gb: 1 });
  });

  it("times out", async () => {
    const { bp } = client(
      (_url, init) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
      { timeoutMs: 20, maxRetries: 0 },
    );
    await expect(bp.account.get()).rejects.toBeInstanceOf(TimeoutError);
  });

  it("transactions.wait polls until the payment settles", async () => {
    let n = 0;
    const { bp } = client(() => reply(200, { id: "st_1", status: ++n < 3 ? "pending" : "succeeded" }));
    const tx = await bp.transactions.wait("st_1", { intervalMs: 1 });
    expect(tx.status).toBe("succeeded");
    expect(n).toBe(3);
  });

  it("reports the key kind", () => {
    expect(new BuyProxy({ apiKey: "bp_live_x", fetch: vi.fn() }).keyKind).toBe("reseller");
    expect(new BuyProxy({ apiKey: "bp_key_x", fetch: vi.fn() }).keyKind).toBe("personal");
  });
});

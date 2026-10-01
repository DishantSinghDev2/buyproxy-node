# BuyProxy Node.js & TypeScript SDK — Residential Proxy API Client

[![npm](https://img.shields.io/npm/v/buyproxy?logo=npm&color=cb3837)](https://www.npmjs.com/package/buyproxy)
[![downloads](https://img.shields.io/npm/dm/buyproxy)](https://www.npmjs.com/package/buyproxy)
[![CI](https://github.com/DishantSinghDev2/buyproxy-node/actions/workflows/ci.yml/badge.svg)](https://github.com/DishantSinghDev2/buyproxy-node/actions/workflows/ci.yml)
![types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

The official **Node.js / TypeScript SDK** for [BuyProxy](https://www.buyproxy.org): generate **residential, mobile, ISP and datacenter proxies**, check bandwidth, top up by card or crypto, and run a **proxy reseller** business — all from one typed client with zero runtime dependencies.

**Keywords:** residential proxies · rotating proxies · mobile proxies · ISP proxies · datacenter proxies · SOCKS5 · proxy API · web scraping · proxy reseller

## Features

- Zero dependencies — uses the platform's `fetch`
- Complete TypeScript types for every request and response
- Automatic retries with back-off for rate limits (`429`) and transient errors
- Typed errors: `AuthenticationError`, `InsufficientBandwidthError`, `RateLimitError`, …
- Helpers for **Playwright**, **Puppeteer**, **Axios** and environment variables

## Installation

```bash
npm install buyproxy
# or: pnpm add buyproxy · yarn add buyproxy · bun add buyproxy
```

Node.js 18+, Bun, Deno, Cloudflare Workers and any runtime with a global `fetch`. Ships ESM and CommonJS builds with full `.d.ts` types.

## Quick start

```ts
import { BuyProxy } from "buyproxy";

const bp = new BuyProxy({ apiKey: process.env.BUYPROXY_API_KEY }); // or just set BUYPROXY_API_KEY

// 1. See what you have
const balances = await bp.balances.list();
const [plan] = await bp.plans.list();

// 2. Generate 5 US proxies in Austin, rotating on every request
const { proxies } = await bp.plans.generate(plan.id, { country: "US", city: "Austin", count: 5 });

console.log(proxies[0].url); // http://user-country-us-city-austin:pass@gw.buyproxy.org:6969
```

Add `stickyMinutes: 10` to keep the same IP for ten minutes, or `protocol: "socks5"` for SOCKS5.

## Using the proxies with your stack

### Playwright

```ts
import { chromium } from "playwright";

const browser = await chromium.launch({ proxy: proxies[0].toPlaywright() });
const page = await browser.newPage();
await page.goto("https://api.ipify.org");
```

### Puppeteer

```ts
import puppeteer from "puppeteer";

const { args, credentials } = proxies[0].toPuppeteer();
const browser = await puppeteer.launch({ args });
const page = await browser.newPage();
await page.authenticate(credentials);
```

### Axios

```ts
import axios from "axios";

const { data } = await axios.get("https://api.ipify.org", { proxy: proxies[0].toAxios() });
```

### Node.js `fetch` / undici

```ts
import { ProxyAgent } from "undici";

const res = await fetch("https://api.ipify.org", { dispatcher: new ProxyAgent(proxies[0].url) });
```

### curl & shell

```ts
console.log(proxies[0].toCurl());   // curl -x 'http://user:pass@gw.buyproxy.org:6969' https://api.ipify.org
console.log(proxies[0].toEnv());    // { HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, … }
```

## Buy bandwidth (card & crypto)

```ts
// Buy 10 GB of Core Residential by card — open payUrl in a browser
const { payUrl, transactionId } = await bp.topup.card({ kind: "topup", productKey: "residential", gb: 10 });

// Or subscribe to a plan (monthly or yearly)
await bp.topup.card({ kind: "plan", plan: "pro", interval: "year" });

// Crypto (pay-as-you-go top-ups only)
await bp.topup.crypto({ productKey: "residential", gb: 50 });

// Wait for the payment to settle — GB appears on bp.balances.list() right after
const tx = await bp.transactions.wait(transactionId!);
console.log(tx.status); // "succeeded"
```

Card payments run through Stripe Checkout; crypto is available for pay-as-you-go top-ups.

## Reseller API

Build a proxy product on top of BuyProxy: buy bandwidth in bulk into a **reseller pool**, create isolated **customers**, and allocate GB to them. Needs a `bp_live_` key on a Business plan or higher.

```ts
const reseller = new BuyProxy({ apiKey: process.env.BUYPROXY_RESELLER_KEY }); // bp_live_… key

await reseller.reseller.pool.topupCard({ productKey: "residential", gb: 500 });     // buy into your pool
const customer = await reseller.reseller.customers.create({ label: "Acme Inc" });   // isolated sub-account

await reseller.reseller.customers.allocate(customer.username, {
  productKey: "residential", gb: 20, idempotencyKey: "order-1042",                  // safe to retry
});

const { proxies } = await reseller.reseller.customers.generate(customer.username, {
  planId: (await reseller.reseller.customers.get(customer.username)).plans[0].id,
  country: "DE",
});

await reseller.reseller.customers.update(customer.username, { status: "suspended" });
```

## Error handling

```ts
import { BuyProxy, AuthenticationError, InsufficientBandwidthError, RateLimitError } from "buyproxy";

try {
  await bp.plans.generate(planId);
} catch (err) {
  if (err instanceof InsufficientBandwidthError) console.log("Out of GB — top up first");
  else if (err instanceof RateLimitError) console.log(`Slow down; retry in ${err.retryAfterSeconds}s`);
  else if (err instanceof AuthenticationError) console.log("Check your API key");
  else throw err;
}
```
Every error extends `BuyProxyError` and exposes `status` and the parsed `body`.

## Configuration

```ts
new BuyProxy({
  apiKey: "bp_key_…",          // default: process.env.BUYPROXY_API_KEY
  baseUrl: "https://www.buyproxy.org",
  timeoutMs: 30_000,
  maxRetries: 2,                // 429s always; 5xx only for safe requests
  fetch: myFetch,               // bring your own fetch
});
```

## API overview

| Capability | Call |
|---|---|
| Catalog & prices | `bp.products.list()` |
| Account | `bp.account.get()` |
| Spendable GB per product | `bp.balances.list()` |
| Plans | `bp.plans.list()` |
| Generate proxies | `bp.plans.generate(planId, params)` |
| Card checkout | `bp.topup.card(params)` |
| Crypto checkout | `bp.topup.crypto(params)` |
| Payments | `bp.transactions.list()` · `.get(id)` · `.wait(id)` |
| Create an account | `bp.auth.signup()` · `.verifyOtp()` · `.resendOtp()` |
| Reseller summary | `bp.reseller.me()` |
| Customers | `bp.reseller.customers.list/create/get/update/usage/allocate/generate` |
| Reseller pool | `bp.reseller.pool.get/topupCard/topupCrypto` |

Full endpoint reference: <https://www.buyproxy.org/docs/api-reference/introduction> · OpenAPI spec: <https://www.buyproxy.org/openapi.yaml>

## FAQ

**How do I get an API key?**
Create a free account at [buyproxy.org](https://www.buyproxy.org/signup), then open **Dashboard → API keys**. Personal keys start with `bp_key_`; reseller keys (Business plan and above) start with `bp_live_`. You can create the *account* from code (`signup` + `verify otp`), but keys are issued from the dashboard.

**What's the difference between a personal and a reseller key?**
A personal key (`bp_key_…`) manages your own bandwidth: balances, plans, generating proxies, top-ups and payments. A reseller key (`bp_live_…`) manages *your customers*: create isolated sub-accounts, buy bandwidth into a pool, allocate it, suspend or reactivate, and generate proxies on their behalf.

**Which proxy types are available?**
Core Residential, Premium Residential, ISP Rotating, Mobile, Datacenter IPv4 and IPv6 — call the catalog endpoint for the live list and per-GB prices (from **$1.99/GB**).

**Do generated proxies expire, and when is bandwidth used?**
Generating a proxy is free and instant; bandwidth is only consumed when traffic flows through it. Lines are on-demand — generate fresh ones rather than storing them.

**What are the rate limits?**
60 requests per minute per API key. The SDK honours `Retry-After` and retries rate-limited requests automatically.

**Is it free to use the SDK?**
Yes — the SDK is MIT-licensed. You pay only for the proxy bandwidth you buy.

## Other BuyProxy SDKs

[Node.js](https://github.com/DishantSinghDev2/buyproxy-node) · [Python](https://github.com/DishantSinghDev2/buyproxy-python) · [Go](https://github.com/DishantSinghDev2/buyproxy-go) · [PHP](https://github.com/DishantSinghDev2/buyproxy-php) · [Ruby](https://github.com/DishantSinghDev2/buyproxy-ruby) · [Java](https://github.com/DishantSinghDev2/buyproxy-java) · [.NET](https://github.com/DishantSinghDev2/buyproxy-dotnet) · [Rust](https://github.com/DishantSinghDev2/buyproxy-rust) · [CLI](https://github.com/DishantSinghDev2/buyproxy-cli)

All SDKs are checked against the same request log, so behaviour is identical across languages — see [buyproxy-sdks](https://github.com/DishantSinghDev2/buyproxy-sdks).

## Development

```bash
npm install
npm run typecheck && npm test && npm run build
```

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Links

- Website: <https://www.buyproxy.org>
- Documentation: <https://www.buyproxy.org/docs/sdks>
- Pricing: <https://www.buyproxy.org/pricing>
- Support: <support@buyproxy.org>

## License

[MIT](LICENSE) © BuyProxy

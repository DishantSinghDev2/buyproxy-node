import { AuthenticationError, BuyProxyError, ConnectionError, TimeoutError, errorFromResponse } from "./errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: FetchLike;
  userAgent: string;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Public endpoints (catalog, signup) work without a key. */
  requireKey?: boolean;
  /** Safe to retry on 5xx — GETs, and writes carrying an idempotency key. */
  retryOnServerError?: boolean;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  constructor(private readonly options: HttpOptions) {}

  get hasKey(): boolean {
    return Boolean(this.options.apiKey);
  }

  async request<T>(req: RequestOptions): Promise<T> {
    const { apiKey, baseUrl, timeoutMs, maxRetries, userAgent } = this.options;

    if (req.requireKey !== false && !apiKey) {
      throw new AuthenticationError(
        "No API key — pass `apiKey` to the client or set BUYPROXY_API_KEY. Create one at https://www.buyproxy.org/dashboard/api-keys",
      );
    }

    const url = new URL(baseUrl.replace(/\/+$/, "") + req.path);
    for (const [name, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": userAgent,
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
      ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...req.headers,
    };
    const body = req.body !== undefined ? JSON.stringify(req.body) : undefined;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await this.options.fetch(url.toString(), { method: req.method, headers, body, signal: controller.signal });
      } catch (cause) {
        clearTimeout(timer);
        const timedOut = controller.signal.aborted;
        const error = timedOut
          ? new TimeoutError(`Request timed out after ${timeoutMs}ms`, undefined, undefined, { cause })
          : new ConnectionError(`Could not reach BuyProxy: ${(cause as Error)?.message ?? cause}`, undefined, undefined, { cause });
        if (attempt < maxRetries && req.retryOnServerError) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw error;
      }
      clearTimeout(timer);

      const text = await response.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      if (response.ok) {
        if (parsed === undefined && text) {
          throw new BuyProxyError(`BuyProxy returned a non-JSON response (HTTP ${response.status})`, response.status);
        }
        return parsed as T;
      }

      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const rateLimited = response.status === 429;
      const transient = RETRYABLE_STATUS.has(response.status) && req.retryOnServerError === true;
      if (attempt < maxRetries && (rateLimited || transient)) {
        await sleep(retryAfter !== undefined ? retryAfter * 1000 : backoffMs(attempt));
        continue;
      }
      throw errorFromResponse(response.status, parsed, retryAfter);
    }
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) : undefined;
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000) * (0.75 + Math.random() * 0.5);
}

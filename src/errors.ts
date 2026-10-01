/** Base class for every error thrown by the BuyProxy SDK. */
export class BuyProxyError extends Error {
  /** HTTP status, or `undefined` for errors that never reached the API (network, timeout). */
  readonly status: number | undefined;
  /** Parsed JSON error body returned by the API, when there was one. */
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
  }
}

/** 400 — the request was malformed or a parameter was invalid. */
export class ValidationError extends BuyProxyError {}
/** 401 — the API key is missing or invalid. */
export class AuthenticationError extends BuyProxyError {}
/** 402 — not enough bandwidth (empty reseller pool, or a plan with no GB left). */
export class InsufficientBandwidthError extends BuyProxyError {}
/** 403 — the account is suspended, the key lacks the plan for this endpoint, or a customer is suspended. */
export class PermissionError extends BuyProxyError {}
/** 404 — the plan, customer or transaction doesn't exist on this account. */
export class NotFoundError extends BuyProxyError {}

/** 429 — more than 60 requests/minute on this key. */
export class RateLimitError extends BuyProxyError {
  /** Seconds the API asked you to wait, when it said. */
  readonly retryAfterSeconds: number | undefined;
  constructor(message: string, body: unknown, retryAfterSeconds?: number) {
    super(message, 429, body);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 5xx — BuyProxy or an upstream provider is unavailable; usually safe to retry. */
export class ServerError extends BuyProxyError {}
/** The request never got a response (DNS, connection reset, offline). */
export class ConnectionError extends BuyProxyError {}
/** The request exceeded `timeoutMs`. */
export class TimeoutError extends BuyProxyError {}

export function errorFromResponse(status: number, body: unknown, retryAfterSeconds?: number): BuyProxyError {
  const message =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : `BuyProxy API error (HTTP ${status})`;

  switch (status) {
    case 400:
      return new ValidationError(message, status, body);
    case 401:
      return new AuthenticationError(message, status, body);
    case 402:
      return new InsufficientBandwidthError(message, status, body);
    case 403:
      return new PermissionError(message, status, body);
    case 404:
      return new NotFoundError(message, status, body);
    case 429:
      return new RateLimitError(message, body, retryAfterSeconds);
    default:
      return status >= 500 ? new ServerError(message, status, body) : new BuyProxyError(message, status, body);
  }
}

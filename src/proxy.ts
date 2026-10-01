import type { ProxyProtocol } from "./types.js";

/**
 * One generated proxy. Lines from the API look like
 * `username:password@host:port` — targeting is baked into the username.
 */
export class ProxyEndpoint {
  constructor(
    readonly host: string,
    readonly port: number,
    readonly username: string,
    readonly password: string,
    readonly protocol: ProxyProtocol = "http",
  ) {}

  /** Parses a `username:password@host:port` line. Throws on anything else. */
  static parse(line: string, protocol: ProxyProtocol = "http"): ProxyEndpoint {
    const at = line.lastIndexOf("@");
    const credentials = at >= 0 ? line.slice(0, at) : "";
    const address = at >= 0 ? line.slice(at + 1) : "";
    const colonInCredentials = credentials.indexOf(":");
    const colonInAddress = address.lastIndexOf(":");
    const port = Number(address.slice(colonInAddress + 1));

    if (colonInCredentials < 1 || colonInAddress < 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new TypeError(`Not a proxy line (expected username:password@host:port): ${JSON.stringify(line)}`);
    }
    return new ProxyEndpoint(
      address.slice(0, colonInAddress),
      port,
      credentials.slice(0, colonInCredentials),
      credentials.slice(colonInCredentials + 1),
      protocol,
    );
  }

  /** `username:password@host:port` — the form the API returns. */
  toString(): string {
    return `${this.username}:${this.password}@${this.host}:${this.port}`;
  }

  /** `http://host:port` — no credentials. */
  get server(): string {
    return `${this.protocol}://${this.host}:${this.port}`;
  }

  /** Full URL with percent-encoded credentials, ready for any HTTP client: `http://user:pass@host:port`. */
  get url(): string {
    return `${this.protocol}://${encodeURIComponent(this.username)}:${encodeURIComponent(this.password)}@${this.host}:${this.port}`;
  }

  /** Playwright `launch({ proxy })` / `newContext({ proxy })` option. */
  toPlaywright(): { server: string; username: string; password: string } {
    return { server: this.server, username: this.username, password: this.password };
  }

  /** Puppeteer: pass `args` to `launch()`, then `page.authenticate(credentials)`. */
  toPuppeteer(): { args: string[]; credentials: { username: string; password: string } } {
    return {
      args: [`--proxy-server=${this.server}`],
      credentials: { username: this.username, password: this.password },
    };
  }

  /** Axios `proxy` option (HTTP proxies only — use `url` with an agent for SOCKS5). */
  toAxios(): { protocol: string; host: string; port: number; auth: { username: string; password: string } } {
    return { protocol: this.protocol, host: this.host, port: this.port, auth: { username: this.username, password: this.password } };
  }

  /** Environment variables understood by curl, wget, pip, npm, git and most CLIs. */
  toEnv(): Record<string, string> {
    const url = this.url;
    return { HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url, http_proxy: url, https_proxy: url, all_proxy: url };
  }

  /** A ready-to-run curl command that fetches your exit IP through this proxy. */
  toCurl(target = "https://api.ipify.org"): string {
    const scheme = this.protocol === "socks5" ? "socks5h" : "http";
    return `curl -x '${scheme}://${this.username}:${this.password}@${this.host}:${this.port}' ${target}`;
  }

  toJSON(): { host: string; port: number; username: string; password: string; protocol: ProxyProtocol; url: string } {
    return { host: this.host, port: this.port, username: this.username, password: this.password, protocol: this.protocol, url: this.url };
  }
}

/** The result of a `generate` call: the raw lines plus parsed endpoints. */
export interface GeneratedProxies {
  lines: string[];
  proxies: ProxyEndpoint[];
}

export function toGeneratedProxies(lines: string[], protocol: ProxyProtocol = "http"): GeneratedProxies {
  return { lines, proxies: lines.map((line) => ProxyEndpoint.parse(line, protocol)) };
}

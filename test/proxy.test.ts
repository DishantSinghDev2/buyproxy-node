import { describe, expect, it } from "vitest";
import { ProxyEndpoint } from "../src/index.js";

describe("ProxyEndpoint", () => {
  const line = "user-country-us-city-austin:p@ss:w0rd@gw.buyproxy.org:6969";

  it("parses username:password@host:port, keeping @ and : inside the password", () => {
    const p = ProxyEndpoint.parse(line);
    expect(p.host).toBe("gw.buyproxy.org");
    expect(p.port).toBe(6969);
    expect(p.username).toBe("user-country-us-city-austin");
    expect(p.password).toBe("p@ss:w0rd");
    expect(p.toString()).toBe(line);
  });

  it("percent-encodes credentials in url", () => {
    expect(ProxyEndpoint.parse(line).url).toBe("http://user-country-us-city-austin:p%40ss%3Aw0rd@gw.buyproxy.org:6969");
  });

  it("honours the protocol", () => {
    const p = ProxyEndpoint.parse(line, "socks5");
    expect(p.server).toBe("socks5://gw.buyproxy.org:6969");
    expect(p.toCurl()).toContain("socks5h://");
  });

  it("maps to Playwright, Puppeteer, Axios and env", () => {
    const p = ProxyEndpoint.parse("u:p@h.example:8080");
    expect(p.toPlaywright()).toEqual({ server: "http://h.example:8080", username: "u", password: "p" });
    expect(p.toPuppeteer().args).toEqual(["--proxy-server=http://h.example:8080"]);
    expect(p.toAxios().auth).toEqual({ username: "u", password: "p" });
    expect(p.toEnv().HTTPS_PROXY).toBe("http://u:p@h.example:8080");
  });

  it.each(["", "nope", "u:p@host", "u:p@host:99999", ":p@host:80", "u@host:80"])("rejects %j", (bad) => {
    expect(() => ProxyEndpoint.parse(bad)).toThrow(TypeError);
  });
});

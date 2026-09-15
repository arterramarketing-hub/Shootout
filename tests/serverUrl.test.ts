import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_PORT, defaultServerUrl } from "../src/engine/settings";

/**
 * Leaving the server field blank means "a server on this machine", which is
 * the case during every local test. The scheme has to follow the page's: a
 * page served over https cannot open an insecure socket, and guessing wrong
 * fails in a way that looks like the server is down rather than like a
 * mismatch the player could fix.
 */
describe("defaultServerUrl", () => {
  it("points at this machine when the page is served locally", () => {
    const url = defaultServerUrl({ protocol: "http:", hostname: "localhost" });
    expect(url).toBe(`ws://localhost:${DEFAULT_SERVER_PORT}`);
  });

  it("follows the page to whatever host is serving it", () => {
    const url = defaultServerUrl({ protocol: "http:", hostname: "192.168.1.24" });
    expect(url).toBe(`ws://192.168.1.24:${DEFAULT_SERVER_PORT}`);
  });

  it("asks for a secure socket from a secure page", () => {
    const url = defaultServerUrl({ protocol: "https:", hostname: "example.github.io" });
    expect(url).toBe(`wss://example.github.io:${DEFAULT_SERVER_PORT}`);
  });

  it("falls back to localhost for a page opened from a file", () => {
    // A file:// page has no hostname, and the only server it could mean is
    // one on the same machine.
    const url = defaultServerUrl({ protocol: "file:", hostname: "" });
    expect(url).toBe(`ws://localhost:${DEFAULT_SERVER_PORT}`);
  });
});

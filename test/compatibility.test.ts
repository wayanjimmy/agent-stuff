import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverAndLoadExtensions,
  type Extension,
  type ExtensionContext,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { performExtract } from "../pi-extensions/web-search";

let extensions: Extension[];
beforeAll(async () => {
  const empty = await mkdtemp(join(tmpdir(), "jimbopi-compat-"));
  try {
    const loaded = await discoverAndLoadExtensions([resolve("pi-extensions")], empty, empty);
    expect(loaded.errors).toEqual([]);
    extensions = loaded.extensions;
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function extension(name: string) {
  return extensions.find((e) => e.path.endsWith(`/${name}.ts`))!;
}
function tool(name: string) {
  return extension("web-search").tools.get(name)!.definition;
}
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

describe("real Pi API compatibility", () => {
  it("loads all four extensions through Pi's loader", () => {
    expect(extensions).toHaveLength(4);
    expect([...extension("web-search").tools.keys()]).toEqual([
      "web_search",
      "web_extract",
      "web_crawl",
    ]);
  });

  it.each([
    ["web_search", { objective: "test" }],
    ["web_extract", { urls: ["https://example.com"] }],
    ["web_crawl", { url: "https://example.com" }],
  ])("%s rejects missing credentials rather than returning empty success", async (name, args) => {
    vi.stubEnv("TAVILY_API_KEY", "");
    await expect(
      tool(name).execute("test", args, undefined, undefined, {} as ExtensionContext),
    ).rejects.toThrow("TAVILY_API_KEY");
  });

  it.each([
    ["web_search", { objective: " " }],
    ["web_extract", { urls: [" "] }],
    ["web_crawl", { url: " " }],
  ])("%s rejects blank arguments", async (name, args) => {
    await expect(
      tool(name).execute("test", args, undefined, undefined, {} as ExtensionContext),
    ).rejects.toThrow("Invalid parameters");
  });

  it.each(["web_search", "web_extract", "web_crawl"])("%s renders incomplete arguments", (name) => {
    const component = tool(name).renderCall!({}, theme as never, {} as never);
    expect(component.render(80).length).toBeGreaterThan(0);
  });

  it("uses real enum and boolean schemas", () => {
    const search = tool("web_search").parameters.properties;
    expect(search.search_depth.enum).toEqual(["basic", "advanced"]);
    expect(search.time_range.enum).toEqual(["day", "week", "month", "year"]);
    expect(search.include_answer.type).toBe("boolean");
    expect(tool("web_crawl").parameters.properties.allow_external.type).toBe("boolean");
  });

  it.each(["rpc", "print", "json"])("/prev explicitly rejects %s mode", async (mode) => {
    const notify = vi.fn();
    const custom = vi.fn();
    await extension("prev-session")
      .commands.get("prev")!
      .handler("", {
        mode,
        ui: { notify, custom },
      } as unknown as ExtensionCommandContext);
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("/prev requires interactive TUI mode", "error");
  });

  it("keeps the title spinner running until settled and cleans up on shutdown", async () => {
    vi.useFakeTimers();
    const e = extension("titlebar-spinner");
    // Session name access needs a bound runtime; use the actual factory with a narrow API harness.
    const { default: spinner } = await import("../pi-extensions/titlebar-spinner");
    const handlers = new Map<string, Function>();
    spinner({
      on: (name: string, fn: Function) => handlers.set(name, fn),
      getSessionName: () => "audit",
    } as never);
    const setTitle = vi.fn();
    const ctx = { mode: "tui", cwd: "/tmp/project", ui: { setTitle } };
    expect(e.handlers.has("agent_end")).toBe(false);
    handlers.get("agent_start")!({}, ctx);
    handlers.get("agent_start")!({}, ctx);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(160);
    expect(setTitle).toHaveBeenLastCalledWith(expect.stringContaining("π - audit - project"));
    handlers.get("agent_settled")!({}, ctx);
    expect(vi.getTimerCount()).toBe(0);
    expect(setTitle).toHaveBeenLastCalledWith("π - audit - project");
    handlers.get("agent_start")!({}, ctx);
    handlers.get("session_shutdown")!({}, ctx);
    handlers.get("session_shutdown")!({}, ctx);
    expect(vi.getTimerCount()).toBe(0);
    handlers.get("agent_start")!({}, { ...ctx, mode: "rpc" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not report success after cancellation during an extract retry", async () => {
    const controller = new AbortController();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [], failed: [{ url: "https://example.com" }] })),
      )
      .mockImplementationOnce(() => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      });
    const result = await performExtract({ urls: ["https://example.com"] }, controller.signal, {
      getApiKey: () => "test-key",
      fetchFn,
    });
    expect(result.status).toBe("aborted");
  });
});

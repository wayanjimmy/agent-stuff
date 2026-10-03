import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverAndLoadExtensions,
  type Extension,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

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

describe("real Pi API compatibility", () => {
  it("loads all three extensions through Pi's loader", () => {
    expect(extensions).toHaveLength(3);
    expect(extensions.map((e) => e.path.split("/").pop()).sort()).toEqual([
      "prev-session.ts",
      "titlebar-spinner.ts",
      "whimsical.ts",
    ]);
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
});

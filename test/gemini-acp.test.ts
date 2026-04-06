import { describe, expect, it } from "vitest";

import { getGeminiLaunchSpec } from "../pi-extensions/gemini-acp";

describe("getGeminiLaunchSpec", () => {
  it("spawns Gemini directly on unix-like platforms", () => {
    expect(getGeminiLaunchSpec("gemini", "linux")).toEqual({
      command: "gemini",
      args: ["--acp"],
    });
  });

  it("wraps default Windows CLI lookup through cmd.exe", () => {
    expect(getGeminiLaunchSpec("gemini", "win32", "C:\\Windows\\System32\\cmd.exe")).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "gemini --acp"],
    });
  });

  it("quotes Windows shim paths that contain spaces", () => {
    expect(
      getGeminiLaunchSpec("C:\\Program Files\\Gemini CLI\\gemini.cmd", "win32", "cmd.exe"),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\Program Files\\Gemini CLI\\gemini.cmd" --acp'],
    });
  });

  it("spawns native executables directly on Windows", () => {
    expect(getGeminiLaunchSpec("C:\\Tools\\gemini.exe", "win32", "cmd.exe")).toEqual({
      command: "C:\\Tools\\gemini.exe",
      args: ["--acp"],
    });
  });
});

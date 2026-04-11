import { describe, expect, it } from "vitest";

import { getgeminiLaunchSpec } from "../pi-extensions/gemini-acp";

describe("getgeminiLaunchSpec", () => {
  it("spawns Gemini directly on unix-like platforms", () => {
    expect(getgeminiLaunchSpec("gemini", "linux")).toEqual({
      command: "gemini",
      args: ["--acp"],
    });
  });

  it("wraps default Windows CLI lookup through cmd.exe", () => {
    expect(getgeminiLaunchSpec("gemini", "win32", "C:\\Windows\\System32\\cmd.exe")).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "gemini --acp"],
    });
  });

  it("quotes Windows shim paths that contain spaces", () => {
    expect(
      getgeminiLaunchSpec("C:\\Program Files\\Gemini CLI\\gemini.cmd", "win32", "cmd.exe"),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\Program Files\\Gemini CLI\\gemini.cmd" --acp'],
    });
  });

  it("spawns native executables directly on Windows", () => {
    expect(getgeminiLaunchSpec("C:\\Tools\\gemini.exe", "win32", "cmd.exe")).toEqual({
      command: "C:\\Tools\\gemini.exe",
      args: ["--acp"],
    });
  });
});

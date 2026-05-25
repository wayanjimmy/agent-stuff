import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let previousSessionFile: string | undefined;

  // Capture the previous session file when a new session is created
  // via /new, /resume, or /fork
  pi.on("session_start", async (event) => {
    if (event.reason === "new" || event.reason === "resume" || event.reason === "fork") {
      previousSessionFile = event.previousSessionFile;
    }
  });

  pi.registerCommand("prev", {
    description: "Insert prompt to read the previous session via xurl",
    handler: async (_args, ctx) => {
      let sessionFile = previousSessionFile;

      // Fallback: find most recent session (excluding current)
      if (!sessionFile) {
        const sessions = await SessionManager.list(ctx.cwd);
        const currentFile = ctx.sessionManager.getSessionFile();
        const prev = sessions.find((s) => s.path !== currentFile);
        if (prev) {
          sessionFile = prev.path;
        }
      }

      if (!sessionFile) {
        ctx.ui.notify("No previous session found", "error");
        return;
      }

      // Resolve the UUID from the session header (fast, reads first line only)
      let uuid: string;
      try {
        const { open } = await import("node:fs/promises");
        const fileHandle = await open(sessionFile, "r");
        const { bytesRead, buffer } = await fileHandle.read({
          buffer: Buffer.alloc(4096),
          offset: 0,
          length: 4096,
          position: 0,
        });
        await fileHandle.close();

        const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
        const header = JSON.parse(firstLine);
        uuid = header.id;
      } catch {
        ctx.ui.notify("Failed to read previous session", "error");
        return;
      }

      const prompt = `Read the conversation at \`xurl pi/${uuid}\` using xurl and summarize what I was working on`;

      ctx.ui.setEditorText(prompt);
    },
  });
}
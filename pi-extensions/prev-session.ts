import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, SessionManager } from "@earendil-works/pi-coding-agent";

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
      const prompt = await ctx.ui.custom<string>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "Finding previous session...");
        loader.onAbort = () => done("");

        const findPrompt = async () => {
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
            return "";
          }

          // Resolve the UUID from the session header (fast, reads first line only)
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
            return `Read the conversation at \`xurl pi/${header.id}\` using xurl and summarize what I was working on`;
          } catch {
            return "";
          }
        };

        findPrompt()
          .then(done)
          .catch(() => done(""));

        return loader;
      });

      if (!prompt) {
        ctx.ui.notify("No previous session found", "error");
        return;
      }

      ctx.ui.setEditorText(prompt);
    },
  });
}
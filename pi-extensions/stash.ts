import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

/**
 * Stash extension for Pi.
 * Allows users to stash editor content and have it restored after the next prompt is processed.
 *
 * Usage:
 * - Type `/stash` at the end of your prompt to auto-stash
 * - Or run the `/stash` command directly
 */
export default function (pi: ExtensionAPI): void {
  let stashedText: string | null = null;
  let pendingRestore: string | null = null;
  let isRestoreInProgress = false;

  /**
   * Stashes the current editor content.
   * Warns if there's already stashed content.
   */
  async function stashContent(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI) {
      console.log("[stash] Cannot stash: no UI available");
      return;
    }

    let text = ctx.ui.getEditorText();

    if (!text || text.trim().length === 0) {
      ctx.ui.notify("Nothing to stash", "warning");
      return;
    }

    // Strip trailing /stash command if present
    text = text.replace(/\s*\/stash\s*$/i, "");

    if (!text || text.trim().length === 0) {
      ctx.ui.notify("Nothing to stash after removing command", "warning");
      return;
    }

    // Warn if overwriting existing stash
    if (stashedText !== null) {
      ctx.ui.notify("Overwriting previous stash!", "warning");
    }

    stashedText = text;

    ctx.ui.setEditorText("");
    ctx.ui.notify("Stashed! Will restore to editor after next prompt", "info");
  }

  pi.registerCommand("stash", {
    description: "Stash current editor content (restores to editor after next prompt)",
    handler: stashContent,
  });

  pi.on("input", async (event, ctx) => {
    // 1. Auto-stash if text ends with /stash
    const stashMatch = event.text.match(/\s*\/stash\s*$/i);
    if (stashMatch) {
      const textToStash = event.text.replace(/\s*\/stash\s*$/i, "").trim();

      if (!textToStash) {
        if (ctx.hasUI) {
          ctx.ui.notify("Nothing to stash", "warning");
        } else {
          console.log("[stash] Nothing to stash");
        }
        return { action: "handled" };
      }

      // Warn if overwriting existing stash
      if (stashedText !== null && ctx.hasUI) {
        ctx.ui.notify("Overwriting previous stash!", "warning");
      }

      stashedText = textToStash;

      if (ctx.hasUI) {
        ctx.ui.setEditorText("");
        ctx.ui.notify("Stashed! Will restore to editor after next prompt", "info");
      } else {
        console.log("[stash] Content stashed (no UI)");
      }

      return { action: "handled" };
    }

    // 2. If we have stashed content, mark it for restoration AFTER this prompt is sent
    // But only if we're not already waiting for a restore (prevents race condition with rapid prompts)
    if (stashedText && !isRestoreInProgress) {
      pendingRestore = stashedText;
      stashedText = null;
      isRestoreInProgress = true;
    }

    // 3. Default: continue without modification (send the prompt as-is)
    return { action: "continue" };
  });

  /**
   * After agent finishes, restore stashed content to the editor.
   * Adds two newlines after restored content for better readability.
   */
  pi.on("agent_end", async (_event, ctx) => {
    if (pendingRestore && ctx.hasUI) {
      const restore = pendingRestore;
      pendingRestore = null;
      isRestoreInProgress = false;

      // Restore content with trailing newlines for readability
      ctx.ui.setEditorText(restore + "\n\n");
      ctx.ui.notify("Stashed content restored to editor!", "info");
    } else if (pendingRestore) {
      // No UI available, just clean up state
      pendingRestore = null;
      isRestoreInProgress = false;
    }
  });
}

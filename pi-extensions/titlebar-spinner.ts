/** Animate the terminal title until Pi has fully settled. */
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frameIndex = 0;

  function baseTitle(ctx: ExtensionContext): string {
    const cwd = path.basename(ctx.cwd);
    const session = pi.getSessionName();
    return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
  }

  function stopAnimation(ctx: ExtensionContext) {
    clearInterval(timer);
    timer = undefined;
    frameIndex = 0;
    if (ctx.mode === "tui") ctx.ui.setTitle(baseTitle(ctx));
  }

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || timer) return;
    const tick = () => {
      const frame = BRAILLE_FRAMES[frameIndex++ % BRAILLE_FRAMES.length];
      ctx.ui.setTitle(`${frame} ${baseTitle(ctx)}`);
    };
    tick();
    timer = setInterval(tick, 80);
  });

  pi.on("agent_settled", (_event, ctx) => stopAnimation(ctx));
  pi.on("session_shutdown", (_event, ctx) => stopAnimation(ctx));
  pi.on("session_start", (_event, ctx) => stopAnimation(ctx));
  pi.on("session_info_changed", (_event, ctx) => {
    if (ctx.mode === "tui" && !timer) ctx.ui.setTitle(baseTitle(ctx));
  });
}

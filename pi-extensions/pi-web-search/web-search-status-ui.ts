import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERLAY_WIDTH = 70;

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function sgr(code: string, text: string): string {
  if (!code) {
    return text;
  }
  return `\u001B[${code}m${text}\u001B[0m`;
}

function bold(text: string): string {
  return `\u001B[1m${text}\u001B[22m`;
}

function italic(text: string): string {
  return `\u001B[3m${text}\u001B[23m`;
}

function dim(text: string): string {
  return `\u001B[2m${text}\u001B[22m`;
}

function success(text: string): string {
  return sgr("32", text); // green
}

function warning(text: string): string {
  return sgr("33", text); // yellow
}

function error(text: string): string {
  return sgr("31", text); // red
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderUsageBar(used: number, total: number, width: number = 20): string {
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const filled = Math.max(0, Math.round((percent / 100) * width));
  const empty = width - filled;

  // Color-code the bar based on usage level
  let bar: string;
  if (percent >= 90) {
    // Red for high usage (danger zone)
    bar = `${sgr("31", "█".repeat(filled))}${dim("░".repeat(empty))}`;
  } else if (percent >= 70) {
    // Yellow for medium-high usage (warning)
    bar = `${sgr("33", "█".repeat(filled))}${dim("░".repeat(empty))}`;
  } else {
    // Green for normal usage
    bar = `${sgr("32", "█".repeat(filled))}${dim("░".repeat(empty))}`;
  }

  return bar;
}

function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

function makeRow(innerW: number): (content: string) => string {
  return (content: string): string =>
    `${dim("│")}${truncateToWidth(` ${content}`, innerW, "…", true)}${dim("│")}`;
}

function makeEmptyRow(innerW: number): () => string {
  return (): string => `${dim("│")}${" ".repeat(innerW)}${dim("│")}`;
}

function makeDivider(innerW: number): () => string {
  return (): string => dim(`├${"─".repeat(innerW)}┤`);
}

function makeCenterRow(innerW: number): (content: string) => string {
  return (content: string): string => {
    const vis = visibleWidth(content);
    const padding = Math.max(0, innerW - vis);
    const left = Math.floor(padding / 2);
    return `${dim("│")}${" ".repeat(left)}${content}${" ".repeat(padding - left)}${dim("│")}`;
  };
}

// ---------------------------------------------------------------------------
// Key display data
// ---------------------------------------------------------------------------

export interface KeyDisplay {
  available: boolean;
  maskedKey: string;
  requestsMade: number;
  rateLimitRemaining?: number;
  rateLimitTotal?: number;
  inCooldown: boolean;
  cooldownRemainingMs?: number;
  failureCount: number;
  plan?: string;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// StatusOverlay component
// ---------------------------------------------------------------------------

class StatusOverlay {
  keys: KeyDisplay[];
  available: number;
  total: number;
  private done: (value: null) => void;

  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(keys: KeyDisplay[], available: number, total: number, done: (value: null) => void) {
    this.keys = keys;
    this.available = available;
    this.total = total;
    this.done = done;
  }

  // -----------------------------------------------------------------------
  // Input handling
  // -----------------------------------------------------------------------

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done(null);
    }
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const w = Math.min(width, OVERLAY_WIDTH);
    const innerW = w - 2;
    const row = makeRow(innerW);
    const emptyRow = makeEmptyRow(innerW);
    const divider = makeDivider(innerW);
    const centerRow = makeCenterRow(innerW);

    const lines: string[] = [this.renderTitleBorder(innerW), emptyRow()];

    // Summary line
    const summaryColor =
      this.available === 0 ? error : this.available < this.total ? warning : success;
    const summaryText = `${this.available}/${this.total} keys available`;
    lines.push(row(summaryColor(summaryText)));
    lines.push(emptyRow());
    lines.push(divider());
    lines.push(emptyRow());

    // Each key
    this.keys.forEach((key, index) => {
      // Key label with limit info
      let keyLabel = `Key ${index + 1}: ${bold(key.maskedKey)}`;
      if (key.rateLimitTotal && key.rateLimitTotal > 0) {
        keyLabel += dim(` · ${fmt(key.rateLimitTotal)} req/month limit`);
      } else if (key.requestsMade > 0) {
        keyLabel += dim(` · ~1,000 req/month (est.)`);
      } else if (key.plan) {
        keyLabel += ` ${dim(`(${key.plan})`)}`;
      }
      lines.push(row(keyLabel));

      // Progress bar and usage stats
      let usageLine = "";
      const hasRateLimitData =
        key.rateLimitRemaining !== undefined &&
        key.rateLimitTotal !== undefined &&
        key.rateLimitTotal > 0;
      const hasRequestData = key.requestsMade > 0;
      const isLoading = key.isLoading;

      if (isLoading) {
        // Loading state - show spinner icon only
        const barWidth = Math.max(10, innerW - 5);
        const bar = dim("░".repeat(barWidth));
        usageLine = `${bar} ⏳`;
      } else if (hasRateLimitData) {
        // Real rate limit data from API headers
        const used = key.rateLimitTotal - key.rateLimitRemaining;
        const remaining = key.rateLimitRemaining;
        const pct = Math.round((used / key.rateLimitTotal) * 100);
        const barWidth = Math.max(10, innerW - 30); // Leave space for stats text
        const bar = renderUsageBar(used, key.rateLimitTotal, barWidth);

        // Color-code the percentage
        let pctStr: string;
        if (pct >= 90) pctStr = error(`${pct}%`);
        else if (pct >= 70) pctStr = warning(`${pct}%`);
        else pctStr = success(`${pct}%`);

        usageLine = `${bar} ${pctStr} ${dim(`(${fmt(remaining)} left)`)}`;
      } else if (hasRequestData) {
        // Estimate based on default 1000 limit and requests made
        const estimatedTotal = 1000;
        const used = key.requestsMade;
        const remaining = Math.max(0, estimatedTotal - used);
        const pct = Math.round((used / estimatedTotal) * 100);
        const barWidth = Math.max(10, innerW - 30);
        const bar = renderUsageBar(used, estimatedTotal, barWidth);

        // Color-code the percentage
        let pctStr: string;
        if (pct >= 90) pctStr = error(`${pct}%`);
        else if (pct >= 70) pctStr = warning(`${pct}%`);
        else pctStr = success(`${pct}%`);

        usageLine = `${bar} ${pctStr} ${dim(`(~${fmt(remaining)} est. left)`)}`;
      } else {
        // No data at all
        const barWidth = Math.max(10, innerW - 20);
        const bar = dim("░".repeat(barWidth));
        usageLine = `${bar} ${dim("No usage data")}`;
      }
      lines.push(row(usageLine));

      // Status line
      let statusLine = "";
      if (key.inCooldown && key.cooldownRemainingMs) {
        const remaining = formatDuration(key.cooldownRemainingMs);
        statusLine = warning(`⏸ Cooldown (${remaining} left)`);
        if (key.failureCount > 0) {
          statusLine += dim(` · ${key.failureCount} failure${key.failureCount === 1 ? "" : "s"}`);
        }
      } else if (key.failureCount >= 3) {
        statusLine = error(`✗ Disabled (${key.failureCount} failures)`);
      } else {
        statusLine = success(`✓ Active`);
        if (key.failureCount > 0) {
          statusLine += dim(` · ${key.failureCount} failure${key.failureCount === 1 ? "" : "s"}`);
        }
      }
      lines.push(row(statusLine));

      // Spacer between keys (except after last)
      if (index < this.keys.length - 1) {
        lines.push(emptyRow());
      }
    });

    // Footer
    lines.push(emptyRow());
    lines.push(divider());
    lines.push(emptyRow());
    lines.push(centerRow(dim(italic("Press ESC to close, R to refresh"))));
    lines.push(dim(`╰${"─".repeat(innerW)}╯`));

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  private renderTitleBorder(innerW: number): string {
    const titleText = " Web Search API Keys ";
    const borderLen = innerW - visibleWidth(titleText);
    const leftBorder = Math.floor(borderLen / 2);
    const rightBorder = borderLen - leftBorder;
    return dim(`╭${"─".repeat(leftBorder)}${titleText}${"─".repeat(rightBorder)}╮`);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StatusWidgetCallbacks {
  onRefresh?: () => void;
}

export interface StatusWidgetHandle {
  updateKeys: (newKeys: KeyDisplay[]) => void;
  waitForClose: () => Promise<void>;
}

export function showStatusWidget(
  keys: KeyDisplay[],
  available: number,
  total: number,
  ctx: ExtensionCommandContext,
  callbacks?: StatusWidgetCallbacks,
): StatusWidgetHandle {
  // Shared state that both the custom UI and the returned handle can access
  const state = {
    keys,
    available,
    total,
    overlay: null as StatusOverlay | null,
    tui: null as any,
  };

  // Create the custom UI - store the promise so we can await it later
  const uiPromise = ctx.ui.custom<null>(
    (tui, _theme, _kb, done) => {
      state.tui = tui;
      state.overlay = new StatusOverlay(state.keys, state.available, state.total, done);
      return {
        render: (width: number) => state.overlay!.render(width),
        invalidate: () => state.overlay!.invalidate(),
        handleInput: (data: string) => {
          if (matchesKey(data, "r") && callbacks?.onRefresh) {
            callbacks.onRefresh();
          }
          state.overlay!.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { anchor: "top-center", width: OVERLAY_WIDTH },
    },
  );

  return {
    updateKeys: (newKeys: KeyDisplay[]) => {
      state.keys = newKeys;
      state.available = newKeys.filter((k) => k.available).length;
      if (state.overlay) {
        state.overlay.keys = newKeys;
        state.overlay.available = state.available;
        state.overlay.invalidate();
      }
      state.tui?.requestRender();
    },
    waitForClose: () => uiPromise.then(() => {}),
  };
}

/**
 * Renders a compact status line for inline display (e.g., in notifications)
 */
export function renderCompactStatus(available: number, total: number): string {
  const icon = available === 0 ? error("✗") : available < total ? warning("⚠") : success("✓");
  return `${icon} Web Search: ${available}/${total} keys`;
}

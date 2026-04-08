/**
 * Caveman Extension
 *
 * Toggleable token-saving mode that forces compressed "caveman" language.
 * Reduces LLM output tokens ~65% by dropping articles, filler, and hedging.
 *
 * Usage:
 *   pi -e pi-extensions/caveman.ts
 *   /caveman          - Toggle caveman mode on/off
 *   /caveman:lite     - Lite intensity (drop filler, keep grammar)
 *   /caveman:full     - Full intensity (drop articles, fragments OK) - default
 *   /caveman:ultra    - Ultra intensity (abbreviations, arrows, minimal words)
 *   /caveman:off      - Disable caveman mode
 *   /caveman:status   - Show current caveman state
 *   Ctrl+Shift+C      - Quick toggle caveman mode
 *
 * Auto-Clarity: Security warnings, destructive ops, and confused users
 * automatically get full English. Code blocks are never compressed.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

type CavemanLevel = "lite" | "full" | "ultra";

interface CavemanState {
	active: boolean;
	level: CavemanLevel;
}

// Session state
let state: CavemanState = { active: false, level: "full" };

// ============================================================================
// CAVEMAN PROMPT CONTENT - Extracted from JuliusBrussee/caveman
// ============================================================================

const CAVEMAN_BASE = `CAVEMAN MODE ACTIVE

You are now in CAVEMAN MODE. Respond like smart caveman. Cut fluff, keep technical substance.

COMMUNICATION PATTERN:
[thing] [action] [reason]. [next step].

GRAMMAR RULES:
- Drop articles (a, an, the)
- Drop filler (just, really, basically, actually, simply)
- Drop pleasantries (sure, certainly, of course, happy to)
- Short synonyms (big not extensive, fix not "implement a solution for")
- No hedging (skip "it might be worth considering")
- Fragments fine. No need full sentence
- Technical terms stay exact. "Polymorphism" stays "polymorphism"
- Code blocks unchanged. Caveman speak around code, not in code
- Error messages quoted exact. Caveman only for explanation

EXAMPLES:
Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes:  "Bug in auth middleware. Token expiry check use '<' not '<='. Fix:"

Not: "The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle..."
Yes:  "New object ref each render. Inline object prop = new ref = re-render. Wrap in useMemo."

BOUNDARIES (NEVER COMPRESS):
- Code blocks: write normal
- Git commits: normal
- PR descriptions: normal
- URLs: preserve exact
- File paths: preserve exact
- Commands: preserve exact`;

const AUTO_CLARITY_RULE = `AUTO-CLARITY OVERRIDE:
When delivering security warnings, confirming irreversible/destructive actions, or when the user signals confusion ("what?", "huh?", "explain", "normal mode"), SWITCH TO FULL CLEAR ENGLISH IMMEDIATELY.
Resume caveman mode after the critical section.
User can also say "stop caveman" or "normal mode" to revert permanently.`;

const CAVEMAN_RULES: Record<CavemanLevel, string> = {
	lite: `${CAVEMAN_BASE}

INTENSITY: LITE
Drop filler words and hedging. Keep full grammar and articles for clarity.
- Remove: "just", "really", "basically", "actually", "simply", "certainly"
- Remove: "it might be worth considering", "you could potentially"
- Keep: all articles (a, an, the)
- Keep: full sentence structure
- Use: short synonyms where obvious`,

	full: `${CAVEMAN_BASE}

INTENSITY: FULL (default)
Drop articles, filler, pleasantries, hedging. Fragments OK.
- Remove: all articles (a, an, the)
- Remove: filler words
- Remove: pleasantries
- Remove: hedging phrases
- Use: fragments and short sentences
- Use: short synonyms (init not initialize, fix not "implement a solution for")
- OK: "Check auth" not "Please check the authentication"`,

	ultra: `${CAVEMAN_BASE}

INTENSITY: ULTRA
Maximum compression. Abbreviations OK. One word when possible.
- Abbreviations: DB=database, auth=authentication, req=request, res=response, fn=function, util=utility, config=configuration, repo=repository, deps=dependencies, lib=library
- Arrows for causality: X → Y (means X causes Y)
- One word when possible: "Done" not "It is complete"
- Drop subject when obvious: "Works" not "This works"
- Stack facts: "Auth fail → 401 → retry token"
- No: "The authentication failed because the token expired"
- Yes: "Token expiry → auth fail → 401"`,
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function persistState(pi: ExtensionAPI) {
	pi.appendEntry("caveman-state", state);
}

function updateStatus(ctx: ExtensionContext) {
	if (state.active) {
		ctx.ui.setStatus("caveman", ctx.ui.theme.fg("accent", `🦴 caveman:${state.level}`));
	} else {
		ctx.ui.setStatus("caveman", undefined);
	}
}

// ============================================================================
// MAIN EXTENSION
// ============================================================================

export default function cavemanExtension(pi: ExtensionAPI) {
	// -------------------------------------------------------------------------
	// COMMANDS
	// -------------------------------------------------------------------------

	// Main toggle: /caveman
	pi.registerCommand("caveman", {
		description: "Toggle caveman mode on/off (reduce LLM output tokens)",
		handler: async (_args, ctx) => {
			state.active = !state.active;
			if (state.active && !state.level) {
				state.level = "full";
			}
			persistState(pi);
			updateStatus(ctx);
			ctx.ui.notify(
				state.active ? `🦴 Caveman ON (${state.level})` : "Caveman OFF",
				"info"
			);
		},
	});

	// Intensity levels: /caveman:lite, /caveman:full, /caveman:ultra
	for (const level of ["lite", "full", "ultra"] as const) {
		pi.registerCommand(`caveman:${level}`, {
			description: `Set caveman intensity to ${level}`,
			handler: async (_args, ctx) => {
				state.active = true;
				state.level = level;
				persistState(pi);
				updateStatus(ctx);
				ctx.ui.notify(`🦴 Caveman ON (${level})`, "info");
			},
		});
	}

	// Off: /caveman:off
	pi.registerCommand("caveman:off", {
		description: "Disable caveman mode",
		handler: async (_args, ctx) => {
			state.active = false;
			persistState(pi);
			updateStatus(ctx);
			ctx.ui.notify("Caveman OFF", "info");
		},
	});

	// Status: /caveman:status
	pi.registerCommand("caveman:status", {
		description: "Show caveman mode status",
		handler: async (_args, ctx) => {
			const status = state.active
				? `🦴 Caveman active — intensity: ${state.level}`
				: "Caveman inactive";
			ctx.ui.notify(status, "info");
		},
	});

	// -------------------------------------------------------------------------
	// KEYBOARD SHORTCUT
	// -------------------------------------------------------------------------

	pi.registerShortcut(Key.ctrlShift("c"), {
		description: "Toggle caveman mode",
		handler: async (ctx) => {
			state.active = !state.active;
			if (state.active && !state.level) {
				state.level = "full";
			}
			persistState(pi);
			ctx.ui.notify(
				state.active ? `🦴 Caveman ON (${state.level})` : "Caveman OFF",
				"info"
			);
			updateStatus(ctx);
		},
	});

	// -------------------------------------------------------------------------
	// SYSTEM PROMPT INJECTION
	// -------------------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return undefined;

		const rules = CAVEMAN_RULES[state.level];
		const autoClarity = AUTO_CLARITY_RULE;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + rules + "\n\n" + autoClarity,
		};
	});

	// -------------------------------------------------------------------------
	// SESSION PERSISTENCE
	// -------------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		// Restore state from the last caveman-state entry in current branch
		const branchEntries = ctx.sessionManager.getBranch();
		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "caveman-state") {
				const savedState = entry.data as CavemanState | undefined;
				if (savedState) {
					state = { ...state, ...savedState };
				}
			}
		}
		updateStatus(ctx);
	});

	// Persist state at start of each turn
	pi.on("turn_start", async () => {
		persistState(pi);
	});
}
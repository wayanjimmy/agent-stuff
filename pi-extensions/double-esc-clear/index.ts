/**
 * Double Esc to Clear Prompt
 *
 * Extension that adds "Double Esc to clear prompt input" feature to pi:
 * - First Esc press (when input has text): Shows hint "Esc again to clear"
 * - Second Esc press: Clears the entire prompt input
 * - Any other key: Resets the pending state
 * - If input is empty, Esc passes through for abort/cancel behavior
 *
 * Usage: pi --extension ./index.ts
 */

import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

class DoubleEscEditor extends CustomEditor {
	private pendingClear = false;
	private clearTimeout?: ReturnType<typeof setTimeout>;
	private readonly CLEAR_TIMEOUT_MS = 2000;

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			// Second Esc with pending state - clear the input
			if (this.pendingClear) {
				this.setText("");
				this.pendingClear = false;
				clearTimeout(this.clearTimeout);
				this.tui.requestRender();
				return;
			}

			// First Esc - only intercept if there's text to clear
			// If empty, pass through to super for abort/cancel behavior
			if (this.getText().length > 0) {
				this.pendingClear = true;
				this.clearTimeout = setTimeout(() => {
					this.pendingClear = false;
					this.tui.requestRender();
				}, this.CLEAR_TIMEOUT_MS);
				return;
			}
		}

		// Any other key resets pending state
		if (this.pendingClear) {
			this.pendingClear = false;
			clearTimeout(this.clearTimeout);
			this.tui.requestRender();
		}

		super.handleInput(data);
	}

	render(width: number): string[] {
		const lines = super.render(width);

		if (this.pendingClear && lines.length > 0) {
			const hint = "\x1b[34mEsc\x1b[0m again to clear ";
			const hintVisibleWidth = visibleWidth(hint);
			const last = lines.length - 1;
			const lineWidth = visibleWidth(lines[last]!);
			const padding = Math.max(0, width - hintVisibleWidth - lineWidth);
			lines[last] = hint + " ".repeat(padding) + truncateToWidth(lines[last]!, width - hintVisibleWidth, "");
		}

		return lines;
	}

	dispose(): void {
		clearTimeout(this.clearTimeout);
		super.dispose?.();
	}
}

export default function(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new DoubleEscEditor(tui, theme, keybindings)
		);
	});
}

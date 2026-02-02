import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const KIMI_BANNER = `▐█▛█▛█▌
▐█████▌`;

const DODGER_BLUE1 = '\x1b[38;2;30;144;255m';
const RESET = '\x1b[0m';

/**
 * Kimi welcome extension for Pi.
 * Displays a welcome banner on startup.
 */
export default function (pi: ExtensionAPI): void {
	console.log(`${DODGER_BLUE1}${KIMI_BANNER}${RESET}`);
}

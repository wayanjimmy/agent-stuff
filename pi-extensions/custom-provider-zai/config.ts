import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";

export const ZAI_BASE_URL_DEFAULT = "https://api.z.ai/api/coding/paas/v4";
export const DEFAULT_TEMPERATURE = 0.9;
export const DEFAULT_TOP_P = 0.95;
export const DEFAULT_CLEAR_THINKING = false;

const API_KEY_ENV_PLACEHOLDER = "PI_ZAI_API_KEY";

export interface ZaiRuntimeSettings {
	temperature: number;
	topP: number;
	clearThinking: boolean;
}

export interface ZaiSimpleOptions {
	temperature?: number;
	top_p?: number;
	topP?: number;
	clear_thinking?: boolean;
	clearThinking?: boolean;
	apiKey?: string;
	onPayload?: (payload: unknown) => void;
	[key: string]: unknown;
}

export type ZaiStreamSimple = (
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ZaiProviderConfigInput {
	streamSimple: ZaiStreamSimple;
}

export interface ZaiProviderModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	input: ["text"];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
	compat: {
		supportsDeveloperRole: false;
		thinkingFormat: "zai";
	};
	baseUrl: string;
	apiKey: string;
}

export interface ZaiProviderConfig {
	baseUrl: string;
	apiKey: string;
	api: "openai-completions";
	streamSimple: ZaiStreamSimple;
	models: ZaiProviderModelConfig[];
}

const GLM_4_7_ZAI_MODEL: Omit<ZaiProviderModelConfig, "baseUrl" | "apiKey"> = {
	id: "glm-4.7-oai",
	name: "GLM 4.7 ZAI",
	reasoning: true,
	input: ["text"],
	cost: {
		input: 0.6,
		output: 2.2,
		cacheRead: 0.11,
		cacheWrite: 0,
	},
	contextWindow: 204800,
	maxTokens: 131072,
	compat: {
		supportsDeveloperRole: false,
		thinkingFormat: "zai",
	},
};

function parseOptionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		const parsed = Number.parseFloat(trimmed);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
		if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
	}
	return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveZaiBaseUrl(
	env: Record<string, string | undefined>,
): string {
	return parseOptionalString(env.PI_ZAI_BASE_URL) ?? ZAI_BASE_URL_DEFAULT;
}

export function resolveZaiApiKey(
	env: Record<string, string | undefined>,
): string | undefined {
	return parseOptionalString(env.PI_ZAI_API_KEY);
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
	for (const value of values) {
		if (value !== undefined) return value;
	}
	return undefined;
}

function resolveNumberKnob(
	defaultValue: number,
	...optionValues: unknown[]
): number {
	return firstDefined(...optionValues.map((value) => parseOptionalNumber(value))) ?? defaultValue;
}

function resolveBooleanKnob(
	defaultValue: boolean,
	...optionValues: unknown[]
): boolean {
	return firstDefined(...optionValues.map((value) => parseOptionalBoolean(value))) ?? defaultValue;
}

/**
 * ZAI runtime settings resolution.
 * Priority: explicit options > environment variables > defaults
 */
export function resolveZaiRuntimeSettings(
	env: Record<string, string | undefined> = process.env,
	options?: ZaiSimpleOptions,
): ZaiRuntimeSettings {
	const temperature = resolveNumberKnob(
		DEFAULT_TEMPERATURE,
		options?.temperature,
		env.PI_TEMPERATURE,
	);
	const topP = resolveNumberKnob(
		DEFAULT_TOP_P,
		options?.top_p,
		options?.topP,
		env.PI_ZAI_CUSTOM_TOP_P,
	);
	const clearThinking = resolveBooleanKnob(
		DEFAULT_CLEAR_THINKING,
		options?.clear_thinking,
		options?.clearThinking,
		env.PI_ZAI_CUSTOM_CLEAR_THINKING,
	);

	return { temperature, topP, clearThinking };
}

function resolveModels(
	env: Record<string, string | undefined>,
): ZaiProviderModelConfig[] {
	const apiKey = resolveZaiApiKey(env);
	if (!apiKey) return [];

	return [
		{
			...GLM_4_7_ZAI_MODEL,
			baseUrl: resolveZaiBaseUrl(env),
			apiKey,
		},
	];
}

/**
 * Apply ZAI-specific knobs to the request payload.
 * Every request must carry explicit sampling/thinking knobs so provider defaults
 * cannot silently change behavior.
 */
export function applyZaiPayloadKnobs(
	payload: unknown,
	runtime: ZaiRuntimeSettings,
): void {
	if (!payload || typeof payload !== "object") return;
	const request = payload as Record<string, unknown>;
	request.temperature = runtime.temperature;
	request.top_p = runtime.topP;
	request.clear_thinking = runtime.clearThinking;
}

/**
 * Create a ZAI stream simple wrapper that:
 * 1. Injects runtime settings (temperature, top_p, clear_thinking) into every request
 * 2. Ensures the API key is properly passed through
 */
export function createZaiStreamSimple(
	baseStreamSimple: ZaiStreamSimple,
	env: Record<string, string | undefined> = process.env,
): ZaiStreamSimple {
	return (model, context, options) => {
		const runtime = resolveZaiRuntimeSettings(env, options);
		const callerOnPayload = options?.onPayload;

		const wrappedOptions: SimpleStreamOptions = {
			...options,
			apiKey: resolveZaiApiKey(env) ?? options?.apiKey,
			temperature: runtime.temperature,
			onPayload: (payload: unknown) => {
				// Apply knobs before calling the original handler so logs show the final payload
				applyZaiPayloadKnobs(payload, runtime);
				callerOnPayload?.(payload);
			},
		};
		return baseStreamSimple(model, context, wrappedOptions);
	};
}

export function buildZaiProviderConfig(
	input: ZaiProviderConfigInput,
	env: Record<string, string | undefined> = process.env,
): ZaiProviderConfig {
	const apiKey = resolveZaiApiKey(env) ?? API_KEY_ENV_PLACEHOLDER;

	return {
		baseUrl: resolveZaiBaseUrl(env),
		apiKey,
		api: "openai-completions",
		streamSimple: input.streamSimple,
		models: resolveModels(env),
	};
}

import {
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildZaiProviderConfig, createZaiStreamSimple } from "./config.js";

type PiStreamSimple = (
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

function streamSimpleViaOpenAICompletions(
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	return streamSimpleOpenAICompletions(model, context, options);
}

export default function zaiCustomExtension(pi: ExtensionAPI): void {
	const streamSimple = createZaiStreamSimple(
		streamSimpleViaOpenAICompletions,
	) as PiStreamSimple;

	pi.registerProvider("zai-custom", buildZaiProviderConfig({ streamSimple }));
}

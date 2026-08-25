/**
 * xAI Responses compaction workaround for Pi 0.84.3.
 *
 * Default Pi summarization sets toolChoice: "none" with no tools, which xAI
 * rejects. This extension summarizes with ctx.modelRegistry.complete() and no
 * toolChoice, then returns Pi compaction/summary text. Non-xAI models are left
 * to Pi's default path.
 *
 * Standalone: do not import web_search.ts or x_search.ts.
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	convertToLlm,
	serializeConversation,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";

const MAX_OUTPUT_TOKENS = 8_192;
const DEFAULT_RESERVE_TOKENS = 16_384;
const MACHINE_SUMMARY_CHARS = 12_000;

const SUMMARIZATION_INSTRUCTIONS = `You are a context summarization assistant. Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.

The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_INSTRUCTIONS = `You are a context summarization assistant. Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.

The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_NOTE =
	"The conversation includes the prefix of a split turn. The suffix of that turn is kept outside this summary.";

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_INSTRUCTIONS = `You are a context summarization assistant. Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.

Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

type XaiResponsesModel = {
	provider: "xai";
	api: "openai-responses";
	maxTokens?: number;
};

type FileOpSets = {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
};

type FileLists = {
	readFiles: string[];
	modifiedFiles: string[];
};

type SummarizeSuccess = {
	kind: "text";
	text: string;
	usage?: unknown;
};

type SummarizeOutcome =
	| SummarizeSuccess
	| { kind: "aborted" }
	| { kind: "failed"; reason: "empty" | "toolCall" | "provider" };

function isXaiResponsesModel(model: ExtensionContext["model"]): model is XaiResponsesModel {
	return model?.provider === "xai" && model.api === "openai-responses";
}

function resolveMaxTokens(reserveTokens: number | undefined, modelMaxTokens: number | undefined): number {
	const reserve =
		typeof reserveTokens === "number" && Number.isFinite(reserveTokens) && reserveTokens > 0
			? reserveTokens
			: DEFAULT_RESERVE_TOKENS;
	const fromReserve = Math.max(1, Math.floor(0.8 * reserve));
	const modelCap =
		typeof modelMaxTokens === "number" && Number.isFinite(modelMaxTokens) && modelMaxTokens > 0
			? modelMaxTokens
			: MAX_OUTPUT_TOKENS;
	return Math.min(MAX_OUTPUT_TOKENS, fromReserve, modelCap);
}

function addPath(target: Set<string>, value: unknown): void {
	if (typeof value === "string" && value.length > 0) {
		target.add(value);
	}
}

function computeFileLists(fileOps: FileOpSets): FileLists {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readFiles = [...fileOps.read].filter((file) => !modified.has(file)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles, modifiedFiles };
}

function iterableStrings(value: unknown): Iterable<unknown> | undefined {
	if (value == null) {
		return undefined;
	}
	if (typeof value === "string") {
		return undefined;
	}
	if (typeof value === "object" && Symbol.iterator in value) {
		return value as Iterable<unknown>;
	}
	return undefined;
}

function collectPaths(target: Set<string>, value: unknown): void {
	const items = iterableStrings(value);
	if (!items) {
		return;
	}
	for (const item of items) {
		addPath(target, item);
	}
}

function fileListsFromFileOps(fileOps: unknown): FileLists {
	const sets: FileOpSets = {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
	if (fileOps && typeof fileOps === "object") {
		const ops = fileOps as { read?: unknown; written?: unknown; edited?: unknown };
		collectPaths(sets.read, ops.read);
		collectPaths(sets.written, ops.written);
		collectPaths(sets.edited, ops.edited);
	}
	return computeFileLists(sets);
}

function collectFileOpsFromDetails(details: unknown, fileOps: FileOpSets): void {
	if (!details || typeof details !== "object") {
		return;
	}
	const record = details as { readFiles?: unknown; modifiedFiles?: unknown };
	if (Array.isArray(record.readFiles)) {
		for (const file of record.readFiles) {
			addPath(fileOps.read, file);
		}
	}
	if (Array.isArray(record.modifiedFiles)) {
		for (const file of record.modifiedFiles) {
			addPath(fileOps.edited, file);
		}
	}
}

function collectFileOpsFromMessages(messages: unknown[], fileOps: FileOpSets): void {
	for (const message of messages) {
		if (!message || typeof message !== "object") {
			continue;
		}
		if ((message as { role?: unknown }).role !== "assistant") {
			continue;
		}
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			if (!block || typeof block !== "object") {
				continue;
			}
			if ((block as { type?: unknown }).type !== "toolCall") {
				continue;
			}
			const name = (block as { name?: unknown }).name;
			const args = (block as { arguments?: unknown }).arguments;
			const path =
				args && typeof args === "object" ? (args as { path?: unknown }).path : undefined;
			if (name === "read") {
				addPath(fileOps.read, path);
			} else if (name === "write") {
				addPath(fileOps.written, path);
			} else if (name === "edit") {
				addPath(fileOps.edited, path);
			}
		}
	}
}

function fileListsFromTreeEntries(entries: SessionEntry[]): FileLists {
	const sets: FileOpSets = {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
	const messages: unknown[] = [];
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			collectFileOpsFromDetails(entry.details, sets);
		}
		messages.push(...sessionEntryToContextMessages(entry));
	}
	collectFileOpsFromMessages(messages, sets);
	return computeFileLists(sets);
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}
	if (sections.length === 0) {
		return "";
	}
	return `\n\n${sections.join("\n\n")}`;
}

function appendFileOperations(summary: string, fileLists: FileLists): string {
	return `${summary.trimEnd()}${formatFileOperations(fileLists.readFiles, fileLists.modifiedFiles)}`;
}

function serializeAgentMessages(messages: unknown[]): string {
	return serializeConversation(convertToLlm(messages as never));
}

function serializeTreeEntries(entries: SessionEntry[]): string {
	const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry));
	return serializeAgentMessages(messages);
}

function buildPromptText(options: {
	conversationText: string;
	instructions: string;
	previousSummary?: string;
	customInstructions?: string;
	replaceInstructions?: boolean;
	splitTurn?: boolean;
}): string {
	const parts: string[] = [`<conversation>\n${options.conversationText}\n</conversation>`];
	if (options.previousSummary) {
		parts.push(`<previous-summary>\n${options.previousSummary}\n</previous-summary>`);
	}
	if (options.splitTurn) {
		parts.push(TURN_PREFIX_NOTE);
	}
	if (options.replaceInstructions && options.customInstructions) {
		parts.push(options.customInstructions);
	} else {
		parts.push(options.instructions);
		if (options.customInstructions) {
			parts.push(`Additional focus: ${options.customInstructions}`);
		}
	}
	return parts.join("\n\n");
}

function extractSummaryText(content: unknown): { kind: "text"; text: string } | { kind: "toolCall" } | { kind: "empty" } {
	if (!Array.isArray(content)) {
		return { kind: "empty" };
	}
	let sawToolCall = false;
	const texts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}
		const type = (block as { type?: unknown }).type;
		if (type === "toolCall") {
			sawToolCall = true;
			continue;
		}
		if (type === "text" && typeof (block as { text?: unknown }).text === "string") {
			texts.push((block as { text: string }).text);
		}
	}
	if (sawToolCall) {
		return { kind: "toolCall" };
	}
	const text = texts.join("\n").trim();
	return text ? { kind: "text", text } : { kind: "empty" };
}

function isAbortError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const name = (error as { name?: unknown }).name;
	return name === "AbortError" || name === "TimeoutError";
}

async function summarizeWithModel(
	ctx: ExtensionContext,
	model: XaiResponsesModel,
	promptText: string,
	maxTokens: number,
	signal: AbortSignal,
): Promise<SummarizeOutcome> {
	if (signal.aborted) {
		return { kind: "aborted" };
	}

	const response = await ctx.modelRegistry.complete(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: promptText }],
					timestamp: Date.now(),
				},
			],
		},
		{
			maxTokens,
			signal,
			cacheRetention: "none",
			sessionId: uuidv7(),
		},
	);

	if (signal.aborted || response.stopReason === "aborted") {
		return { kind: "aborted" };
	}
	if (response.stopReason === "error") {
		return { kind: "failed", reason: "provider" };
	}

	const extracted = extractSummaryText(response.content);
	if (extracted.kind === "toolCall") {
		return { kind: "failed", reason: "toolCall" };
	}
	if (extracted.kind === "empty") {
		return { kind: "failed", reason: "empty" };
	}

	return {
		kind: "text",
		text: extracted.text,
		usage: response.usage,
	};
}

function buildMachineSummary(conversationText: string, reason: string): string {
	const trimmed = conversationText.trim();
	const excerpt = trimmed
		? trimmed.slice(0, MACHINE_SUMMARY_CHARS)
		: "(no conversation text available)";
	const overflow =
		trimmed.length > MACHINE_SUMMARY_CHARS
			? `\n\n[... truncated ${trimmed.length - MACHINE_SUMMARY_CHARS} characters]`
			: "";
	return [
		"## Goal",
		"Continue the session from this truncated transcript. LLM summarization was unavailable.",
		"",
		"## Constraints & Preferences",
		"- (none recorded — machine fallback)",
		"",
		"## Progress",
		"### Done",
		"- (unknown — machine fallback)",
		"",
		"### In Progress",
		"- (unknown — machine fallback)",
		"",
		"### Blocked",
		`- ${reason}`,
		"",
		"## Key Decisions",
		"- (unknown — machine fallback)",
		"",
		"## Next Steps",
		"1. Resume from the truncated transcript below.",
		"",
		"## Critical Context",
		excerpt + overflow,
	].join("\n");
}

function cancelWithNotify(ctx: ExtensionContext, message: string): { cancel: true } {
	ctx.ui.notify(message, "warning");
	return { cancel: true };
}

function compactResult(
	summary: string,
	firstKeptEntryId: string,
	tokensBefore: number,
	fileLists: FileLists,
	usage?: unknown,
) {
	return {
		compaction: {
			summary: appendFileOperations(summary, fileLists),
			firstKeptEntryId,
			tokensBefore,
			...(usage !== undefined ? { usage } : {}),
			details: fileLists,
		},
	};
}

function treeSummaryResult(summary: string, fileLists: FileLists, usage?: unknown) {
	return {
		summary: {
			summary: appendFileOperations(`${BRANCH_SUMMARY_PREAMBLE}${summary}`, fileLists),
			...(usage !== undefined ? { usage } : {}),
			details: fileLists,
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		if (!isXaiResponsesModel(ctx.model)) {
			return;
		}

		const model = ctx.model;
		const { preparation, customInstructions, reason, signal } = event;
		const conversationText = serializeAgentMessages([
			...preparation.messagesToSummarize,
			...preparation.turnPrefixMessages,
		]);
		const fileLists = fileListsFromFileOps(preparation.fileOps);
		const maxTokens = resolveMaxTokens(preparation.settings?.reserveTokens, model.maxTokens);

		const fallback = (notifyMessage: string, blockedReason: string) => {
			if (reason === "overflow" || conversationText.trim()) {
				ctx.ui.notify(notifyMessage, "error");
				return compactResult(
					buildMachineSummary(conversationText, blockedReason),
					preparation.firstKeptEntryId,
					preparation.tokensBefore,
					fileLists,
				);
			}
			return cancelWithNotify(ctx, notifyMessage);
		};

		try {
			if (signal.aborted) {
				return cancelWithNotify(ctx, "xAI compact cancelled.");
			}
			if (!conversationText.trim()) {
				if (reason === "overflow") {
					ctx.ui.notify("xAI compact used a truncated transcript instead of an LLM summary.", "error");
					return compactResult(
						buildMachineSummary(conversationText, "no conversation text available"),
						preparation.firstKeptEntryId,
						preparation.tokensBefore,
						fileLists,
					);
				}
				return cancelWithNotify(ctx, "xAI compact cancelled.");
			}

			const outcome = await summarizeWithModel(
				ctx,
				model,
				buildPromptText({
					conversationText,
					instructions: preparation.previousSummary
						? UPDATE_SUMMARIZATION_INSTRUCTIONS
						: SUMMARIZATION_INSTRUCTIONS,
					previousSummary: preparation.previousSummary,
					customInstructions,
					splitTurn: preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0,
				}),
				maxTokens,
				signal,
			);

			if (outcome.kind === "aborted" || signal.aborted) {
				return cancelWithNotify(ctx, "xAI compact cancelled.");
			}
			if (outcome.kind === "text") {
				return compactResult(
					outcome.text,
					preparation.firstKeptEntryId,
					preparation.tokensBefore,
					fileLists,
					outcome.usage,
				);
			}

			const blockedReason =
				outcome.reason === "toolCall"
					? "summarization returned a tool call"
					: outcome.reason === "empty"
						? "summarization returned no text"
						: "summarization provider error";
			return fallback("xAI compact used a truncated transcript instead of an LLM summary.", blockedReason);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) {
				return cancelWithNotify(ctx, "xAI compact cancelled.");
			}
			return fallback(
				"xAI compact used a truncated transcript instead of an LLM summary.",
				"summarization provider error",
			);
		}
	});

	pi.on("session_before_tree", async (event, ctx) => {
		if (!isXaiResponsesModel(ctx.model)) {
			return;
		}

		const { preparation, signal } = event;
		if (preparation.userWantsSummary !== true) {
			return;
		}

		const model = ctx.model;
		const conversationText = serializeTreeEntries(preparation.entriesToSummarize);
		const fileLists = fileListsFromTreeEntries(preparation.entriesToSummarize);
		const maxTokens = resolveMaxTokens(DEFAULT_RESERVE_TOKENS, model.maxTokens);

		const fallback = (notifyMessage: string, blockedReason: string) => {
			ctx.ui.notify(notifyMessage, "error");
			return treeSummaryResult(buildMachineSummary(conversationText, blockedReason), fileLists);
		};

		try {
			if (signal.aborted) {
				return cancelWithNotify(ctx, "xAI branch summary cancelled.");
			}
			if (!conversationText.trim()) {
				return treeSummaryResult("No content to summarize", fileLists);
			}

			const outcome = await summarizeWithModel(
				ctx,
				model,
				buildPromptText({
					conversationText,
					instructions: BRANCH_SUMMARY_INSTRUCTIONS,
					customInstructions: preparation.customInstructions,
					replaceInstructions: preparation.replaceInstructions,
				}),
				maxTokens,
				signal,
			);

			if (outcome.kind === "aborted" || signal.aborted) {
				return cancelWithNotify(ctx, "xAI branch summary cancelled.");
			}
			if (outcome.kind === "text") {
				return treeSummaryResult(outcome.text, fileLists, outcome.usage);
			}

			const blockedReason =
				outcome.reason === "toolCall"
					? "summarization returned a tool call"
					: outcome.reason === "empty"
						? "summarization returned no text"
						: "summarization provider error";
			return fallback(
				"xAI branch summary used a truncated transcript instead of an LLM summary.",
				blockedReason,
			);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) {
				return cancelWithNotify(ctx, "xAI branch summary cancelled.");
			}
			return fallback(
				"xAI branch summary used a truncated transcript instead of an LLM summary.",
				"summarization provider error",
			);
		}
	});
}

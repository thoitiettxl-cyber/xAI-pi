import {
	calculateCost,
	Type,
	type Api,
	type Model,
	type Usage,
} from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	formatSize,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "xai";
const MODEL_ID = "grok-4.6";
const XAI_BASE_URL = "https://api.x.ai/v1";
const RESPONSES_URL = `${XAI_BASE_URL}/responses`;
const MAX_CITATIONS = 50;
const MAX_CITATION_URL_LENGTH = 512;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 8_192;
const REQUEST_TIMEOUT_MS = 120_000;
const TRUNCATION_NOTICE_RESERVE_BYTES = 512;

type JsonObject = Record<string, unknown>;

type Citation = {
	url: string;
	title?: string;
};

type XSearchDetails = {
	provider: typeof PROVIDER_ID;
	model: typeof MODEL_ID;
	endpoint: typeof RESPONSES_URL;
	response_id?: string;
	status?: string;
	native_x_search_call_present: boolean;
	citations: Citation[];
	sources_used?: number;
	truncated: boolean;
};

const xSearchParameters = Type.Object(
	{
		query: Type.String({
			description: "Research question to answer by searching public posts on X. Prefer an English query.",
			minLength: 1,
			maxLength: 4_000,
		}),
		allowed_x_handles: Type.Optional(
			Type.Array(
				Type.String({ description: "X handle to include, with or without a leading @." }),
				{
					description: "Only consider posts from these X handles (maximum 20).",
					minItems: 1,
					maxItems: 20,
					uniqueItems: true,
				},
			),
		),
		excluded_x_handles: Type.Optional(
			Type.Array(
				Type.String({ description: "X handle to exclude, with or without a leading @." }),
				{
					description: "Exclude posts from these X handles (maximum 20).",
					minItems: 1,
					maxItems: 20,
					uniqueItems: true,
				},
			),
		),
		from_date: Type.Optional(
			Type.String({
				description: "Inclusive search start date in YYYY-MM-DD format.",
				pattern: "^\\d{4}-\\d{2}-\\d{2}$",
			}),
		),
		to_date: Type.Optional(
			Type.String({
				description: "Inclusive search end date in YYYY-MM-DD format.",
				pattern: "^\\d{4}-\\d{2}-\\d{2}$",
			}),
		),
		enable_image_understanding: Type.Optional(
			Type.Boolean({ description: "Analyze images in X posts encountered by the search." }),
		),
		enable_video_understanding: Type.Optional(
			Type.Boolean({ description: "Analyze videos in X posts encountered by the search." }),
		),
	},
	{ additionalProperties: false },
);

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeHandles(handles: string[] | undefined, field: string): string[] | undefined {
	if (!handles) return undefined;

	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const rawHandle of handles) {
		const handle = rawHandle.trim().replace(/^@/, "");
		if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
			throw new Error(`${field} contains an invalid X handle: ${rawHandle}`);
		}
		const key = handle.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			normalized.push(handle);
		}
	}

	return normalized;
}

function validateDate(field: string, value: string | undefined): void {
	if (value === undefined) return;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) throw new Error(`${field} must use YYYY-MM-DD format`);

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw new Error(`${field} is not a valid calendar date`);
	}
}

function buildSearchTool(params: {
	allowed_x_handles?: string[];
	excluded_x_handles?: string[];
	from_date?: string;
	to_date?: string;
	enable_image_understanding?: boolean;
	enable_video_understanding?: boolean;
}): JsonObject {
	const allowed = normalizeHandles(params.allowed_x_handles, "allowed_x_handles");
	const excluded = normalizeHandles(params.excluded_x_handles, "excluded_x_handles");
	if (allowed?.length && excluded?.length) {
		throw new Error("allowed_x_handles and excluded_x_handles cannot be used together");
	}

	validateDate("from_date", params.from_date);
	validateDate("to_date", params.to_date);
	if (params.from_date && params.to_date && params.from_date > params.to_date) {
		throw new Error("from_date must be earlier than or equal to to_date");
	}

	return {
		type: "x_search",
		...(allowed?.length ? { allowed_x_handles: allowed } : {}),
		...(excluded?.length ? { excluded_x_handles: excluded } : {}),
		...(params.from_date ? { from_date: params.from_date } : {}),
		...(params.to_date ? { to_date: params.to_date } : {}),
		...(params.enable_image_understanding !== undefined
			? { enable_image_understanding: params.enable_image_understanding }
			: {}),
		...(params.enable_video_understanding !== undefined
			? { enable_video_understanding: params.enable_video_understanding }
			: {}),
	};
}

function isOfficialXaiBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash) return false;
		return `${url.origin}${url.pathname.replace(/\/+$/, "")}` === XAI_BASE_URL;
	} catch {
		return false;
	}
}

async function resolveHeaders(ctx: ExtensionContext, model: Model<Api>): Promise<Headers> {
	if (!isOfficialXaiBaseUrl(model.baseUrl)) {
		throw new Error("x_search requires the official https://api.x.ai/v1 endpoint");
	}

	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok) {
		throw new Error(`Unable to resolve Pi auth for xAI: ${resolved.error}`);
	}
	if (resolved.baseUrl && !isOfficialXaiBaseUrl(resolved.baseUrl)) {
		throw new Error("x_search cannot use Pi auth configured for a non-xAI endpoint");
	}
	if (!resolved.apiKey) {
		throw new Error("xAI auth is not configured in Pi; use /login and select xAI");
	}

	return new Headers({
		Accept: "application/json",
		Authorization: `Bearer ${resolved.apiKey}`,
		"Content-Type": "application/json",
	});
}

function safeErrorMessage(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, 800);
}

function apiErrorMessage(body: JsonObject): string | undefined {
	const error = isObject(body.error) ? body.error : undefined;
	const candidates = [
		error?.message,
		error?.code,
		body.message,
		body.detail,
		isObject(body.incomplete_details) ? body.incomplete_details.reason : undefined,
	];
	for (const candidate of candidates) {
		const text = stringValue(candidate);
		if (text) return safeErrorMessage(text);
	}
	return undefined;
}

function parseResponseBody(raw: string, status: number): JsonObject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`xAI returned invalid JSON (HTTP ${status})`);
	}
	if (!isObject(parsed)) throw new Error(`xAI returned an invalid response object (HTTP ${status})`);
	return parsed;
}

async function readResponseText(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("Content-Length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new Error(`xAI response exceeded the ${formatSize(MAX_RESPONSE_BYTES)} safety limit`);
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			totalBytes += chunk.value.byteLength;
			if (totalBytes > MAX_RESPONSE_BYTES) {
				void reader.cancel();
				throw new Error(`xAI response exceeded the ${formatSize(MAX_RESPONSE_BYTES)} safety limit`);
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

function normalizeCitationUrl(raw: string): string | undefined {
	if (raw.length > MAX_CITATION_URL_LENGTH) return undefined;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		if (url.username || url.password || url.href.length > MAX_CITATION_URL_LENGTH) return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

function citationFromUnknown(value: unknown): Citation | undefined {
	if (typeof value === "string") {
		const url = normalizeCitationUrl(value);
		return url ? { url } : undefined;
	}
	if (!isObject(value)) return undefined;

	const nested = isObject(value.url_citation) ? value.url_citation : value;
	const rawUrl = stringValue(nested.url);
	if (!rawUrl) return undefined;
	const url = normalizeCitationUrl(rawUrl);
	if (!url) return undefined;
	const rawTitle = stringValue(nested.title);
	const title = rawTitle ? rawTitle.replace(/\s+/g, " ").slice(0, 240) : undefined;
	return title ? { url, title } : { url };
}

function addCitation(target: Map<string, Citation>, value: unknown): void {
	if (target.size >= MAX_CITATIONS) return;
	const citation = citationFromUnknown(value);
	if (!citation) return;
	const previous = target.get(citation.url);
	if (!previous || (!previous.title && citation.title)) target.set(citation.url, citation);
}

function extractResult(body: JsonObject): {
	answer: string;
	citations: Citation[];
	nativeCallPresent: boolean;
} {
	const output = Array.isArray(body.output) ? body.output : [];
	const textParts: string[] = [];
	const refusalParts: string[] = [];
	const citations = new Map<string, Citation>();
	let nativeCallPresent = false;

	for (const itemValue of output) {
		if (!isObject(itemValue)) continue;
		if (itemValue.type === "x_search_call") nativeCallPresent = true;

		const content = Array.isArray(itemValue.content) ? itemValue.content : [];
		for (const blockValue of content) {
			if (!isObject(blockValue)) continue;
			if (blockValue.type === "output_text") {
				const text = stringValue(blockValue.text);
				if (text) textParts.push(text);
				const annotations = Array.isArray(blockValue.annotations) ? blockValue.annotations : [];
				for (const annotation of annotations) addCitation(citations, annotation);
			} else if (blockValue.type === "refusal") {
				const refusal = stringValue(blockValue.refusal);
				if (refusal) refusalParts.push(refusal);
			}
		}

		if (itemValue.type === "output_text") {
			const text = stringValue(itemValue.text);
			if (text) textParts.push(text);
		}
	}

	if (Array.isArray(body.citations)) {
		for (const citation of body.citations) addCitation(citations, citation);
	}

	const answer = textParts.join("\n\n").trim() || stringValue(body.output_text) || "";
	if (!answer && refusalParts.length > 0) {
		throw new Error(`xAI refused the X search request: ${safeErrorMessage(refusalParts.join(" "))}`);
	}
	if (!answer) throw new Error("xAI completed the request without output text");
	// xAI Responses may omit the call item, and citations are optional; keep both as diagnostics.

	return { answer, citations: [...citations.values()], nativeCallPresent };
}

function parseUsage(body: JsonObject, model: Model<Api>): Usage | undefined {
	if (!isObject(body.usage)) return undefined;
	const raw = body.usage;
	const inputDetails = isObject(raw.input_tokens_details) ? raw.input_tokens_details : undefined;
	const outputDetails = isObject(raw.output_tokens_details) ? raw.output_tokens_details : undefined;
	const inputTokens = nonNegativeNumber(raw.input_tokens) ?? 0;
	const outputTokens = nonNegativeNumber(raw.output_tokens) ?? 0;
	const cacheRead = nonNegativeNumber(inputDetails?.cached_tokens) ?? 0;
	const cacheWrite = nonNegativeNumber(inputDetails?.cache_write_tokens) ?? 0;
	const usage: Usage = {
		input: Math.max(0, inputTokens - cacheRead - cacheWrite),
		output: outputTokens,
		cacheRead,
		cacheWrite,
		reasoning: nonNegativeNumber(outputDetails?.reasoning_tokens) ?? 0,
		totalTokens: nonNegativeNumber(raw.total_tokens) ?? inputTokens + outputTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	return usage;
}

function renderResult(answer: string, citations: Citation[]): {
	text: string;
	truncated: boolean;
} {
	const sources = citations.length
		? `\n\nSources:\n${citations
				.map((citation, index) =>
					citation.title
						? `${index + 1}. ${citation.title} — ${citation.url}`
						: `${index + 1}. ${citation.url}`,
				)
				.join("\n")}`
		: "";
	const rendered = `${answer}${sources}`;
	const truncation = truncateHead(rendered, {
		maxBytes: DEFAULT_MAX_BYTES - TRUNCATION_NOTICE_RESERVE_BYTES,
		maxLines: DEFAULT_MAX_LINES - 2,
	});
	if (!truncation.truncated) return { text: truncation.content, truncated: false };

	const notice = `\n\n[Output truncated to ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	const finalOutput = truncateHead(`${truncation.content}${notice}`, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
	return { text: finalOutput.content, truncated: true };
}

const xSearchTool = defineTool<typeof xSearchParameters, XSearchDetails>({
	name: "x_search",
	label: "X Search",
	description:
		"Search public X posts with xAI's native x_search tool and return a citation-backed answer. Supports handle filters, date bounds, and image/video understanding. Read-only; output is capped at Pi's standard 50KB/2000-line limit.",
	promptSnippet: "Search public posts and threads on X with xAI's native X Search.",
	promptGuidelines: [
		"Use x_search when the requested evidence or current discussion specifically comes from X; use a general web-search tool for the broader web.",
		"Treat x_search as read-only: it cannot post, like, repost, follow, or change an X account.",
	],
	parameters: xSearchParameters,

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		if (signal?.aborted) throw new Error("X search cancelled");
		const query = params.query.trim();
		if (!query) throw new Error("query must not be blank");

		const model = ctx.modelRegistry.find(PROVIDER_ID, MODEL_ID);
		if (!model) throw new Error(`Pi model registry does not contain ${PROVIDER_ID}/${MODEL_ID}`);
		if (model.api !== "openai-responses") {
			throw new Error(`${PROVIDER_ID}/${MODEL_ID} must use the openai-responses API`);
		}

		const searchTool = buildSearchTool(params);
		const headers = await resolveHeaders(ctx, model);
		onUpdate?.({
			content: [{ type: "text", text: "Searching X with xAI…" }],
			details: {
				provider: PROVIDER_ID,
				model: MODEL_ID,
				endpoint: RESPONSES_URL,
				native_x_search_call_present: false,
				citations: [],
				truncated: false,
			},
		});

		const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		let response: Response;
		try {
			response = await fetch(RESPONSES_URL, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: MODEL_ID,
					input: [
						{
							role: "user",
							content: `Use X Search for this request. Base the answer on X posts, preserve citations, and respond concisely in English.\n\nRequest: ${query}`,
						},
					],
					tools: [searchTool],
					reasoning: { effort: "low" },
					max_output_tokens: MAX_OUTPUT_TOKENS,
					store: false,
				}),
				signal: requestSignal,
			});
		} catch (error) {
			if (signal?.aborted) throw new Error("X search cancelled");
			if (timeoutSignal.aborted) {
				throw new Error(`xAI x_search timed out after ${REQUEST_TIMEOUT_MS / 1_000} seconds`);
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Unable to reach xAI Responses API: ${safeErrorMessage(message)}`);
		}

		const body = parseResponseBody(await readResponseText(response), response.status);
		if (!response.ok) {
			const detail = apiErrorMessage(body);
			throw new Error(`xAI x_search failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
		}

		const status = stringValue(body.status);
		if (status === "failed" || status === "cancelled" || status === "incomplete") {
			const detail = apiErrorMessage(body);
			throw new Error(`xAI x_search response was ${status}${detail ? `: ${detail}` : ""}`);
		}

		const result = extractResult(body);
		const rendered = renderResult(result.answer, result.citations);
		const rawUsage = isObject(body.usage) ? body.usage : undefined;
		const sourcesUsed = nonNegativeNumber(rawUsage?.num_sources_used);
		const responseId = stringValue(body.id);
		const usage = parseUsage(body, model);

		return {
			content: [{ type: "text", text: rendered.text }],
			details: {
				provider: PROVIDER_ID,
				model: MODEL_ID,
				endpoint: RESPONSES_URL,
				...(responseId ? { response_id: responseId } : {}),
				...(status ? { status } : {}),
				native_x_search_call_present: result.nativeCallPresent,
				citations: result.citations,
				...(sourcesUsed !== undefined ? { sources_used: sourcesUsed } : {}),
				truncated: rendered.truncated,
			},
			...(usage ? { usage } : {}),
		};
	},
});

export default function xSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool(xSearchTool);
}

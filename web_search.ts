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

const MAX_CITATIONS = 50;
const MAX_CITATION_URL_LENGTH = 512;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 8_192;
const REQUEST_TIMEOUT_MS = 120_000;
const TRUNCATION_NOTICE_RESERVE_BYTES = 512;
const GROK_MODEL_ID_PATTERN = /(?:^|\/)grok(?:$|[-._:])/i;
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_ACCOUNT_CLAIM = "https://api.openai.com/auth";

type JsonObject = Record<string, unknown>;
type SearchBackend = "grok" | "codex";

type Citation = {
	url: string;
	title?: string;
};

type WebSearchDetails = {
	provider: string;
	model: string;
	endpoint: string;
	response_id?: string;
	status?: string;
	native_web_search_call_present: boolean;
	citations: Citation[];
	sources_used?: number;
	server_side_tool_usage?: Record<string, number>;
	truncated: boolean;
};

const webSearchParameters = Type.Object(
	{
		query: Type.String({
			description: "Research question to answer by searching the live web.",
			minLength: 1,
			maxLength: 4_000,
		}),
		allowed_domains: Type.Optional(
			Type.Array(Type.String({ description: "Domain to include, such as example.com." }), {
				description: "Only search and browse these domains (maximum 5).",
				minItems: 1,
				maxItems: 5,
				uniqueItems: true,
			}),
		),
		excluded_domains: Type.Optional(
			Type.Array(Type.String({ description: "Domain to exclude, such as example.com." }), {
				description: "Do not search or browse these domains (maximum 5).",
				minItems: 1,
				maxItems: 5,
				uniqueItems: true,
			}),
		),
		enable_image_understanding: Type.Optional(
			Type.Boolean({ description: "Analyze images encountered while browsing web pages." }),
		),
		enable_image_search: Type.Optional(
			Type.Boolean({ description: "Search for relevant images and allow Markdown image embeds in the answer." }),
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

function normalizeDomain(rawDomain: string, field: string): string {
	const candidate = rawDomain.trim().replace(/\.$/, "");
	if (!candidate) throw new Error(`${field} contains a blank domain`);
	if (/[:/\\?#@\s]/.test(candidate)) {
		throw new Error(`${field} must contain domain names only, without schemes, ports, paths, or wildcards`);
	}

	let parsed: URL;
	try {
		parsed = new URL(`https://${candidate}`);
	} catch {
		throw new Error(`${field} contains an invalid domain: ${rawDomain}`);
	}

	const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if (!hostname || hostname.length > 253) {
		throw new Error(`${field} contains an invalid domain: ${rawDomain}`);
	}
	const labels = hostname.split(".");
	if (
		labels.some(
			(label) =>
				label.length === 0 ||
				label.length > 63 ||
				!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
		)
	) {
		throw new Error(`${field} contains an invalid domain: ${rawDomain}`);
	}
	return hostname;
}

function normalizeDomains(domains: string[] | undefined, field: string): string[] | undefined {
	if (!domains) return undefined;

	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const rawDomain of domains) {
		const domain = normalizeDomain(rawDomain, field);
		if (!seen.has(domain)) {
			seen.add(domain);
			normalized.push(domain);
		}
	}
	return normalized;
}

function classifyBackend(model: Model<Api>): SearchBackend {
	if (GROK_MODEL_ID_PATTERN.test(model.id) && model.api === "openai-responses") {
		return "grok";
	}
	if (model.provider === "openai-codex" && model.api === "openai-codex-responses") {
		return "codex";
	}
	throw new Error(
		`web_search requires an active Grok model using openai-responses or openai-codex using openai-codex-responses; current model is ${model.provider}/${model.id} (${model.api})`,
	);
}

function buildGrokSearchTool(params: {
	allowed_domains?: string[];
	excluded_domains?: string[];
	enable_image_understanding?: boolean;
	enable_image_search?: boolean;
}): JsonObject {
	const allowed = normalizeDomains(params.allowed_domains, "allowed_domains");
	const excluded = normalizeDomains(params.excluded_domains, "excluded_domains");
	if (allowed?.length && excluded?.length) {
		throw new Error("allowed_domains and excluded_domains cannot be used together");
	}

	const filters = allowed?.length
		? { allowed_domains: allowed }
		: excluded?.length
			? { excluded_domains: excluded }
			: undefined;

	return {
		type: "web_search",
		...(filters ? { filters } : {}),
		...(params.enable_image_understanding !== undefined
			? { enable_image_understanding: params.enable_image_understanding }
			: {}),
		...(params.enable_image_search !== undefined
			? { enable_image_search: params.enable_image_search }
			: {}),
	};
}

function buildCodexSearchTool(params: {
	allowed_domains?: string[];
	excluded_domains?: string[];
	enable_image_understanding?: boolean;
	enable_image_search?: boolean;
}): JsonObject {
	const unsupported: string[] = [];
	if (params.enable_image_understanding !== undefined) unsupported.push("enable_image_understanding");
	if (params.enable_image_search !== undefined) unsupported.push("enable_image_search");
	if (unsupported.length > 0) {
		throw new Error(
			`openai-codex does not accept ${unsupported.join(" or ")}; those fields are Grok-only`,
		);
	}

	const allowed = normalizeDomains(params.allowed_domains, "allowed_domains");
	const excluded = normalizeDomains(params.excluded_domains, "excluded_domains");
	if (allowed?.length && excluded?.length) {
		throw new Error("allowed_domains and excluded_domains cannot be used together");
	}

	const filters = allowed?.length
		? { allowed_domains: allowed }
		: excluded?.length
			? { blocked_domains: excluded }
			: undefined;

	return {
		type: "web_search",
		...(filters ? { filters } : {}),
	};
}

function buildSearchTool(
	params: {
		allowed_domains?: string[];
		excluded_domains?: string[];
		enable_image_understanding?: boolean;
		enable_image_search?: boolean;
	},
	backend: SearchBackend,
): JsonObject {
	return backend === "codex" ? buildCodexSearchTool(params) : buildGrokSearchTool(params);
}

function parseBaseUrl(baseUrl: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new Error(`${label} has an invalid base URL`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`${label} base URL must use HTTP or HTTPS`);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(`${label} base URL must not contain credentials, a query, or a fragment`);
	}
	return url;
}

function responsesEndpoint(baseUrl: string): string {
	const url = parseBaseUrl(baseUrl, "The active model");
	const basePath = url.pathname.replace(/\/+$/, "");
	url.pathname = `${basePath}/responses`;
	return url.href;
}

function resolveCodexEndpoint(baseUrl: string): string {
	const raw = baseUrl.trim() || DEFAULT_CODEX_BASE_URL;
	const url = parseBaseUrl(raw, "The openai-codex model");
	const basePath = url.pathname.replace(/\/+$/, "");
	if (basePath.endsWith("/codex/responses")) {
		url.pathname = basePath;
	} else if (basePath.endsWith("/codex")) {
		url.pathname = `${basePath}/responses`;
	} else {
		url.pathname = `${basePath}/codex/responses`;
	}
	return url.href;
}

function resolveAccessToken(resolved: {
	apiKey?: string;
	headers?: Record<string, string | null>;
}): string {
	const apiKey = stringValue(resolved.apiKey);
	if (apiKey) return apiKey;

	for (const [name, value] of Object.entries(resolved.headers ?? {})) {
		if (name.toLowerCase() !== "authorization" || value === null) continue;
		const trimmed = value.trim();
		const bearer = /^Bearer\s+(\S+)/i.exec(trimmed);
		if (bearer?.[1]) return bearer[1];
	}

	throw new Error("Unable to resolve Pi auth for openai-codex: missing access token");
}

function decodeJwtPayload(token: string): JsonObject {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Unable to resolve chatgpt-account-id from the openai-codex access token");
	}

	try {
		const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
		const parsed: unknown = JSON.parse(atob(padded));
		if (!isObject(parsed)) {
			throw new Error("invalid payload");
		}
		return parsed;
	} catch {
		throw new Error("Unable to resolve chatgpt-account-id from the openai-codex access token");
	}
}

function extractChatgptAccountId(token: string): string {
	const payload = decodeJwtPayload(token);
	const auth = isObject(payload[CODEX_ACCOUNT_CLAIM]) ? payload[CODEX_ACCOUNT_CLAIM] : undefined;
	const accountId = stringValue(auth?.chatgpt_account_id);
	if (!accountId) {
		throw new Error("Unable to resolve chatgpt-account-id from the openai-codex access token");
	}
	return accountId;
}

async function resolveGrokRequest(
	ctx: ExtensionContext,
	model: Model<Api>,
): Promise<{ endpoint: string; headers: Headers }> {
	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok) {
		throw new Error(
			`Unable to resolve Pi auth for ${model.provider}: ${safeErrorMessage(resolved.error)}`,
		);
	}

	const endpoint = responsesEndpoint(resolved.baseUrl ?? model.baseUrl);
	const resolvedHeaders = Object.entries(resolved.headers ?? {});
	const authorizationSuppressed = resolvedHeaders.some(
		([name, value]) => name.toLowerCase() === "authorization" && value === null,
	);
	const headers = new Headers();
	for (const [name, value] of resolvedHeaders) {
		if (value !== null) headers.set(name, value);
	}
	if (resolved.apiKey && !authorizationSuppressed && !headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${resolved.apiKey}`);
	}
	headers.delete("Content-Length");
	headers.delete("Host");
	headers.set("Accept", "application/json");
	headers.set("Content-Type", "application/json");
	return { endpoint, headers };
}

async function resolveCodexRequest(
	ctx: ExtensionContext,
	model: Model<Api>,
): Promise<{ endpoint: string; headers: Headers }> {
	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok) {
		throw new Error(
			`Unable to resolve Pi auth for ${model.provider}: ${safeErrorMessage(resolved.error)}`,
		);
	}

	const token = resolveAccessToken(resolved);
	const accountId = extractChatgptAccountId(token);
	const endpoint = resolveCodexEndpoint(resolved.baseUrl ?? model.baseUrl);
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("originator", "pi");
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("Accept", "text/event-stream");
	headers.set("Content-Type", "application/json");
	return { endpoint, headers };
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
		throw new Error(`The provider returned invalid JSON (HTTP ${status})`);
	}
	if (!isObject(parsed)) {
		throw new Error(`The provider returned an invalid response object (HTTP ${status})`);
	}
	return parsed;
}

function parseSseDataBlocks(raw: string): string[] {
	const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const blocks: string[] = [];
	for (const chunk of normalized.split("\n\n")) {
		const dataLines = chunk
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim());
		if (dataLines.length === 0) continue;
		const data = dataLines.join("\n").trim();
		if (data && data !== "[DONE]") blocks.push(data);
	}
	return blocks;
}

function readCodexResponseBody(raw: string, status: number): JsonObject {
	const events: JsonObject[] = [];
	for (const data of parseSseDataBlocks(raw)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			throw new Error(`The provider returned invalid SSE JSON (HTTP ${status})`);
		}
		if (isObject(parsed)) events.push(parsed);
	}

	if (events.length === 0) {
		throw new Error("The openai-codex stream ended without a completed web_search response");
	}

	const outputItems = new Map<number, JsonObject>();
	const contentParts = new Map<number, Map<number, JsonObject>>();
	let terminal: JsonObject | undefined;

	const eventIndex = (value: unknown): number | undefined => {
		const index = nonNegativeNumber(value);
		return index === undefined ? undefined : Math.floor(index);
	};
	const getContentPart = (outputIndex: number, contentIndex: number, type: "output_text" | "refusal"): JsonObject => {
		let parts = contentParts.get(outputIndex);
		if (!parts) {
			parts = new Map<number, JsonObject>();
			contentParts.set(outputIndex, parts);
		}
		let part = parts.get(contentIndex);
		if (!part || part.type !== type) {
			part = type === "output_text"
				? { type, text: "", annotations: [] }
				: { type, refusal: "" };
			parts.set(contentIndex, part);
		}
		return part;
	};

	for (const event of events) {
		const type = stringValue(event.type);
		if (type === "error") {
			const nested = isObject(event.error) ? event.error : undefined;
			const detail =
				stringValue(event.message) ||
				stringValue(nested?.message) ||
				stringValue(event.code) ||
				stringValue(nested?.code);
			throw new Error(
				`openai-codex web_search failed${detail ? `: ${safeErrorMessage(detail)}` : ""}`,
			);
		}
		if (type === "response.failed") {
			const failed = isObject(event.response) ? event.response : event;
			const detail = apiErrorMessage(failed);
			throw new Error(
				`openai-codex web_search failed${detail ? `: ${detail}` : ""}`,
			);
		}
		if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
			terminal = isObject(event.response) ? event.response : event;
		}

		const outputIndex = eventIndex(event.output_index);
		if (outputIndex === undefined) continue;

		if ((type === "response.output_item.added" || type === "response.output_item.done") && isObject(event.item)) {
			outputItems.set(outputIndex, event.item);
			continue;
		}

		const contentIndex = eventIndex(event.content_index);
		if (contentIndex === undefined) continue;
		if (type === "response.content_part.done" && isObject(event.part)) {
			let parts = contentParts.get(outputIndex);
			if (!parts) {
				parts = new Map<number, JsonObject>();
				contentParts.set(outputIndex, parts);
			}
			parts.set(contentIndex, event.part);
		} else if (type === "response.output_text.delta") {
			const delta = typeof event.delta === "string" ? event.delta : "";
			const part = getContentPart(outputIndex, contentIndex, "output_text");
			part.text = `${typeof part.text === "string" ? part.text : ""}${delta}`;
		} else if (type === "response.output_text.done") {
			const part = getContentPart(outputIndex, contentIndex, "output_text");
			part.text = typeof event.text === "string" ? event.text : part.text;
		} else if (type === "response.output_text.annotation.added") {
			const part = getContentPart(outputIndex, contentIndex, "output_text");
			const annotations = Array.isArray(part.annotations) ? part.annotations : [];
			annotations.push(event.annotation);
			part.annotations = annotations;
		} else if (type === "response.refusal.delta") {
			const delta = typeof event.delta === "string" ? event.delta : "";
			const part = getContentPart(outputIndex, contentIndex, "refusal");
			part.refusal = `${typeof part.refusal === "string" ? part.refusal : ""}${delta}`;
		} else if (type === "response.refusal.done") {
			const part = getContentPart(outputIndex, contentIndex, "refusal");
			part.refusal = typeof event.refusal === "string" ? event.refusal : part.refusal;
		}
	}

	if (!terminal) {
		throw new Error("The openai-codex stream ended without a completed web_search response");
	}
	if (Array.isArray(terminal.output) && terminal.output.length > 0) return terminal;

	const outputIndexes = new Set<number>([...outputItems.keys(), ...contentParts.keys()]);
	const output: JsonObject[] = [];
	for (const outputIndex of [...outputIndexes].sort((a, b) => a - b)) {
		const item = outputItems.get(outputIndex);
		const streamedParts = contentParts.get(outputIndex);
		if (!streamedParts || streamedParts.size === 0) {
			if (item) output.push(item);
			continue;
		}

		const mergedParts = new Map<number, JsonObject>();
		if (item && Array.isArray(item.content)) {
			item.content.forEach((part, index) => {
				if (isObject(part)) mergedParts.set(index, part);
			});
		}
		for (const [contentIndex, streamedPart] of streamedParts) {
			const existing = mergedParts.get(contentIndex);
			if (existing?.type === "output_text" && streamedPart.type === "output_text") {
				mergedParts.set(contentIndex, {
					...existing,
					...streamedPart,
					text: stringValue(streamedPart.text) ?? stringValue(existing.text) ?? "",
					annotations:
						Array.isArray(streamedPart.annotations) && streamedPart.annotations.length > 0
							? streamedPart.annotations
							: Array.isArray(existing.annotations)
								? existing.annotations
								: [],
				});
			} else {
				mergedParts.set(contentIndex, streamedPart);
			}
		}
		output.push({
			...(item ?? { type: "message", role: "assistant", status: "completed" }),
			content: [...mergedParts.entries()]
				.sort(([left], [right]) => left - right)
				.map(([, part]) => part),
		});
	}

	return output.length > 0 ? { ...terminal, output } : terminal;
}

async function readResponseText(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("Content-Length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new Error(`Provider response exceeded the ${formatSize(MAX_RESPONSE_BYTES)} safety limit`);
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
				throw new Error(`Provider response exceeded the ${formatSize(MAX_RESPONSE_BYTES)} safety limit`);
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
		if (itemValue.type === "web_search_call") nativeCallPresent = true;

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
		throw new Error(`The provider refused the web search request: ${safeErrorMessage(refusalParts.join(" "))}`);
	}
	if (!answer) throw new Error("The provider completed the request without output text");

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

function parseServerSideToolUsage(value: unknown): Record<string, number> | undefined {
	if (!isObject(value)) return undefined;
	const usage: Record<string, number> = {};
	for (const [rawName, rawCount] of Object.entries(value).slice(0, 20)) {
		const name = rawName.trim().slice(0, 80);
		const count = nonNegativeNumber(rawCount);
		if (name && count !== undefined) usage[name] = count;
	}
	return Object.keys(usage).length > 0 ? usage : undefined;
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

function outputTokenLimit(model: Model<Api>): number {
	const modelLimit = Number.isFinite(model.maxTokens) && model.maxTokens > 0
		? Math.floor(model.maxTokens)
		: MAX_OUTPUT_TOKENS;
	return Math.min(MAX_OUTPUT_TOKENS, modelLimit);
}

function httpErrorDetail(raw: string, status: number): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		return apiErrorMessage(parseResponseBody(trimmed, status));
	} catch {
		return undefined;
	}
}

const webSearchTool = defineTool<typeof webSearchParameters, WebSearchDetails>({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the live web with the active Grok or openai-codex model's hosted web_search tool. Supports domain filters and citations. Image understanding and image search work on Grok only. Requires an active Grok model using the OpenAI Responses API, or openai-codex using openai-codex-responses. Read-only; output is capped at Pi's standard 50KB/2000-line limit.",
	promptSnippet: "Search and browse the live web with the active Grok or openai-codex model.",
	promptGuidelines: [
		"Use web_search for current information or when reliable answers require browsing public web pages.",
		"Use web_search domain filters only when the user requests specific sources or exclusions; allowed_domains and excluded_domains cannot be combined.",
		"Do not set enable_image_understanding or enable_image_search when the active model is openai-codex; those flags are Grok-only.",
	],
	parameters: webSearchParameters,

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		if (signal?.aborted) throw new Error("Web search cancelled");
		const query = params.query.trim();
		if (!query) throw new Error("query must not be blank");

		const model = ctx.model;
		if (!model) throw new Error("web_search requires an active Pi model");
		const backend = classifyBackend(model);

		const searchTool = buildSearchTool(params, backend);
		const { endpoint, headers } =
			backend === "codex"
				? await resolveCodexRequest(ctx, model)
				: await resolveGrokRequest(ctx, model);
		onUpdate?.({
			content: [{ type: "text", text: `Searching the web with ${model.provider}/${model.id}…` }],
			details: {
				provider: model.provider,
				model: model.id,
				endpoint,
				native_web_search_call_present: false,
				citations: [],
				truncated: false,
			},
		});

		const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		const requestBody: JsonObject = {
			model: model.id,
			input: [
				{
					role: "user",
					content: `Use Web Search for this request. Base the answer on current web sources, preserve citations and relevant Markdown image embeds, and answer in the same language as the request unless it specifies another language.\n\nRequest: ${query}`,
				},
			],
			tools: [searchTool],
			store: false,
		};
		if (backend === "codex") {
			requestBody.stream = true;
		} else {
			requestBody.max_output_tokens = outputTokenLimit(model);
		}

		let response: Response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal: requestSignal,
			});
		} catch (error) {
			if (signal?.aborted) throw new Error("Web search cancelled");
			if (timeoutSignal.aborted) {
				throw new Error(`Web search timed out after ${REQUEST_TIMEOUT_MS / 1_000} seconds`);
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Unable to reach ${model.provider} Responses API: ${safeErrorMessage(message)}`);
		}

		const raw = await readResponseText(response);
		if (!response.ok) {
			const detail = httpErrorDetail(raw, response.status);
			throw new Error(
				`${model.provider} web_search failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
			);
		}

		const body =
			backend === "codex"
				? readCodexResponseBody(raw, response.status)
				: parseResponseBody(raw, response.status);

		const status = stringValue(body.status);
		if (status === "failed" || status === "cancelled" || status === "incomplete") {
			const detail = apiErrorMessage(body);
			throw new Error(`Web search response was ${status}${detail ? `: ${detail}` : ""}`);
		}

		const result = extractResult(body);
		const rendered = renderResult(result.answer, result.citations);
		const rawUsage = isObject(body.usage) ? body.usage : undefined;
		const sourcesUsed = nonNegativeNumber(rawUsage?.num_sources_used);
		const serverSideToolUsage = parseServerSideToolUsage(body.server_side_tool_usage);
		const responseId = stringValue(body.id);
		const usage = parseUsage(body, model);

		return {
			content: [{ type: "text", text: rendered.text }],
			details: {
				provider: model.provider,
				model: model.id,
				endpoint,
				...(responseId ? { response_id: responseId } : {}),
				...(status ? { status } : {}),
				native_web_search_call_present: result.nativeCallPresent,
				citations: result.citations,
				...(sourcesUsed !== undefined ? { sources_used: sourcesUsed } : {}),
				...(serverSideToolUsage ? { server_side_tool_usage: serverSideToolUsage } : {}),
				truncated: rendered.truncated,
			},
			...(usage ? { usage } : {}),
		};
	},
});

export default function webSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool(webSearchTool);
}

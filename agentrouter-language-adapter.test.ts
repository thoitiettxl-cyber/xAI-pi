import assert from "node:assert/strict";
import test from "node:test";
import registerAdapter, { __testing } from "./agentrouter-language-adapter.ts";

const {
	AdapterError,
	BoundedTextCache,
	adaptOpenAICompletionsPayload,
	findVietnamesePath,
	looksVietnamese,
	makeBlockedPayload,
	parseTranslationEnvelope,
	prepareProtectedText,
	wrapDisplayText,
	restoreProtectedText,
} = __testing;

function assistantMessage(text: string, provider = "xai", api = "openai-responses") {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api,
		provider,
		model: provider === "xai" ? "grok-4.6" : "gpt-5.6-sol",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function fakeModels() {
	return {
		target: {
			id: "gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			api: "openai-completions",
			provider: "agentrouter",
			baseUrl: "https://agentrouter.org/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 272_000,
			maxTokens: 128_000,
		},
		sidecar: {
			id: "grok-4.6",
			name: "Grok 4.6",
			api: "openai-responses",
			provider: "xai",
			baseUrl: "https://api.x.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 272_000,
			maxTokens: 128_000,
		},
	};
}

function createHarness(
	options: {
		sidecar?: boolean;
		sidecarBaseUrl?: string;
		resolvedBaseUrl?: string;
		apiKey?: string | null;
	} = {},
) {
	const handlers = new Map<string, Function[]>();
	let entryRenderer: Function | undefined;
	const appendedEntries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		on(name: string, handler: Function) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerEntryRenderer(_customType: string, handler: Function) {
			entryRenderer = handler;
		},
		appendEntry(customType: string, data: unknown) {
			appendedEntries.push({ customType, data });
		},
	};
	registerAdapter(pi as never);
	const models = fakeModels();
	if (options.sidecarBaseUrl) models.sidecar.baseUrl = options.sidecarBaseUrl;
	let aborts = 0;
	let completeCalls = 0;
	const notifications: Array<{ message: string; level: string }> = [];
	const registry = {
		find(provider: string, model: string) {
			return options.sidecar !== false && provider === "xai" && model === "grok-4.6"
				? models.sidecar
				: undefined;
		},
		async getApiKeyAndHeaders() {
			return {
				ok: true,
				apiKey: options.apiKey === undefined ? "test-key" : options.apiKey ?? undefined,
				baseUrl: options.resolvedBaseUrl ?? "https://api.x.ai/v1",
			};
		},
		async complete(_model: unknown, context: any) {
			completeCalls++;
			const input = JSON.parse(context.messages[0].content[0].text) as {
				items: Array<{ id: string; text: string }>;
			};
			const toVietnamese = context.systemPrompt.includes("English-to-Vietnamese");
			const translations = input.items.map((item) => {
				let text = item.text;
				if (toVietnamese) {
					if (text === "Done.") text = "Đã xong.";
					else if (text === "I will read the file.") text = "Tôi sẽ đọc tệp.";
					else text = text.replace("Please configure", "Vui lòng cấu hình");
				} else {
					text = text
						.replaceAll("Hãy", "Please")
						.replaceAll("Vui lòng", "Please")
						.replaceAll("làm chính xác", "work precisely")
						.replaceAll("cấu hình", "configure")
						.replaceAll("Đã xong", "Done")
						.replaceAll("Đọc tệp", "Read file")
						.replaceAll("Đường dẫn", "Path");
				}
				return { id: item.id, text };
			});
			return assistantMessage(JSON.stringify({ translations }));
		},
	};
	const ctx = {
		model: models.target,
		modelRegistry: registry,
		signal: undefined,
		abort() {
			aborts++;
		},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	};
	return {
		ctx,
		handlers,
		models,
		notifications,
		get aborts() {
			return aborts;
		},
		get completeCalls() {
			return completeCalls;
		},
		appendedEntries,
		get entryRenderer() {
			return entryRenderer;
		},
	};
}

test("detects accented and common unaccented Vietnamese without flagging English prose", () => {
	assert.equal(looksVietnamese("Vui lòng cấu hình tiếng Việt."), true);
	assert.equal(looksVietnamese("xin chao, vui long giup toi"), true);
	assert.equal(looksVietnamese("toi ve nha"), true);
	assert.equal(looksVietnamese("Please configure the adapter for this repository."), false);
	assert.equal(looksVietnamese("Ban the user after three failed attempts."), false);
});

test("masks and restores code, inline code, URLs, and Markdown destinations", () => {
	const source = [
		"Hãy chạy `npm test` rồi đọc https://example.com/a.",
		"```ts",
		"const value = 1;",
		"```",
		"Xem [tài liệu](docs/guide.md).",
	].join("\n");
	const prepared = prepareProtectedText(source, "vi-to-en");
	assert.equal(prepared.parts.length, 4);
	const translated = prepared.masked
		.replace("Hãy chạy", "Please run")
		.replace("rồi đọc", "then read")
		.replace("Xem", "See")
		.replace("tài liệu", "documentation");
	const restored = restoreProtectedText(translated, prepared);
	assert.match(restored, /`npm test`/);
	assert.match(restored, /```ts\nconst value = 1;\n```/);
	assert.match(restored, /https:\/\/example\.com\/a\./);
	assert.match(restored, /\(docs\/guide\.md\)/);
});

test("rejects Vietnamese inside protected technical text", () => {
	assert.throws(
		() => prepareProtectedText("Please open `tệp-cấu-hình.ts`.", "vi-to-en"),
		(error: unknown) => error instanceof AdapterError && error.code === "protected_vietnamese",
	);
});

test("rejects Vietnamese in attached files, raw JSON, and likely raw code", () => {
	const technicalInputs = [
		'<file name="/tmp/config.ts">\nconst label = "Cấu hình";\n</file>',
		'{"message":"Không được thay đổi"}',
		'const label = "Cấu hình";',
		'Vui lòng mở /tmp/cấu-hình.txt.',
		'Vui lòng mở C:\\Users\\me\\cấu-hình.txt.',
	];
	for (const input of technicalInputs) {
		assert.throws(
			() => prepareProtectedText(input, "vi-to-en"),
			(error: unknown) => error instanceof AdapterError && error.code === "protected_vietnamese",
		);
	}
});

test("preserves detected bare paths byte-for-byte", () => {
	const source = "Vui lòng mở /tmp/cau-hinh.txt và src/config.ts.";
	const prepared = prepareProtectedText(source, "vi-to-en");
	assert.ok(prepared.parts.some((part: { value: string }) => part.value.includes("/tmp/cau-hinh.txt")));
	assert.ok(prepared.parts.some((part: { value: string }) => part.value.includes("src/config.ts")));
	const translated = prepared.masked.replace("Vui lòng mở", "Please open").replace("và", "and");
	const restored = restoreProtectedText(translated, prepared);
	assert.match(restored, /\/tmp\/cau-hinh\.txt/);
	assert.match(restored, /src\/config\.ts/);
});

test("preserves raw code and JSON as whole technical values", () => {
	for (const source of ['const label = "Configuration";', '{"message":"Configuration"}']) {
		for (const direction of ["vi-to-en", "en-to-vi"] as const) {
			const prepared = prepareProtectedText(source, direction);
			assert.deepEqual(prepared.parts.map((part: { value: string }) => part.value), [source]);
			assert.equal(restoreProtectedText(prepared.masked, prepared), source);
		}
	}
});

test("requires every translation envelope id exactly once", () => {
	const parsed = parseTranslationEnvelope(
		'{"translations":[{"id":"0","text":"one"},{"id":"1","text":"two"}]}',
		["0", "1"],
	);
	assert.equal(parsed.get("1"), "two");
	assert.throws(() =>
		parseTranslationEnvelope('{"translations":[{"id":"0","text":"one"}]}', ["0", "1"]),
	);
});

test("adapts a cloned Chat Completions payload and preserves structural fields", async () => {
	const payload = {
		model: "gpt-5.6-sol",
		stream: true,
		messages: [
			{ role: "developer", content: "Hãy trả lời chính xác." },
			{
				role: "user",
				content: [
					{ type: "text", text: "Vui lòng đọc `README.md`." },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
				],
			},
			{ role: "assistant", content: "Đã xong." },
		],
		tools: [
			{
				type: "function",
				function: {
					name: "read",
					description: "Đọc tệp",
					parameters: {
						type: "object",
						properties: { path: { type: "string", description: "Đường dẫn" } },
					},
				},
			},
		],
	};
	const before = structuredClone(payload);
	const replacements = new Map([
		["Hãy trả lời chính xác.", "Answer precisely."],
		["Vui lòng đọc `README.md`.", "Please read `README.md`."],
		["Đã xong.", "Done."],
		["Đọc tệp", "Read file"],
		["Đường dẫn", "Path"],
	]);
	const result = await adaptOpenAICompletionsPayload(payload, async (_direction, sources) =>
		sources.map((source) => replacements.get(source) ?? source),
	);
	assert.equal(result.kind, "safe");
	if (result.kind !== "safe") return;
	assert.deepEqual(payload, before);
	assert.equal(findVietnamesePath(result.payload), undefined);
	assert.equal((result.payload.messages as any[])[1].content[1].image_url.url, "data:image/png;base64,AAAA");
	assert.equal((result.payload.tools as any[])[0].function.name, "read");
	assert.equal((result.payload.tools as any[])[0].function.parameters.properties.path.description, "Path");
});

test("blocks Vietnamese tool output without invoking translation", async () => {
	let calls = 0;
	const result = await adaptOpenAICompletionsPayload(
		{
			model: "gpt-5.6-sol",
			messages: [{ role: "tool", tool_call_id: "call_1", content: "Không tìm thấy tệp." }],
			stream: true,
		},
		async (_direction, sources) => {
			calls++;
			return sources;
		},
	);
	assert.equal(result.kind, "blocked");
	if (result.kind === "blocked") assert.equal(result.code, "technical_vietnamese");
	assert.equal(calls, 0);
});

test("blocks residual Vietnamese and escaped Vietnamese in structural JSON", async () => {
	const untranslated = await adaptOpenAICompletionsPayload(
		{
			model: "gpt-5.6-sol",
			messages: [{ role: "user", content: "Vui lòng giúp tôi." }],
			stream: true,
		},
		async (_direction, sources) => sources,
	);
	assert.equal(untranslated.kind, "blocked");
	if (untranslated.kind === "blocked") assert.equal(untranslated.code, "residual_vietnamese");

	const escaped = await adaptOpenAICompletionsPayload(
		{
			model: "gpt-5.6-sol",
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "read", arguments: '{"path":"t\\u1ec7p.txt"}' },
						},
					],
				},
			],
			stream: true,
		},
		async (_direction, sources) => sources,
	);
	assert.equal(escaped.kind, "blocked");
});

test("bounded cache evicts least recently used entries by size", () => {
	const cache = new BoundedTextCache(2, 100);
	cache.set("a", "one");
	cache.set("b", "two");
	assert.equal(cache.get("a"), "one");
	cache.set("c", "three");
	assert.equal(cache.get("b"), undefined);
	assert.equal(cache.get("a"), "one");
	assert.equal(cache.get("c"), "three");
});

test("plain-text entry rendering strips controls and wraps deterministically", () => {
	assert.deepEqual(wrapDisplayText("abcd\u001b\nx\tz", 3), ["abc", "d", "x  ", "  z"]);
});

test("provider gate requires both agentrouter and openai-completions", async () => {
	const harness = createHarness({ sidecar: false });
	const handler = harness.handlers.get("before_provider_request")?.[0];
	assert.ok(handler);
	const nonTargets = [
		{ ...harness.models.target, provider: "other" },
		{ ...harness.models.target, api: "openai-responses" },
		undefined,
	];
	for (const model of nonTargets) {
		const result = await handler(
			{ payload: { model: "other", messages: [{ role: "user", content: "Tiếng Việt" }] } },
			{ ...harness.ctx, model },
		);
		assert.equal(result, undefined);
	}
	assert.equal(harness.aborts, 0);
	assert.equal(harness.completeCalls, 0);
});

test("missing sidecar fails closed with abort and an English-only sentinel", async () => {
	const harness = createHarness({ sidecar: false });
	const handler = harness.handlers.get("before_provider_request")?.[0];
	assert.ok(handler);
	const result = await handler(
		{ payload: { model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hello" }], stream: true } },
		harness.ctx,
	);
	assert.equal(harness.aborts, 1);
	assert.deepEqual(result, makeBlockedPayload("gpt-5.6-sol"));
	assert.equal(findVietnamesePath(result), undefined);
	assert.equal(harness.notifications.at(-1)?.level, "error");
});

test("sidecar rejects proxy URLs and missing API keys before completion", async () => {
	const unsafeOptions = [
		{ sidecarBaseUrl: "https://proxy.example/v1" },
		{ resolvedBaseUrl: "https://proxy.example/v1" },
		{ apiKey: null },
	];
	for (const options of unsafeOptions) {
		const harness = createHarness(options);
		const handler = harness.handlers.get("before_provider_request")?.[0];
		assert.ok(handler);
		const result = await handler(
			{ payload: { model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hello" }], stream: true } },
			harness.ctx,
		);
		assert.deepEqual(result, makeBlockedPayload("gpt-5.6-sol"));
		assert.equal(harness.aborts, 1);
		assert.equal(harness.completeCalls, 0);
	}
});

test("hook translates payload without mutating source and does not abort", async () => {
	const harness = createHarness({ sidecar: true });
	const handler = harness.handlers.get("before_provider_request")?.[0];
	assert.ok(handler);
	const payload = {
		model: "gpt-5.6-sol",
		messages: [
			{ role: "developer", content: "Hãy làm chính xác." },
			{ role: "user", content: "Vui lòng cấu hình." },
		],
		stream: true,
	};
	const before = structuredClone(payload);
	const result = await handler({ payload }, harness.ctx);
	assert.deepEqual(payload, before);
	assert.equal(harness.aborts, 0);
	assert.equal(findVietnamesePath(result), undefined);
	assert.ok(harness.completeCalls >= 1);
});


test("AgentRouter reply is appended as a provider-scoped TUI translation entry", async () => {
	const harness = createHarness({ sidecar: true });
	const handler = harness.handlers.get("turn_end")?.[0];
	assert.ok(handler);
	const message = assistantMessage("Done.", "agentrouter", "openai-completions");
	const before = structuredClone(message);
	const result = await handler({ turnIndex: 0, message, toolResults: [] }, harness.ctx);
	assert.equal(result, undefined);
	assert.deepEqual(message, before);
	assert.ok(harness.entryRenderer);
	assert.equal(harness.appendedEntries.length, 1);
	assert.equal(harness.appendedEntries[0]?.customType, "agentrouter-vietnamese-translation");
	const data = harness.appendedEntries[0]?.data as any;
	assert.equal(data.text, "Đã xong.");
	assert.equal(data.model, "gpt-5.6-sol");
	assert.equal(typeof data.timestamp, "number");
});

test("tool-call turn prose is translated without changing tool calls", async () => {
	const harness = createHarness({ sidecar: true });
	const handler = harness.handlers.get("turn_end")?.[0];
	assert.ok(handler);
	const message = assistantMessage("I will read the file.", "agentrouter", "openai-completions") as any;
	message.content.push({ type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } });
	const before = structuredClone(message);
	await handler({ turnIndex: 0, message, toolResults: [] }, harness.ctx);
	assert.deepEqual(message, before);
	assert.equal((harness.appendedEntries[0]?.data as any).text, "Tôi sẽ đọc tệp.");
});

test("display translation does not run for another provider", async () => {
	const harness = createHarness({ sidecar: true });
	const handler = harness.handlers.get("turn_end")?.[0];
	assert.ok(handler);
	const message = assistantMessage("Done.", "xai", "openai-responses");
	await handler({ turnIndex: 0, message, toolResults: [] }, harness.ctx);
	assert.equal(harness.completeCalls, 0);
	assert.deepEqual(harness.appendedEntries, []);
});

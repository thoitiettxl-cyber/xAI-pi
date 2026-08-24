#### Advanced API Usage

# Context Compaction

When a conversation grows past a few thousand tokens, every follow-up call resends every prior message and pays input tokens for all of them. **Context compaction** lets you shrink those messages into a single opaque item that preserves the salient state — system prompts, attached files, prior reasoning, and a compacted record of the turns — while dropping the verbose tool output and back-and-forth.

You then pass that compaction item back into your next request verbatim, and the model continues the conversation as if the full history were still there.

* **Lower input cost** — the next call only pays for the compacted context, not the original messages.
* **Lower latency** — smaller payloads mean faster time-to-first-token.
* **Sharper responses** — a tighter context keeps the model focused on the current task instead of getting distracted by stale tool output and old turns.
* **Longer conversations** — keep multi-hour agent loops well under the model's context window.

> [!NOTE]
>
> Treat `encrypted_content` as **opaque** — do not parse or modify it. You can store the blob in your own database and pass it back unchanged in later requests; it is only meaningful when sent back to xAI's API.

## When to compact

Compact when **all** of the following are true:

* The conversation has grown large enough that `input_tokens` on each call is hurting cost or latency.
* You still want the model to remember prior turns (otherwise just start a new conversation).
* The current window still fits within the model's context limit (compaction shrinks the conversation — it cannot rescue a request that is already over the limit).

A typical pattern is to call the Compaction API every N turns inside an agent loop, or once whenever your bookkeeping shows the rendered context above a threshold you've chosen for your workload.

## Compaction API

Send the conversation you want to compact. The response contains a single compaction item that stands in for the entire prior conversation — you can safely drop the original messages from your client-side state, use the compaction item as the head of your next request, and append your new user turn after it.

```bash customLanguage="bash"
# Step 1 — compact the long conversation
curl -s https://api.x.ai/v1/responses/compact \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.6",
    "input": [
      {"role": "system", "content": "You are a concise and knowledgeable science tutor."},
      {"role": "user", "content": "What is the Higgs boson and why is it important?"},
      {"role": "assistant", "content": "The Higgs boson is an elementary particle..."},
      {"role": "user", "content": "How does the Higgs mechanism actually work?"},
      {"role": "assistant", "content": "The Higgs mechanism works through spontaneous symmetry breaking..."}
    ]
  }'

# Step 2 — continue the conversation using the compacted output
curl -s https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.6",
    "input": [
      {
        "type": "compaction",
        "id": "cmp_abc123",
        "encrypted_content": "<paste encrypted_content from step 1>"
      },
      {"role": "user", "content": "Based on our earlier conversation, what gives particles their mass?"}
    ]
  }'
```

```python customLanguage="pythonXAI"
import os
from xai_sdk import Client
from xai_sdk.chat import system, user

client = Client(api_key=os.environ["XAI_API_KEY"])

# Build up a chat normally — system prompt plus a few user/assistant turns.
# use_encrypted_content=True is recommended for reasoning models so the model's
# reasoning content from prior turns is preserved through the compaction.
chat = client.chat.create(model="grok-4.6", use_encrypted_content=True)
chat.append(system("You are a concise and knowledgeable science tutor."))

chat.append(user("What is the Higgs boson and why is it important?"))
chat.append(chat.sample())

chat.append(user("How does the Higgs mechanism actually work?"))
chat.append(chat.sample())

# ... many more turns ...

# Step 1 — compact the conversation. Pass the chat's accumulated messages
# straight into compact_context.
compact = client.chat.compact_context(
    model="grok-4.6",
    messages=chat.messages,
)
print(f"Compaction ID:    {compact.id}")
print(f"Dropped messages: {compact.dropped_message_count}")
print(f"Tokens used:      {compact.usage.total_tokens}")

# Step 2 — continue the conversation. chat.append(compact) clears the
# in-memory message list on the chat object and seeds it with just the
# compaction blob, so subsequent chat.sample() calls run on top of the
# compacted context instead of replaying the full prior history.
chat.append(compact)
chat.append(user("Based on our earlier conversation, what gives particles their mass?"))
print(chat.sample().content)
```

```python customLanguage="pythonOpenAISDK"
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["XAI_API_KEY"],
    base_url="https://api.x.ai/v1",
)

# Step 1 — compact the long conversation
compacted = client.responses.compact(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are a concise and knowledgeable science tutor."},
        {"role": "user", "content": "What is the Higgs boson and why is it important?"},
        {"role": "assistant", "content": "The Higgs boson is an elementary particle..."},
        {"role": "user", "content": "How does the Higgs mechanism actually work?"},
        {"role": "assistant", "content": "The Higgs mechanism works through spontaneous symmetry breaking..."},
    ],
)

print(f"Compaction ID:    {compacted.id}")
print(f"Dropped messages: {compacted.usage.dropped_message_count}")
print(f"Output tokens:    {compacted.usage.output_tokens}")

# Step 2 — continue the conversation. Spread compacted.output into the next input.
followup = client.responses.create(
    model="grok-4.6",
    input=[
        *compacted.output,  # use the compaction item verbatim — do not modify
        {"role": "user", "content": "Based on our earlier conversation, what gives particles their mass?"},
    ],
)

print(followup.output_text)
```

```javascript customLanguage="javascriptOpenAISDK"
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

// Step 1 — compact the long conversation
const compacted = await client.responses.compact({
  model: "grok-4.6",
  input: [
    { role: "system", content: "You are a concise and knowledgeable science tutor." },
    { role: "user", content: "What is the Higgs boson and why is it important?" },
    { role: "assistant", content: "The Higgs boson is an elementary particle..." },
    { role: "user", content: "How does the Higgs mechanism actually work?" },
    { role: "assistant", content: "The Higgs mechanism works through spontaneous symmetry breaking..." },
  ],
});

console.log(`Compaction ID:    ${compacted.id}`);
console.log(`Dropped messages: ${compacted.usage.dropped_message_count}`);
console.log(`Output tokens:    ${compacted.usage.output_tokens}`);

// Step 2 — continue the conversation. Spread compacted.output into the next input.
const followup = await client.responses.create({
  model: "grok-4.6",
  input: [
    ...compacted.output, // use the compaction item verbatim — do not modify
    { role: "user", content: "Based on our earlier conversation, what gives particles their mass?" },
  ],
});

console.log(followup.output_text);
```

The xAI SDK also exposes an `AsyncClient` with `await client.chat.compact_context(...)` and `await chat.sample()` for the same flow under `asyncio`.

### Response shape

The REST endpoint (`POST /v1/responses/compact`) returns an OpenAI-compatible compaction object:

```json
{
  "id": "cmp_01HZ9P0V8M2YQK3F7C4G6N5R2A",
  "object": "response.compaction",
  "created_at": 1748895600,
  "model": "grok-4.6",
  "output": [
    {
      "type": "compaction",
      "id": "cmp_01HZ9P0V8M2YQK3F7C4G6N5R2A",
      "encrypted_content": "<opaque blob>"
    }
  ],
  "usage": {
    "input_tokens": 12000,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens": 800,
    "output_tokens_details": { "reasoning_tokens": 240 },
    "total_tokens": 12800,
    "dropped_message_count": 45
  }
}
```

| Field | Description |
|---|---|
| `id` | Stable ID for this compaction (`cmp_<uuid>`). Also echoed on the inner compaction item. |
| `object` | Always `"response.compaction"`. |
| `output` | An array containing a **single** compaction item. Pass it verbatim into your next request. |
| `output[].type` | Always `"compaction"`. |
| `output[].encrypted_content` | Opaque blob containing the compacted conversation. |
| `usage.input_tokens` | Tokens in the pre-compaction conversation. |
| `usage.output_tokens` | Tokens generated for the compacted record. The blob the model rehydrates on the next call is roughly your preserved system prompt(s) plus this many tokens. |
| `usage.dropped_message_count` | Number of input messages folded into the compaction. |

> [!WARNING]
>
> **Do not prune the compaction output.** Treat the returned compaction item as the new "start" of the conversation — append new user turns after it, never before. Removing or reordering items inside the compacted output breaks the chain.

## In-place compaction in the xAI SDK

For long-running agent loops, the xAI SDK has a convenience method on a live `Chat` object: `chat.compact()` runs compaction against the chat's current messages and **replaces** them in-place with the compaction item. You can keep calling `chat.sample()` afterwards exactly as before — the server will rehydrate the compacted prefix on the next request.

```python customLanguage="pythonXAI"
import os
from xai_sdk import Client
from xai_sdk.chat import system, user

client = Client(api_key=os.environ["XAI_API_KEY"])

# use_encrypted_content=True preserves the model's reasoning content across
# turns, recommended when using reasoning models.
chat = client.chat.create(model="grok-4.6", use_encrypted_content=True)
chat.append(system("You are a helpful assistant. Keep answers brief."))

compact_every = 5
for turn in range(1, 100):
    chat.append(user(input("You: ")))
    response = chat.sample()
    print(f"Grok: {response.content}")
    chat.append(response)

    if turn % compact_every == 0:
        before = len(chat.messages)
        compact = chat.compact()
        print(
            f"[compacted {before} → {len(chat.messages)} messages | "
            f"dropped {compact.dropped_message_count} | "
            f"tokens used: {compact.usage.total_tokens}]"
        )
```

The same method is available on `AsyncClient` as `await chat.compact()`.

## Limits and gotchas

* **The conversation you compact must already fit in context.** Compaction shrinks the conversation; it does not rescue an over-limit request. If your conversation is already past `context_length_exceeded`, you'll need to prune or split before calling compact.
* **At most one compaction per call.** The endpoint does one compaction pass per request.
* **`encrypted_content` is opaque.** Do not parse, edit, or hand-merge multiple blobs. Always pass the full `output` array (or `CompactContextResponse`) back verbatim.
* **Re-compacting is fine.** You can compact an already-compacted conversation again later — for example, when the conversation grows long *after* the previous compaction.
* **Token usage on the compaction call.** The compaction itself uses tokens (visible in `usage.input_tokens` / `usage.output_tokens`). Pick a smaller / faster model for compaction if you are doing it frequently.

## Related

* [Generate Text — Responses API](/developers/model-capabilities/text/generate-text) — the primary endpoint that compaction feeds into.
* [Prompt Caching](/developers/advanced-api-usage/prompt-caching) — a complementary cost-reduction lever for unchanged prompt prefixes.
* [Chat API Reference](/developers/rest-api-reference/inference/chat) — full request/response schema for the Compaction API.

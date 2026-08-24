#### Prompt Caching

# What Breaks Caching

Any change to earlier messages breaks the cache. Only append new messages at the end.

> [!WARNING]
>
> **Keep messages unchanged.** For cache hits in multi-turn conversations, never edit, remove, or reorder earlier messages — only append new ones. For reasoning models, you **must** include `reasoning_content` from previous responses; omitting it is the top cause of cache misses.

For reasoning models, you can maintain cache hits by either:

* **Sending back the encrypted reasoning content** — Include the `reasoning_content` from the previous response. See [Encrypted Reasoning Content](/developers/model-capabilities/text/reasoning#encrypted-reasoning-content) for details.
* **Using stateful responses** — Use `previous_response_id` to automatically continue the conversation. See [Chaining the Conversation](/developers/model-capabilities/text/generate-text#chaining-the-conversation) for details.

## &#x20;Cache hit — appending a new message

The prompt prefix is identical to the previous request, with only a new user message appended:

```bash customLanguage="bash" addedLines="26"
# Turn 1: Initial request (establishes the cache)
curl https://api.x.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "x-grok-conv-id: conv_abc123" \
  -d '{
    "model": "grok-4.6",
    "messages": [
      {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
      {"role": "user", "content": "What is prompt caching?"},
      {"role": "assistant", "content": "Prompt caching stores KV pairs from unchanged prompt prefixes so they can be reused on subsequent requests. This makes responses faster and cheaper."}
    ]
  }'

# Turn 2: Cache HIT — exact prefix preserved, new message appended
curl https://api.x.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "x-grok-conv-id: conv_abc123" \
  -d '{
    "model": "grok-4.6",
    "messages": [
      {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
      {"role": "user", "content": "What is prompt caching?"},
      {"role": "assistant", "content": "Prompt caching stores KV pairs from unchanged prompt prefixes so they can be reused on subsequent requests. This makes responses faster and cheaper."},
      {"role": "user", "content": "Show me a code example."}
    ]
  }'
```

```python customLanguage="pythonOpenAISDK"
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_XAI_API_KEY",
    base_url="https://api.x.ai/v1",
)

conversation_id = "conv_abc123"
messages = [
    {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
    {"role": "user", "content": "What is prompt caching?"},
]

# Turn 1: Initial request (establishes the cache)
response = client.chat.completions.create(
    model="grok-4.6",
    messages=messages,
    extra_headers={"x-grok-conv-id": conversation_id},
)
print(f"Turn 1 — Cached tokens: {response.usage.prompt_tokens_details.cached_tokens}")

# Append the assistant's reply and the next user message
messages.append({"role": "assistant", "content": response.choices[0].message.content})
messages.append({"role": "user", "content": "Show me a code example."})

# Turn 2: Cache HIT — prefix is unchanged, only new messages appended
response = client.chat.completions.create(
    model="grok-4.6",
    messages=messages,
    extra_headers={"x-grok-conv-id": conversation_id},
)
print(f"Turn 2 — Cached tokens: {response.usage.prompt_tokens_details.cached_tokens}")
```

```javascript customLanguage="javascriptOpenAISDK"
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_XAI_API_KEY',
  baseURL: 'https://api.x.ai/v1',
});

const conversationId = 'conv_abc123';
const messages = [
  {
    role: 'system',
    content:
      'You are Grok, a helpful and truthful AI assistant built by xAI.',
  },
  { role: 'user', content: 'What is prompt caching?' },
];

// Turn 1: Initial request (establishes the cache)
const turn1 = await client.chat.completions.create(
  { model: 'grok-4.6', messages },
  { headers: { 'x-grok-conv-id': conversationId } },
);
console.log(
  `Turn 1 — Cached tokens: ${turn1.usage.prompt_tokens_details.cached_tokens}`,
);

// Append the assistant reply and next user message
messages.push({ role: 'assistant', content: turn1.choices[0].message.content });

messages.push({ role: 'user', content: 'Show me a code example.' });

// Turn 2: Cache HIT — prefix unchanged, new message appended
const turn2 = await client.chat.completions.create(
  { model: 'grok-4.6', messages },
  { headers: { 'x-grok-conv-id': conversationId } },
);
console.log(
  `Turn 2 — Cached tokens: ${turn2.usage.prompt_tokens_details.cached_tokens}`,
);
```

## &#x20;Cache miss — editing an earlier message

Changing the content of any earlier message breaks the prefix match:

```bash customLanguage="bash" deletedLines="11" addedLines="12"
# Cache MISS — editing the assistant message content
curl https://api.x.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "x-grok-conv-id: conv_abc123" \
  -d '{
    "model": "grok-4.6",
    "messages": [
      {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
      {"role": "user", "content": "What is prompt caching?"},
      {"role": "assistant", "content": "Prompt caching stores KV pairs from unchanged prompt prefixes so they can be reused on subsequent requests. This makes responses faster and cheaper."},
      {"role": "assistant", "content": "It stores KV pairs."},
      {"role": "user", "content": "Show me a code example."}
    ]
  }'
```

**What changed:** The assistant response on line 11 was shortened to `"It stores KV pairs."` (line 12).

## &#x20;Cache miss — removing a message

Removing any message from the conversation breaks the prefix:

```bash customLanguage="bash" deletedLines="11"
# Cache MISS — the assistant message was removed
curl https://api.x.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "x-grok-conv-id: conv_abc123" \
  -d '{
    "model": "grok-4.6",
    "messages": [
      {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
      {"role": "user", "content": "What is prompt caching?"},
      {"role": "assistant", "content": "Prompt caching stores KV pairs from unchanged prompt prefixes so they can be reused on subsequent requests. This makes responses faster and cheaper."},
      {"role": "user", "content": "Show me a code example."}
    ]
  }'
```

**What changed:** The assistant message on line 11 was removed entirely.

## &#x20;Cache miss — reordering messages

Changing the order of messages also breaks the prefix:

```bash customLanguage="bash" deletedLines="9,10" addedLines="9,10"
# Cache MISS — user and system messages are swapped
curl https://api.x.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "x-grok-conv-id: conv_abc123" \
  -d '{
    "model": "grok-4.6",
    "messages": [
      {"role": "user", "content": "What is prompt caching?"},
      {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
      {"role": "assistant", "content": "Prompt caching stores KV pairs from unchanged prompt prefixes so they can be reused on subsequent requests. This makes responses faster and cheaper."},
      {"role": "user", "content": "Show me a code example."}
    ]
  }'
```

**What changed:** Lines 9 and 10 were swapped — the user message now comes before the system message.

## Next

* [Usage & Pricing](/developers/advanced-api-usage/prompt-caching/usage-and-pricing)

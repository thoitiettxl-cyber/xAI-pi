#### Prompt Caching

# Maximizing Cache Hits

## Set `x-grok-conv-id` (Chat Completions API)

The `x-grok-conv-id` HTTP header routes requests with the same conversation ID to the same server. Since cache entries are stored per-server, this maximizes your cache hit rate.

```bash customLanguage="bash"
curl https://api.x.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "x-grok-conv-id: conv_abc123" \
  -d '{
    "model": "grok-4.6",
    "messages": [
      {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
      {"role": "user", "content": "What is prompt caching?"}
    ]
  }'
```

```python customLanguage="pythonOpenAISDK"
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_XAI_API_KEY",
    base_url="https://api.x.ai/v1",
)

response = client.chat.completions.create(
    model="grok-4.6",
    messages=[
        {"role": "system", "content": "You are Grok, a helpful and truthful AI assistant built by xAI."},
        {"role": "user", "content": "What is prompt caching?"},
    ],
    extra_headers={
        "x-grok-conv-id": "conv_abc123",
    },
)

print(response.choices[0].message.content)
print(f"Cached tokens: {response.usage.prompt_tokens_details.cached_tokens}")
```

```javascript customLanguage="javascriptOpenAISDK"
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_XAI_API_KEY',
  baseURL: 'https://api.x.ai/v1',
});

const response = await client.chat.completions.create(
  {
    model: 'grok-4.6',
    messages: [
      {
        role: 'system',
        content:
          'You are Grok, a helpful and truthful AI assistant built by xAI.',
      },
      { role: 'user', content: 'What is prompt caching?' },
    ],
  },
  {
    headers: {
      'x-grok-conv-id': 'conv_abc123',
    },
  },
);

console.log(response.choices[0].message.content);
console.log(
  `Cached tokens: ${response.usage.prompt_tokens_details.cached_tokens}`,
);
```

## Set `prompt_cache_key` (Responses API)

For the Responses API, use the `prompt_cache_key` field directly in the request body. It functions identically to setting `x-grok-conv-id` — it routes requests to the same server for cache reuse.

```bash customLanguage="bash"
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.6",
    "input": "What is prompt caching?",
    "prompt_cache_key": "b79ad29b-b3f9-463c-bca6-041d5058d366"
  }'
```

```python customLanguage="pythonOpenAISDK"
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_XAI_API_KEY",
    base_url="https://api.x.ai/v1",
)

response = client.responses.create(
    model="grok-4.6",
    input="What is prompt caching?",
    extra_body={
        "prompt_cache_key": "b79ad29b-b3f9-463c-bca6-041d5058d366",
    },
)

print(response.output_text)
print(f"Cached tokens: {response.usage.input_tokens_details.cached_tokens}")
```

```javascript customLanguage="javascriptOpenAISDK"
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_XAI_API_KEY',
  baseURL: 'https://api.x.ai/v1',
});

const response = await client.responses.create({
  model: 'grok-4.6',
  input: 'What is prompt caching?',
  // @ts-expect-error -- xAI-specific field
  prompt_cache_key: 'b79ad29b-b3f9-463c-bca6-041d5058d366',
});

console.log(response.output_text);
console.log(
  `Cached tokens: ${response.usage.input_tokens_details.cached_tokens}`,
);
```

```javascript customLanguage="javascriptAISDK"
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text, usage } = await generateText({
  model: xai.responses('grok-4.6'),
  prompt: 'What is prompt caching?',
  providerOptions: {
    xai: {
      promptCacheKey: 'b79ad29b-b3f9-463c-bca6-041d5058d366',
    },
  },
});

console.log(text);
console.log(`Total tokens: ${usage.totalTokens}`);
```

## Set `x-grok-conv-id` metadata (gRPC API)

For the gRPC API using the xAI SDK, pass `x-grok-conv-id` as gRPC metadata to enable sticky routing for cache reuse.

```python customLanguage="pythonXAI"
from xai_sdk import Client
from xai_sdk.chat import system, user

client = Client(
    api_key="YOUR_API_KEY",
    metadata=(("x-grok-conv-id", "conv_abc123"),),
)

chat = client.chat.create(model="grok-4.6")
chat.append(system("You are Grok, a helpful and truthful AI assistant built by xAI."))
chat.append(user("What is prompt caching?"))

response = chat.sample()
print(f"Response: {response.content}")
print(f"Cached tokens: {response.usage.cached_prompt_text_tokens}")
```

## Next

* [What Breaks Caching](/developers/advanced-api-usage/prompt-caching/multi-turn)

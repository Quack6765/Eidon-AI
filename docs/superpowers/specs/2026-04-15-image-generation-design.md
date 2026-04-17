# Image Generation Design

## Goal

Add straightforward text-to-image generation to Eidon with a ChatGPT/Gemini-like composer toggle, while keeping the Docker image lean and the implementation narrowly scoped.

## Scope

Included:

- Add a global image generation backend setting in **Settings -> General**
- Add a composer image-mode toggle next to the persona selector
- Treat image generation as a per-send mode within normal conversations
- Support follow-up image requests using recent conversation context
- Store generated images as normal Eidon attachments under `/app/data`
- Support two v1 backends:
  - Google Nano Banana
  - Remote ComfyUI

Not included:

- Bundling any image model or generator into Eidon's Docker image
- Reference-image editing or image-to-image flows
- Inpainting, outpainting, upscaling, or video generation
- An OpenAI image backend in v1
- Per-conversation or per-user backend selection
- A full ComfyUI workflow editor
- Routing image generation through provider profiles

## Product Decisions

- Image generation is configured once for the whole instance, similar to web search.
- Generated images must be persisted locally as Eidon attachments so they remain available from the conversation history even if the remote backend is unavailable later.
- The composer image icon is a per-send mode toggle, not a separate conversation type.
- Conversations may mix normal chat turns and image-generation turns.
- When image mode is enabled for a send, Eidon should use recent conversation history as context for the request.

## Backend Naming

Google's image-generation capability should be presented in the UI as **Google Nano Banana**, not plain "Gemini", even though it is accessed through the Gemini API.

Recommended UI/backend labels:

- `Google Nano Banana`
- `Remote ComfyUI`
- `Disabled`

Recommended Google model labels:

- `Nano Banana` -> `gemini-2.5-flash-image`
- `Nano Banana 2` -> `gemini-3.1-flash-image-preview`
- `Nano Banana Pro` -> `gemini-3-pro-image-preview`

Default recommendation:

- default to `Nano Banana 2` unless product requirements later show that `Nano Banana Pro` is worth the higher default cost/latency profile

## Architecture

Image generation should be a separate app-level capability with its own global settings and runtime entry point.

The implementation should introduce a narrow interface such as:

```ts
type GenerateImageRequest = {
  conversationId: string;
  userId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  seed?: number;
  count?: number;
};

type GenerateImageResult = {
  assistantText?: string;
  images: Array<{
    bytes: Buffer;
    mimeType: string;
    filename: string;
  }>;
};
```

Backends:

- `GoogleNanoBananaBackend`
- `ComfyUiImageBackend`

This keeps backend-specific transport logic isolated and makes a later `OpenAiImageBackend` adapter possible without changing the conversation or storage model after v1.

## Settings Model

Add app-level image generation settings to general settings storage and sanitization. These should live alongside the existing web search settings rather than inside provider profiles.

Suggested fields:

- `imageGenerationBackend`: `disabled | google_nano_banana | comfyui`
- `googleNanoBananaApiKey`
- `googleNanoBananaModel`
- `comfyuiBaseUrl`
- `comfyuiAuthType`: `none | bearer`
- `comfyuiBearerToken`
- `comfyuiWorkflowJson`
- `comfyuiPromptMapping`
- `comfyuiNegativePromptMapping`
- `comfyuiWidthMapping`
- `comfyuiHeightMapping`
- `comfyuiSeedMapping`

The settings UI should add a new **Image Generation** card under **Web Search** on the general settings page.

### Google Nano Banana settings

Keep this intentionally small:

- API key
- model selector

Do not expose many tuning knobs in v1 unless implementation shows they are trivial and stable.

### Remote ComfyUI settings

Keep this intentionally constrained so Eidon does not become a ComfyUI workflow product:

- base URL
- optional bearer token
- one saved API-format workflow JSON template
- field mappings for prompt and a small set of optional parameters
- a test action that validates connectivity and confirms that at least one image can be produced by the configured workflow

Admins are expected to prepare the workflow externally and paste the API-format JSON into Eidon.

## Conversation And Composer UX

The chat composer gets a small image-generation icon next to the persona selector.

Behavior:

- when the icon is off, send uses the normal chat path
- when the icon is on, the next send uses the image generation path
- the conversation remains a normal conversation, not a separate image-only thread
- later sends can toggle between normal chat and image mode freely

The user still types in the normal composer text box. No separate image-generation screen is required.

The UI should make it obvious when image mode is enabled for the next send, but the composer should not become a different product surface.

## Prompt Compilation And Orchestration

The feature needs to support multi-turn follow-ups such as:

- "same concept, but darker"
- "change the style to watercolor"
- "keep the subject but make it widescreen"

Google Nano Banana can accept conversational context directly and can return text plus image. Remote ComfyUI cannot; it is a workflow runner rather than a conversational model.

To keep behavior consistent across both backends, Eidon should introduce an orchestration step before backend invocation.

Flow for an image-mode send:

1. Persist the user message normally in the conversation.
2. Collect recent conversation context plus the current message.
3. Ask the active chat provider to compile that context into a structured image request.
4. Validate the structured request.
5. Send the request to the configured global image backend.
6. Download returned image bytes into Eidon attachments.
7. Create an assistant message with any returned assistant text, or a short default message if none is present.
8. Bind the generated attachments to that assistant message.

Suggested structured output from the orchestration step:

```ts
type CompiledImageInstruction = {
  imagePrompt: string;
  negativePrompt?: string;
  assistantText?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  seed?: number;
  count?: number;
};
```

This design intentionally keeps conversational understanding in Eidon's existing chat model layer and keeps image backends focused on image generation only.

## Google Nano Banana Adapter

Use the Gemini API with the configured Nano Banana model ID.

Behavior:

- submit the compiled prompt to the selected Google model
- prefer image output only for the backend call unless implementation benefits from also capturing text output
- decode returned bytes and normalize them into the attachment pipeline

Even though Google can support richer conversational image flows, Eidon should still use the orchestration layer so behavior matches ComfyUI and the product remains predictable.

## Remote ComfyUI Adapter

Treat ComfyUI as an advanced remote backend with a narrow contract.

Behavior:

- clone the saved workflow JSON
- inject the compiled values into the mapped workflow fields
- queue the workflow via `/prompt`
- monitor completion via `/ws`
- fetch results via `/history/{prompt_id}` and `/view`
- convert returned images into Eidon attachments

Implementation boundary:

- support one administrator-supplied API-format workflow template
- do not attempt workflow discovery
- do not attempt generic graph editing
- do not expose arbitrary node editing in the UI

This makes ComfyUI support possible without turning the feature into a second product.

## Persistence And Attachment Handling

Generated images must reuse the existing attachment system.

Requirements:

- save generated files under the existing attachments root in `/app/data`
- create normal `message_attachments` rows
- attach generated files to the assistant message for the turn
- preserve compatibility with existing transcript preview, modal viewing, downloading, conversation forking, and deletion flows

Generated images should therefore behave exactly like uploaded image attachments once stored.

## Error Handling

- If image generation is disabled globally, the composer should block image-mode sends with a clear inline error.
- If the backend configuration is incomplete, fail before calling the backend and show a configuration-specific error.
- If prompt compilation fails, create an assistant error turn instead of silently dropping the send.
- If the backend returns an error, persist the user turn and create an assistant error turn.
- If image bytes are returned but local storage fails, treat the turn as failed and surface a storage error.
- For ComfyUI, malformed mappings and workflow output mismatches should fail fast during settings validation/testing where possible.

## Testing

Add or update tests for:

- general settings schema and persistence for image generation config
- sanitization behavior for secret fields
- prompt compilation/orchestration behavior using prior conversation context
- Google Nano Banana adapter success and failure paths
- ComfyUI adapter success and failure paths with mocked queue/history/view responses
- attachment persistence for generated files
- composer image-mode toggle behavior
- transcript rendering and preview behavior for generated image attachments

End-to-end coverage should include:

- one Google-backed happy path using mocked API responses
- one ComfyUI-backed happy path using mocked workflow responses
- one failure case showing the assistant error behavior

## Files Expected To Change

- `components/chat-composer.tsx`
- `components/settings/sections/general-section.tsx`
- `app/api/settings/general/route.ts`
- `lib/settings.ts`
- `lib/types.ts`
- `lib/assistant-runtime.ts`
- `lib/chat-turn.ts`
- new image generation runtime files under `lib/`
- unit tests for settings, adapters, orchestration, and composer behavior
- e2e coverage for image-generation flows

## Sources

- Google Gemini image generation docs: https://ai.google.dev/gemini-api/docs/image-generation
- Google Gemini API generate content docs: https://ai.google.dev/api/generate-content
- Google Gemini API key docs: https://ai.google.dev/gemini-api/docs/api-key
- Google Nano Banana Pro announcement: https://blog.google/innovation-and-ai/products/nano-banana-pro/
- ComfyUI websocket API example: https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py

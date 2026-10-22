# Content Engine featured-image model selection — 2026-10-22

## Decision

Retain `gemini-3.1-flash-image` as the source-code and deployed default for this isolated candidate. Nano Banana 2.1 is the preferred migration target, but it is not selected for this release because the current worker is pinned to `google-genai>=1.20,<2` and uses `models.generate_content`, while Google's current 2.1 examples use the newer Interactions API. A model-recognition check does not prove compatibility with that exact generation path.

The existing production setting is `gemini-3.1-flash-image` (Nano Banana 2). All four compared model IDs were recognized on the `content-engine-prod` Vertex AI global endpoint through non-generative `countTokens` checks on 2026-10-22. No image was generated and no paid quality test was performed. The recognition checks prove model availability only; they do not validate the current SDK's image-generation call shape.

## Comparison

| Model | Model ID | Published role and typography | Published standard 1K image price | Compatibility result |
| --- | --- | --- | --- | --- |
| Nano Banana 2.1 | `gemini-nano-banana-2.1` | Google's current high-efficiency workhorse; improved prompt adherence and text rendering | about $0.0336 | Vertex global endpoint recognized the model |
| Nano Banana 2 | `gemini-3.1-flash-image` | Previous-generation high-efficiency workhorse; current KOBA-I production setting | about $0.067 | Vertex global endpoint recognized the model; current pipeline is already compatible |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | Lowest-latency/cost option; optimized for scale rather than complex reference or multi-turn work | about $0.0336 | Vertex global endpoint recognized the model |
| Nano Banana Pro | `gemini-3-pro-image` | Highest creative control, brand consistency, complex layouts, and precise text rendering | about $0.134 | Vertex global endpoint recognized the model |

Prices are public list prices from Google's Gemini API pricing page as observed on 2026-10-22 and may differ by billing tier, API surface, region, batch mode, or negotiated agreement. Production cost must be confirmed against the actual Cloud Billing SKU before changing the deployed model.

## Compatibility and quality boundaries

- The worker uses the Google Gen AI SDK with Vertex AI, global location, `models.generate_content`, IMAGE response modality, 16:9 output, and JPEG output. This exact path is already established for Nano Banana 2.
- Google's current Nano Banana 2.1 examples use `client.interactions.create`. Compatibility with the worker's pinned pre-v2 SDK and current response parsing is therefore unproven and must fail closed rather than be inferred from model discovery.
- The non-generative endpoint checks establish model recognition, not quota, successful image generation, latency, or final typography quality for KOBA-I prompts.
- Google's documentation reports improved text rendering for Nano Banana 2.1 and precise text rendering for Pro. KOBA-I has not made an empirical typography claim because paid generation was not authorized.
- The candidate keeps the existing WordPress media upload, draft staging, retry reconciliation, Jetpack-facing WordPress workflow, and deployed model unchanged.

## Sources

- Google image generation and model selection: https://ai.google.dev/gemini-api/docs/image-generation
- Google model catalog: https://ai.google.dev/gemini-api/docs/models
- Google API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Vertex/Agent Platform model locations: https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations
- Nano Banana 2.1 model information: https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1


## Error Handling

- Wrap critical UI trees in Error Boundaries.
- Provide user-friendly error messages with recovery options.
- Write extensive `console.log` statements for debugging.

## Unit Testing Strategy

### Test-First Mode

- **When adding new features:** write or update unit tests first, then code to green.
- **Prefer component tests** for UI state changes.
- **For regressions:** add a failing test that reproduces the bug, then fix to green.
# Coding Agent Rules & Guidelines

## General Principles
- **Action Over Talk**: Prioritize doing work over explaining it.
- **Minimalist Aesthetic**: Follow a clean, light-themed, minimalist design language. Use ample whitespace, subtle borders, and refined typography.
- **Component-Driven**: Build modular, reusable React components.

## Dependencies & Environment
- **React**: ^19.0.0
- **Vite**: ^6.2.0
- **Tailwind CSS**: ^4.1.14 (Use for all styling)
- **Framer Motion**: ^12.23.24 (Use for smooth transitions and layout animations)
- **Lucide React**: ^0.546.0 (Use for icons)
- **openai**: ^6.33.0 (Use for Azure OpenAI API calls via AzureOpenAI client)

## AI Service Layer
- The AI service is in `src/services/azure-openai.ts`
- It uses the `openai` npm package configured for Azure (`AzureOpenAI` client)
- All structured outputs use Zod schemas + `zodResponseFormat`
- Environment variables are injected at build time via `vite.config.ts` `define` block
- Required env vars: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT_NAME`

## Unit Testing Strategy

### Test-first mode
- when adding new features: write or update unit tests first, then code to green
- prefer component tests for UI state changes
- for regressions: add a failing test that reproduces the bug, then fix to green

## Code Structure
- `/src/components/`: Reusable UI components.
- `/src/services/`: API and external service integrations.
  - `azure-openai.ts` — primary AI service (Azure OpenAI)
  - `ai.ts` — legacy Gemini service (not used, kept for type exports)

## Validation & Reliability Rules
- After every code update, run full-project verification to ensure all functionality works correctly together:
  - `npm run lint`
  - `npm test`
  - `npm run build`
- Mandatory localhost preview link on every task completion:
  - Always provide a working and active localhost URL in the final response.
  - Before sharing the URL, verify a listener exists on that port and verify the page responds.
  - Preferred flow for app projects: run `npm run dev` and use its active local URL.
  - Fallback flow for static pages or when dev tooling is unavailable: run `python3 -m http.server <PORT> --directory .` and share `http://127.0.0.1:<PORT>/`.
- Treat this localhost link as required output for every completed task in this repository.

## Enneagram Copy Source (Hardcoded)
- Moving forward, when making updates, use copy/language from `docs/enneagram-master-source.txt`.
- Treat `docs/enneagram-master-source.txt` as the canonical wording source for Enneagram concepts, labels, and descriptions.
- If existing UI copy conflicts with the master source, update it to align with the master source language.
- If you encounter the runtime/tooling error `stream disconnected before completion: response.failed event received`, continue the task and retry or proceed with the next safe step instead of stopping.

## Streaming Failure Retry Policy (Hardcoded)
- Treat `stream disconnected before completion: response.failed event received` as transient unless repeated after max retries.
- Retry up to `5` times before surfacing failure.
- Use exponential backoff delays of `0.5s`, `1s`, `2s`, `4s`, `8s` (cap at `20s`).
- Add retry jitter of `+/-20%` to reduce collision bursts.
- Prefer retry for transient classes: connection errors, `408`, `409`, `429`, and `5xx`.
- Use request timeout windows of `5-10 minutes` for long AI generations.
- Break large AI tasks into smaller chunks to reduce stream duration and failure risk.
- Log each retry attempt with attempt count, delay, and error class.

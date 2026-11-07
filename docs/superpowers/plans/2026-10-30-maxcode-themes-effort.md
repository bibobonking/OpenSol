# OpenSol Themes and Effort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three named themes, restyle Light and Dark, and replace DeepThink with model-supported reasoning effort controls.

**Architecture:** Expand the persisted theme identifiers and map each to CSS custom properties applied at the document root. Remove the DeepThink setting and make provider adapters derive reasoning parameters directly from the selected model's advertised effort or token-budget controls.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind CSS, Vite, Vitest.

**Spec:** [2026-10-30-maxcode-plugins-themes-chat-design.md](../specs/2026-10-30-maxcode-plugins-themes-chat-design.md)

## Global Constraints

- Add `Night owl`, `Claude code`, and `Flame` while preserving `system`.
- “Use CSS variables for all five named palettes; `system` resolves to Light or Dark according to the OS preference.”
- “Update Light to neutral black/white and Dark to legible near-black/neutral shades.”
- “Remove DeepThink toggles/defaults.”
- “Show effort only when the selected live model advertises a supported effort or token-budget control.”
- “Send the corresponding provider field automatically; preserve provider defaults for models that expose no user-adjustable control.”
- Normalize old persisted settings without breaking existing chats.

## Review Focus

- Existing persisted `system`, `light`, and `dark` settings still hydrate — test in Task 1.
- Unknown theme IDs fall back safely and invalid values are rejected by daemon settings sanitization — test in Task 1.
- Light/Dark and all named palettes define readable semantic tokens and syntax highlighting — test token coverage in Task 1, then verify visually.
- Models with no reasoning controls send no unsupported provider field — test in Task 2.
- Budget-only and effort-only models map effort to the correct provider payload without DeepThink — test in Task 2.

---

### Task 1: Adding and applying the theme palettes

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/settings.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/index.css`
- Create: `src/lib/themes.ts`
- Create: `src/lib/themes.test.ts`
- Modify: `server/daemon.mjs`

**Interfaces:**
- Produces `ThemeId = 'light' | 'dark' | 'system' | 'night-owl' | 'claude-code' | 'flame'`.
- Produces `resolveTheme(theme: ThemeId, prefersDark: boolean): Exclude<ThemeId, 'system'>`.
- All five named palettes use the existing semantic CSS variables (`canvas`, `panel`, `raised`, `line`, `ink`, `muted`, `faint`, `accent`, `accent-soft`, `success`, `warning`, `danger`); `system` resolves to Light or Dark based on OS preference.

- [ ] **Step 1: Write failing tests** for legacy theme hydration, each supported ID, invalid IDs, and `system` resolution for both OS preferences.
- [ ] **Step 2: Run `npm test -- --run src/lib/themes.test.ts`** and confirm the resolver/normalization tests fail.
- [ ] **Step 3: Add the theme IDs and resolver, and update daemon theme allowlisting.** Keep old saved `light`, `dark`, and `system` values valid.
- [ ] **Step 4: Define the five semantic palettes in `src/index.css`.** Light uses neutral black/white; Dark uses legible neutral near-black without brown; add palette-specific syntax-highlight overrides.
- [ ] **Step 5: Update App theme application, settings swatches, and command-palette toggling** to use theme IDs/resolution rather than treating all themes as one `.dark` boolean.
- [ ] **Step 6: Run `npm test -- --run src/lib/themes.test.ts`** and confirm tests pass; visually inspect every palette in Settings and Chat.

### Task 2: Replacing DeepThink with provider-supported effort

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/settings.ts`
- Modify: `src/lib/reasoning.ts`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/ModelPicker.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/agent/adapters/openai.ts`
- Modify: `src/agent/adapters/openai-responses.ts`
- Modify: `src/agent/adapters/anthropic.ts`
- Modify: `src/agent/adapters/gemini.ts`
- Modify: `server/daemon.mjs`
- Create: `src/lib/reasoning.test.ts`

**Interfaces:**
- Removes `deepThink` from `AppSettings`, defaults, and persisted patches; old data is normalized without requiring a destructive migration.
- Effort UI derives its choices from `effortOptions(model)` and is absent when the model advertises no adjustable effort/budget.
- Provider adapters send only controls advertised for the selected model.

- [ ] **Step 1: Write failing tests** for effort-only, budget-only, toggle-only, and no-control models, asserting the resulting OpenAI, Responses, Anthropic, and Gemini reasoning payloads.
- [ ] **Step 2: Run `npm test -- --run src/lib/reasoning.test.ts`** and confirm the new payload tests fail.
- [ ] **Step 3: Update settings normalization and persistence** to ignore legacy `deepThink`; update reasoning helpers so effort alone determines supported reasoning configuration.
- [ ] **Step 4: Update each provider adapter** to send the advertised effort or mapped budget without a DeepThink gate; preserve provider defaults and avoid unsupported fields.
- [ ] **Step 5: Replace composer/model-picker/settings DeepThink controls** with the appropriate effort selector and explanatory provider/model information.
- [ ] **Step 6: Run `npm test -- --run src/lib/reasoning.test.ts`** and confirm all provider payload tests pass.
- [ ] **Step 7: Run `npm run typecheck` and `npm run build`** and confirm both pass.

### Task 3: Verifying and documenting theme/effort behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the theme names and model-dependent effort behavior** in the existing feature overview.
- [ ] **Step 2: Run `npm test -- --run`, `npm run typecheck`, and `npm run build`** and confirm all pass.
- [ ] **Step 3: Manually verify** system-following behavior, each theme, existing saved settings, and provider-specific effort payload selection.

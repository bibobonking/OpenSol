# OpenSol Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local `.pluginmax` builder/installer and a reviewed plugin API with sandboxed preview, explicit Safe activation, workspace capabilities, and declared-domain requests.

**Architecture:** A shared ZIP/manifest module validates packages in the browser and daemon. The daemon stores packages and grants under `MAXCODE_DATA`, while the React app provides a sandboxed preview, a plugin manager, a capability bridge, and same-realm activation only after explicit trust confirmation.

**Tech Stack:** Node.js 20+, React 19, TypeScript, Vite, Node HTTP daemon, `fflate` for ZIP encoding/decoding, Vitest for focused unit tests.

**Spec:** [2026-10-30-maxcode-plugins-themes-chat-design.md](../specs/2026-10-30-maxcode-plugins-themes-chat-design.md)

## Global Constraints

- “Treat `.pluginmax` as a ZIP-format package with a validated `manifest.json`, one JavaScript entry file, one CSS file, and optional local assets.”
- “installation accepts a local file only.”
- “Do not expose an arbitrary shell or unrestricted filesystem API.”
- “Require separate user grants for each requested workspace capability and declared network domain.”
- “Safe is an explicit trust choice, not a claim that same-realm JavaScript is sandboxed or harmless.”
- Do not add a remote plugin marketplace or automatic plugin downloads.
- Preserve the daemon's loopback binding, session/CSRF checks, and existing workspace path validation.

## Review Focus

- ZIP traversal, duplicate entries, malformed manifests, or oversized assets are rejected — test in Task 1.
- A changed manifest cannot reuse stale trust or domain grants — test in Task 2.
- Undeclared hosts and redirects to undeclared/private destinations are rejected — test in Task 2.
- Preview cannot access app-origin storage or direct external network — test in Task 3.
- Disabling/uninstalling a plugin removes its active CSS, handlers, and grants — test in Task 3.

---

### Task 1: Validating and building `.pluginmax` packages

**Files:**
- Create: `shared/plugin-package.mjs`
- Create: `shared/plugin-package.d.mts`
- Create: `shared/plugin-package.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `PluginManifest`, `PluginPackageSources`, and `PluginPackage` types for UI and daemon consumers.
- Produces `buildPluginArchive(sources: PluginPackageSources): Uint8Array`, `readPluginArchive(bytes: Uint8Array): PluginPackage`, and `validatePluginManifest(value: unknown): PluginManifest`.

- [ ] **Step 1: Write failing tests** for valid package round-trip; missing/invalid entry paths; duplicate paths; traversal paths; undeclared files; invalid domains/capabilities; and configured compressed/uncompressed size limits.
- [ ] **Step 2: Run `npm test -- --run shared/plugin-package.test.ts`** and confirm the new tests fail because the package functions do not exist.
- [ ] **Step 3: Add `fflate` and Vitest test scripts/configuration, then implement the shared ZIP/manifest functions.** Limit executable files to the manifest-declared JS/CSS entries; reject remote imports and unsafe archive paths.
- [ ] **Step 4: Run `npm test -- --run shared/plugin-package.test.ts`** and confirm all package tests pass.

### Task 2: Persisting plugins, grants, and domain-mediated requests

**Files:**
- Create: `server/lib/plugins.mjs`
- Create: `server/lib/plugins.test.ts`
- Modify: `server/daemon.mjs`
- Modify: `server/README.md`

**Interfaces:**
- Consumes the package types/functions from Task 1.
- Produces `listPlugins()`, `installPlugin(bytes)`, `setPluginGrants(id, grants)`, `setPluginSafe(id, safe)`, `setPluginEnabled(id, enabled)`, `uninstallPlugin(id)`, and `requestPluginNetwork(id, request)`.
- Adds authenticated routes for listing/installing, grant review, Safe/enable state, uninstall, and mediated plugin requests.

- [ ] **Step 1: Write failing tests** for local install/list/uninstall; grant persistence; changed-manifest grant invalidation; declared-host enforcement; redirect rejection; attachment/executable response rejection; and request timeout/size limits.
- [ ] **Step 2: Run `npm test -- --run server/lib/plugins.test.ts`** and confirm the new service behavior is missing.
- [ ] **Step 3: Implement plugin storage below `DATA_DIR/plugins`, grant state keyed to a manifest hash, and daemon routes.** Validate all request bodies, hostnames, redirect destinations, response sizes, and content types server-side; do not expose shell or paths outside the active workspace.
- [ ] **Step 4: Run `npm test -- --run server/lib/plugins.test.ts`** and confirm all server plugin tests pass.
- [ ] **Step 5: Document the local-only installer, trust boundary, workspace permissions, and network limitations in `server/README.md`.**

### Task 3: Previewing, granting, and activating plugins

**Files:**
- Create: `src/plugins/types.ts`
- Create: `src/plugins/api.ts`
- Create: `src/plugins/runtime.ts`
- Create: `src/plugins/preview.ts`
- Create: `src/components/PluginManager.tsx`
- Modify: `src/lib/daemon.ts`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/App.tsx`
- Create: `src/plugins/runtime.test.ts`

**Interfaces:**
- Consumes the package and daemon APIs from Tasks 1–2.
- Produces a versioned plugin API for commands, panels/settings, themes, workspace list/read/write/edit operations, and declared-domain requests.
- Preview executes in an iframe with scripts enabled, no same-origin access, no direct network access, and a validated `MessageChannel` bridge.
- Safe activation requires an explicit confirmation; grants for each capability/domain are reviewed separately.

- [ ] **Step 1: Write failing tests** for bridge message validation, capability denial, preview-to-host message isolation, Safe confirmation state, manifest-change re-consent, and cleanup when disabled/uninstalled.
- [ ] **Step 2: Run `npm test -- --run src/plugins/runtime.test.ts`** and confirm the runtime tests fail before implementation.
- [ ] **Step 3: Implement the permission-aware host API and sandboxed preview.** Keep plugin storage under daemon data, not the workspace. On Safe activation, load the approved plugin JS/CSS into the app realm; remove registered handlers and styles on disable.
- [ ] **Step 4: Implement Plugin Manager UI** for local `.pluginmax` import, package details, preview, domain/capability review, Safe confirmation, enable/disable, and uninstall.
- [ ] **Step 5: Run `npm test -- --run src/plugins/runtime.test.ts`** and confirm all runtime tests pass.

### Task 4: Building packages and end-to-end verification

**Files:**
- Create: `src/components/PluginBuilder.tsx`
- Modify: `src/components/PluginManager.tsx`
- Modify: `src/index.css`
- Modify: `README.md`

**Interfaces:**
- Consumes `buildPluginArchive` from Task 1 and plugin API types from Task 3.
- Produces a local builder flow that packages manifest, JavaScript, CSS, and optional local assets into a downloadable `.pluginmax`.

- [ ] **Step 1: Add a builder test** proving a generated `.pluginmax` can be re-opened by `readPluginArchive` and that source assets are preserved.
- [ ] **Step 2: Implement the builder UI** with manifest validation and a local download; never fetch or install a package from a remote registry.
- [ ] **Step 3: Run `npm test -- --run`** and confirm the complete test suite passes.
- [ ] **Step 4: Run `npm run typecheck` and `npm run build`** and confirm both pass.
- [ ] **Step 5: Manually verify** preview isolation, separately granted domains/capabilities, Safe warning, package import/export, and disable/uninstall cleanup.

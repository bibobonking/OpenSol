# MaxCode plugins, themes, and chat flow

## Intent

Make MaxCode extensible through locally installed `.pluginmax` packages, improve
the built-in themes and reasoning controls, and present each agent response as
one coherent turn with tool activity grouped in place.

## Goals

- Let users test a local plugin in a sandbox, then explicitly mark it Safe to
  run its JavaScript in the MaxCode app realm.
- Support plugin JavaScript and CSS, an in-app way to package those sources as
  `.pluginmax`, local installation, enable/disable, and removal.
- Let plugins contribute UI and workspace-oriented utilities through a
  documented MaxCode API. Plugins declare network domains in their manifest;
  users review those declarations at install/activation.
- Add Night owl, Claude code, and Flame themes; make Light black-and-white and
  Dark neutral near-black, without the current brown palette.
- Replace DeepThink with the provider/model-supported effort control.
- Remove the MaxCode avatar beside its assistant messages, without changing
  other identities/icons.
- Render one assistant response per user turn. Keep each tool batch as a
  compact Used group in its chronological position; show another group if the
  agent calls tools again after continuing.

## Non-goals

- A remote plugin marketplace, automatic plugin downloads, or installing
  packages from a registry.
- Rewriting or recompiling MaxCode's React source from a plugin.
- Giving plugins unrestricted shell or arbitrary access to files outside the
  active workspace.
- Changing provider protocol history or the existing tool approval policy.

## Current state and constraints

- The frontend is React/TypeScript with Zustand. `src/agent/index.ts` appends a
  new assistant message for every model/tool round; `ChatView.tsx` renders each
  one, and `MessageItem.tsx` groups tools only under the immediately preceding
  assistant message. This explains the fragmented display. Keep the underlying
  provider-compatible messages intact and aggregate their presentation by user
  turn.
- `src/store/settings.ts` stores `deepThink` separately from `effort`; adapters
  often send effort only when DeepThink is enabled. Theme support currently
  relies on `light`, `dark`, and `system` CSS variables.
- The daemon serves the app with a restrictive CSP and constrains file and
  shell tools to the selected workspace. This request must not weaken those
  existing restrictions for normal app operation.
- The user selected same-app-realm execution after Safe, workspace-scoped
  capabilities, and manifest-declared network domains. Safe therefore means
  the user trusts that plugin's code; it is not a security sandbox. Same-realm
  JavaScript can access browser globals and app UI internals. CSP and the
  plugin network API can restrict supported network paths, but cannot provide
  an absolute guarantee against a malicious same-realm plugin or prevent it
  from abusing other app capabilities. The UI must communicate this boundary.

## Approaches considered

1. **Capability-based plugin sandbox:** keep every plugin isolated and provide
   a narrow API. Stronger security, but does not match the user's chosen
   same-realm Safe behavior.
2. **Same-realm trusted plugins with workspace APIs (selected):** sandbox for
   preview; explicit Safe activation runs JS in the app realm. The supported
   API exposes UI contributions and workspace-scoped functions, and network
   access is declared and mediated by MaxCode. This best matches the request,
   with a clear trust warning and no promise of resistance to malicious code
   after Safe.
3. **Unrestricted OS-process plugins:** broad machine access, but conflicts
   with workspace-only operation and reliable network policy, and introduces
   platform-specific process isolation. Not selected.

## Proposed design

### Plugin package and lifecycle

- Treat `.pluginmax` as a ZIP-format package with a validated `manifest.json`,
  one JavaScript entry file, one CSS file, and optional local assets. Reject
  path traversal, duplicate/unknown executable entries, oversized packages,
  malformed manifests, and packages that declare remote code or automatic
  downloads.
- Add an in-app plugin builder that accepts a plugin manifest plus JS/CSS
  sources and exports `.pluginmax`; installation accepts a local file only.
- Store installed plugin files and trust/enable state under the MaxCode data
  directory, not inside the selected project workspace.
- Plugin manager shows identity, declared domains, requested capabilities, and
  current state. New plugins start disabled and sandboxed for testing. A
  separate Safe action explains the same-realm risk and requires confirmation.
  Preview runs in an isolated iframe with scripts enabled, no same-origin
  access, and no direct network access; it communicates with the host only
  through a validated message bridge. Users can disable or uninstall a plugin.
- Give plugins a versioned API for commands, settings/panels, themes, and
  workspace-scoped read/write/edit/list operations. Do not expose an arbitrary
  shell or unrestricted filesystem API.
- Require separate user grants for each requested workspace capability and
  declared network domain. Safe trusts the plugin's code but does not silently
  approve new capabilities. A changed manifest invalidates grants for changed
  declarations and requires review again.
- Mediate plugin network requests through a daemon endpoint that validates the
  plugin identity and exact declared host, blocks redirects to undeclared
  hosts, rejects attachment/executable/archive responses, and applies
  request/response size and timeout limits. Do not provide a download-to-disk
  API. Explain that Safe same-realm code is trusted and this policy is not a
  defense against malicious code: it cannot reliably prevent a plugin from
  writing permitted network response data to permitted workspace files.

### Themes and effort

- Extend the theme setting and migration/validation to support `night-owl`,
  `claude-code`, and `flame`, while preserving `system`.
- Use CSS variables for all five named palettes; `system` resolves to Light or
  Dark according to the OS preference. Keep existing component
  semantics, but update Light to neutral black/white and Dark to legible
  near-black/neutral shades. Apply model-editor and markdown syntax colors for
  every theme.
- Remove DeepThink toggles/defaults. Show effort only when the selected live
  model advertises a supported effort or token-budget control. Send the
  corresponding provider field automatically; preserve provider defaults for
  models that expose no user-adjustable control. Normalize old persisted
  settings without breaking existing chats.

### Chat presentation

- Keep the raw assistant/tool message sequence and round IDs needed by model
  adapters. Build a view-level turn representation between user messages:
  combine assistant text/reasoning into one MaxCode response and place each
  contiguous tool batch at its chronological position as a separate Used
  group. A tool-only round must not create an empty assistant bubble.
- Keep streaming, approvals, stop/cancel, errors, retry, and tool result
  ordering attached to the correct user turn. Remove only the MaxCode assistant
  avatar, not unrelated provider or workspace icons.
- Treat back-to-back user submissions during an active run as a separate
  queue. Process queued user turns sequentially, with each agent run limited to
  its own submitted turn so it cannot consume a later queued prompt early.
  Preserve submission order and do not silently lose messages when
  `runAgent` is already active.

## Verification

- Add focused tests for plugin archive/manifest validation, declared-domain
  checks, theme normalization, and turn grouping (including tool-only rounds,
  repeated tool batches, stop/error states, and legacy chat data).
- Run `npm run typecheck` and `npm run build`. Manually verify plugin preview
  and Safe confirmation, theme switching, effort payload selection, streaming
  continuity, approvals, and retry behavior.

## Builder calls

- Use ZIP as the `.pluginmax` container and JSON for its manifest.
- Build and install plugins through local UI flows; do not add a marketplace or
  network-based installer.
- Run preview in an isolated iframe; Safe explicitly switches to same-realm
  execution only after user confirmation.
- Store grants per plugin and per declared capability/domain; require review
  again when a manifest changes its requests.
- Queue user turns submitted while an earlier turn is active and process each
  turn in order.
- Keep model-history structures unchanged and solve fragmented answers in the
  chat presentation layer.
- Safe is an explicit trust choice, not a claim that same-realm JavaScript is
  sandboxed or harmless.

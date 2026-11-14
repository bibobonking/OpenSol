# OpenSol Chat Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present each user submission as one coherent assistant turn, group every tool batch in chronological `Used` sections, and queue new submissions while a turn is active.

**Architecture:** Keep the existing provider-compatible assistant/tool messages in storage. Add a pure view-model function that segments messages into user turns and assistant/tool segments, and serialize agent execution per session using the submitted user-message ID as a turn boundary.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest.

**Spec:** [2026-10-30-maxcode-plugins-themes-chat-design.md](../specs/2026-10-30-maxcode-plugins-themes-chat-design.md)

## Global Constraints

- “Render one assistant response per user turn.”
- “Keep each tool batch as a compact Used group in its chronological position; show another group if the agent calls tools again after continuing.”
- “Keep the raw assistant/tool message sequence and round IDs needed by model adapters.”
- “Process queued user turns sequentially, with each agent run limited to its own submitted turn so it cannot consume a later queued prompt early.”
- Preserve streaming, approvals, stop/cancel, errors, retry, and tool result ordering.
- Remove only the OpenSol assistant avatar; do not remove unrelated identities/icons.

## Review Focus

- Tool-only rounds render as Used groups without empty assistant bubbles — test in Task 1.
- Multiple assistant/tool rounds in one user turn render in chronological order inside one response container — test in Task 1.
- A new submission during a running turn is neither consumed early nor lost — test in Task 2.
- Stop, approval denial, and tool errors still produce a valid provider history and finish the correct turn — test in Task 2.
- Regenerating a turn does not replay a queued later submission — test in Task 2.

---

### Task 1: Grouping messages into a single rendered assistant turn

**Files:**
- Create: `src/lib/conversation.ts`
- Create: `src/lib/conversation.test.ts`
- Modify: `src/components/ChatView.tsx`
- Modify: `src/components/MessageItem.tsx`
- Modify: `src/components/ToolCallCard.tsx`

**Interfaces:**
- Produces `ConversationTurn` with `user: UserMessage` and ordered `segments: Array<{ kind: 'assistant'; message: AssistantMessage } | { kind: 'tools'; tools: ToolMessage[] }>`; turns are delimited by user messages.
- Produces `groupConversationTurns(messages: Message[]): ConversationTurn[]`.
- Existing raw messages remain unchanged for adapter history and persistence.

- [ ] **Step 1: Write failing tests** for a plain answer, tool-only round, answer→tools→answer, repeated tool batches, multiple user turns, and orphan tool messages.
- [ ] **Step 2: Run `npm test -- --run src/lib/conversation.test.ts`** and confirm the grouping tests fail because the view model does not exist.
- [ ] **Step 3: Implement `groupConversationTurns`** preserving chronological assistant/tool segments and excluding orphan tool results from invented assistant content.
- [ ] **Step 4: Render one response container per turn** in ChatView, placing each `UsedGroup` between the assistant segments that preceded/followed it. Keep tool approval/error/active state in each group.
- [ ] **Step 5: Remove the OpenSol `LogoMark` from assistant message rendering only.** Preserve any non-OpenSol icon paths.
- [ ] **Step 6: Run `npm test -- --run src/lib/conversation.test.ts`** and confirm all grouping tests pass.

### Task 2: Queueing submissions and bounding agent history by turn

**Files:**
- Modify: `src/agent/index.ts`
- Modify: `src/components/ChatView.tsx`
- Modify: `src/store/ui.ts`
- Create: `src/agent/queue.test.ts`

**Interfaces:**
- Produces `queueAgentTurn(sessionId: string, userMessageId: string): Promise<void>` and a private `runAgentTurn(sessionId, userMessageId)` implementation.
- Every run builds provider history only through its submitted user message; the next queued turn starts after the preceding turn completes.
- `regenerateLastTurn(sessionId)` queues the latest user message after trimming its old assistant/tool output.

- [ ] **Step 1: Write failing tests** for ordered turns; user submissions made during a stream; tool rounds not consuming a later user message; stop/error completion; and regeneration with a later queued turn.
- [ ] **Step 2: Run `npm test -- --run src/agent/queue.test.ts`** and confirm the new queue tests fail.
- [ ] **Step 3: Add a per-session serial queue** keyed by submitted user-message ID. Snapshot/cap history at that turn so an active response cannot answer a later prompt prematurely.
- [ ] **Step 4: Update ChatView send and regeneration paths** to enqueue exactly one run per submitted user message. Keep runtime streaming/queued indicators accurate and surface queue failures.
- [ ] **Step 5: Run `npm test -- --run src/agent/queue.test.ts`** and confirm all scheduling tests pass.

### Task 3: End-to-end chat verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document** that tools from multiple agent rounds are shown under one assistant turn and queued user submissions run in order.
- [ ] **Step 2: Run `npm test -- --run`, `npm run typecheck`, and `npm run build`** and confirm all pass.
- [ ] **Step 3: Manually verify** streaming text before/after repeated tool groups, approval allow/deny, stop, errors, retry, regeneration, and two quick submissions in one session.

# Create page daemon-state alignment design

## Summary

Fix the create-page regressions where:

- the runner cannot be switched reliably before the first launch
- the first query does not launch/send the same way as `origin/main`

The root cause is that the create-page flow currently mixes daemon session state with local UI-derived state (`querySent`, `ptyEverActive`, `providerSessionId`-based heuristics). The fix is to make the daemon session state the only business source of truth for create-page behavior and keep local state limited to transient UI concerns.

## Goals

- Allow runner switching only when the daemon session is still in the pre-runtime create flow.
- Ensure the first query follows a single daemon-driven path: bootstrap/launch, resume, or send input.
- Make create-page overlay visibility match daemon session state instead of local heuristics.
- Preserve the existing UI shape and keep the fix minimal.

## Non-goals

- No broader session architecture refactor.
- No new compatibility layer between UI and daemon.
- No redesign of `SessionPromptComposer` beyond prop changes needed for state display.
- No workflow behavior changes outside the create-page/session launch path.

## Root cause

The current flow derives behavior from a mixture of local flags and partial daemon information:

- `useSessionRunnerController.ts` tracks `querySent`, `ptyEverActive`, `launchPrompt`, and `launchResumeSessionId`
- `SessionDetail.tsx` independently derives `waitingForPtyLaunch`
- runner switching is gated by `isBootstrapSession` and local session fields instead of a single daemon state model
- first-query behavior depends on whether the PTY is ready and whether local launch state has been inferred correctly

This creates race-prone behavior:

- the UI may think a session has already “started” and block runner switching even though the daemon session is still effectively in create mode
- the first prompt may be queued in local state while the daemon state implies a different launch path
- the overlay may stay visible or disappear based on `providerSessionId` heuristics instead of actual daemon lifecycle state

## Design

### 1. Daemon-driven derived flags in `useSessionRunnerController`

Add a small set of derived booleans computed from `daemonSession?.state` and stable session fields:

- `canSwitchRunner`
- `shouldShowComposer`
- `shouldShowQueuedLaunch`
- `shouldLaunchFromDraft`
- `shouldResume`
- `shouldSendInput`

These flags replace mixed local heuristics for create-page decisions.

Expected state mapping:

- `draft`, `preparing_worktree`, `ready` => create flow; composer can be shown; runner may be switched; first query should bootstrap/launch
- `launching` => queued/launching state; composer remains visible only as a disabled queued state if needed by current UX
- `running`, `waiting_input`, `approval_required`, `interrupted` => runtime flow; composer hidden; runner switch disabled; prompt submission routes to runtime input behavior where applicable
- `completed`, `failed`, `cancelled` => not part of create flow; composer visibility follows existing idle/error handling expectations, but not create-page heuristics

If daemon state is temporarily absent for a draft UI session, fall back only to the minimum session fields needed to preserve the draft path. This fallback is transitional and should not reintroduce local business heuristics.

### 2. Restrict local state to UI concerns

Keep local state only for:

- `pendingQuery`
- input focus and refs
- install-runner UI state
- short-lived bridge state needed to hand the first prompt to the runtime surface once the PTY is ready

`querySent` and `ptyEverActive` should no longer determine business behavior such as whether the session is still in create mode, whether the runner can switch, or whether the first prompt should launch or send input.

### 3. Runner switching behavior

Update `handleSwitchRunner` so it uses daemon-driven `canSwitchRunner` instead of local `isBootstrapSession`/started inference.

Behavior:

- while the daemon session is still in draft/preparing/ready, the runner switch updates both daemon provider and local session runner config
- once the daemon session has entered runtime/launching states, switching is disabled
- switching clears any stale local launch bridge state that could incorrectly carry over a previous runner decision

This keeps the badge, daemon provider, and actual launched runner aligned.

### 4. First-query submission flow

Update `handleSubmitQuery` to follow one daemon-driven dispatch path:

1. trim and store the current prompt for UI display
2. update daemon task title/prompt
3. branch by daemon-derived launch mode:
   - `shouldLaunchFromDraft` => bootstrap if needed, then launch
   - `shouldResume` => resume session
   - `shouldSendInput` => send session input
4. keep only the minimum bridge state required to deliver the initial prompt once the runtime surface is ready

The first prompt should no longer rely on `querySent` becoming the de facto business trigger.

### 5. Create-page overlay and queued-launch behavior

Move create-page visibility decisions behind controller-owned daemon-derived flags and pass them into `SessionDetail.tsx`.

`SessionDetail.tsx` should stop recomputing create-flow conditions from raw session fields such as `providerSessionId`.

UI behavior:

- create-page composer visible in draft/preparing/ready
- queued/disabled state shown during launching if the current UX still wants the overlay visible while the first instruction is being handed off
- runtime surface becomes authoritative in running/waiting/approval/interrupted states

This removes duplicated state interpretation between controller and view.

## File-level changes

### `apps/desktop/src/hooks/useSessionRunnerController.ts`

Primary fix location.

Changes:

- derive create/runtime flags from `daemonSession?.state`
- simplify `isBootstrapSession` and related started-state heuristics
- update `handleSwitchRunner` to gate on daemon-derived `canSwitchRunner`
- update `handleSubmitQuery` to route by daemon-derived action
- narrow the role of `querySent`, `ptyEverActive`, `launchPrompt`, and `launchResumeSessionId`
- expose the new derived flags to the view layer

### `apps/desktop/src/components/SessionDetail.tsx`

Changes:

- stop deriving `waitingForPtyLaunch` from `querySent` + `ptyEverActive` + `providerSessionId`
- consume controller-provided flags for:
  - whether the composer is shown
  - whether launch is queued/disabled
  - whether runner switch controls are enabled

### `apps/desktop/src/services/daemonCommands.ts`

Only change if a thin helper is needed for readability. Do not add a new abstraction layer or compatibility shim.

### `apps/desktop/src/components/session/SessionPromptComposer.tsx`

No behavioral logic changes unless small prop additions are needed to reflect queued/disabled state.

## Testing strategy

Verify at least these scenarios:

1. Create a new session and switch runners before first launch.
2. After switching runners, confirm the badge, daemon provider, and actual launch target all match.
3. Submit the first query from the create page and confirm it launches/sends like `origin/main`.
4. Once the session is in running or waiting state, confirm runner switching is no longer available.
5. Confirm the create-page overlay exits based on daemon lifecycle progression rather than `providerSessionId` heuristics.

## Risks and mitigations

### Risk: missing daemon state during initial render
Mitigation: allow a minimal fallback only for pre-launch draft sessions, and keep the fallback narrow enough that it cannot become a second business state machine.

### Risk: first prompt lost between launch and PTY readiness
Mitigation: keep a small launch bridge for the pending first prompt, but let daemon-derived dispatch decide whether launch/resume/send is required.

### Risk: behavior drift from current runtime sessions
Mitigation: constrain changes to create-page gating and first-prompt dispatch; do not change workflow or post-launch runtime behavior.

## Acceptance criteria

The fix is complete when:

- the create page can switch runner whenever the daemon session is still pre-runtime
- the first prompt reliably launches and is delivered using daemon-driven dispatch
- create-page visibility is controlled by daemon session state instead of local heuristics
- the behavior matches `origin/main` expectations for first-query submission without reintroducing non-daemon state ownership

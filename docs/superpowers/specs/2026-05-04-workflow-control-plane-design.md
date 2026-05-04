# Workflow control-plane redesign

## Summary

Redesign workflow from a confusing session-adjacent feature into a spec-first orchestration control plane for larger engineering tasks.

The workflow system should behave like a scaled-up superpower lifecycle:

1. define and confirm a spec
2. decompose it into explicit steps
3. assign those steps across a group of CLI sessions
4. observe progress, approvals, blockers, and recovery from a single control surface

The top-level model is not “one smart session with hidden helpers.” It is “one explicit workflow coordinating many explicit CLI execution slots.” Session-local subagents remain allowed as an internal acceleration tactic, but they are not the product’s primary orchestration model.

## Goals

- Make the product information architecture understandable on first entry.
- Make workflow a first-class object independent from sessions.
- Preserve session-first usage for current users without keeping session as the parent model.
- Make git/mainline freshness visible throughout workflow and execution.
- Define workflow as the control plane for larger multi-session engineering work.
- Keep the design compatible with future distributed execution, while focusing on local execution now.

## Non-goals

- No distributed worker architecture in this phase.
- No attempt to replace superpowers/skills with a new prompt system.
- No large workspace header relocation yet.
- No final visual styling pass; this document fixes object model and interaction structure first.
- No daemon/runtime protocol redesign in this phase unless directly required by the workflow model.

## Product thesis

Workflow is not a prettier task graph and not a hidden agent loop.

Workflow is a git-aware orchestration control plane for large engineering tasks. It starts with an approved spec, turns that spec into explicit steps, and then coordinates a group of CLI sessions that execute those steps.

This gives the product three properties that single-session flows do not provide reliably:

- explicit decomposition
- explicit ownership
- explicit observability

## Current problems

The current workflow experience is hard to understand because multiple concepts are mixed together:

- the left navigation mixes objects and work surfaces at the same hierarchy
- workflow, SCM, and explore feel session-derived while appearing parallel to sessions
- workflow entry does not clearly explain what the user should do first
- workflow and session relationships are not clear enough
- git freshness and remote-main alignment are not prominent enough

The result is that users cannot tell whether they are:

- operating on a session
- operating on a workflow task
- viewing a global project surface
- or executing a step within a larger orchestration

## Core design decisions

### 1. Navigation is object-first

The left-side primary navigation should express **objects**, not **functional surfaces**.

Primary objects for this phase:

- Sessions
- Workflows

Workspace remains visible as stable context above the session area for now, but it is not treated as another functional tab.

This means the product first answers **“what am I looking at?”** and only then answers **“which aspect of it do I want to inspect?”**

### 2. Explore / SCM / Workflow are not top-level siblings

Functional surfaces such as file exploration, git inspection, and workflow state should become **secondary views inside the selected object**, not peer items in the primary navigation.

This removes the current ambiguity where a surface appears global but behaves as if it were derived from the current session.

### 3. Workflow and session are separate first-class objects

Workflow is not a child page of a session.
Session is not the parent container of workflow.

They are parallel object types with different responsibilities:

- **Session** = execution object and local working context
- **Workflow** = orchestration object and control plane

A workflow may link to many sessions.
A session may link to one current workflow step or none.

### 4. Workflow is spec-first

Workflow should not begin by launching execution.
It should begin by clarifying and confirming the task spec.

The lifecycle remains conceptually:

- draft
- review
- confirmed
- running

The product should make this lifecycle visible and understandable before exposing execution controls.

### 5. Git freshness is a cross-cutting signal

Git/mainline health is not just an SCM panel concern. It should appear at:

- workspace context level
- session title/context level
- workflow title/context level

This is required because large workflow execution without mainline awareness becomes untrustworthy.

## Information architecture

## Workspace context header

Keep the current workspace placement near the session area for now, but redefine its role.

It should provide stable project context:

- current workspace name
- primary repo / root context
- main branch or remote-main health summary
- ahead / behind / dirty / conflict signals
- prompt to sync when the workspace is clearly stale

This header is not the main work surface. It is durable global context.

## Primary object list: Sessions

Sessions remain a first-class primary object because many users still start their work from a session.

Each session item should communicate only the essential status needed for triage:

- session name
- provider
- branch/worktree summary
- running/waiting/error state
- lightweight workflow linkage if applicable

Sessions should remain easy to access during the transition to a more workflow-centered model.

## Primary object list: Workflows

Workflows are the other first-class primary object.

Each workflow item should summarize:

- title
- lifecycle badge
- progress or completion summary
- blocker / approval signal
- optional session participation count

This makes workflow feel like a durable project object rather than a hidden mode of a session.

## Secondary navigation model

After selecting an object, use top-of-content tabs to switch between views of that object.

This is preferred over adding more left-side nesting because the left side already carries the burden of object selection.

## Session object views

When a session is selected, show these tabs:

- Run
- Changes
- Files
- Linked Workflow

### Session / Run

Purpose:

- show terminal/output/runtime state
- expose resume / retry / stop
- surface waiting/approval/interrupted state

This is the default session view.

### Session / Changes

Purpose:

- show the local diff for this session/worktree
- show changed files
- show branch/base context
- warn when this worktree is stale relative to mainline

This is a local git view, not the full workspace SCM surface.

### Session / Files

Purpose:

- show files most related to this session
- surface modified files and recent files
- provide reveal/open shortcuts

This is a local projection of exploration, not global explore.

### Session / Linked Workflow

Purpose:

- show the workflow task linked to this session
- show the current step assignment
- show step goal, success criteria, progress, blockers, and approvals

This is a bridge to orchestration, not the orchestration surface itself.

## Workflow object views

When a workflow is selected, show these tabs:

- Overview
- Graph
- Activity
- Execution

### Workflow / Overview

Purpose:

- explain what this workflow is
- show goal, constraints, success criteria
- show lifecycle stage
- show whether mainline freshness is acceptable
- show participating sessions summary
- present the next clear CTA

This should be the default workflow view. It is the answer to the current “I clicked workflow and still don’t know what to do” problem.

### Workflow / Graph

Purpose:

- visualize step DAG and dependencies
- show ownership and step/session assignment
- show parallelizable steps
- show approval gates

This is the main structural view of decomposition.

### Workflow / Activity

Purpose:

- show event timeline
- show diagnostics and blockers
- show lease, retry, approval, and recovery history

This is the “what happened and why is it stuck” view.

### Workflow / Execution

Purpose:

- show participating sessions
- show which session owns which step
- show attach/create/assign/start controls
- show running-state summary

Execution controls should be concentrated here instead of scattered across the workflow UI.

## Relationship model: workflow, superpowers, skills, and sessions

### Workflow

A workflow is the top-level orchestration object for a large engineering task.

It owns:

- spec
- step decomposition
- dependencies
- approvals
- execution assignment
- recovery/visibility context

### Superpowers / skills

Superpowers and skills remain the lower-level execution recipes.

They are not replaced by workflow. Instead:

- workflow organizes the larger task
- steps may require or recommend skills/superpowers
- a session executing a step may invoke those skills internally

This means workflow sits above skills rather than competing with them.

### Session

A session is an execution slot.

It claims or is assigned a step, performs the work, updates progress, and eventually completes, blocks, or requests approval.

A session may internally use subagents, but this is a local implementation detail of that session’s step execution.

## Orchestration model

The preferred top-level model is **multi-session orchestration**, not **one main session with mostly hidden subagent delegation**.

### Why multi-session is the top-level model

For large engineering work, multi-session orchestration is more suitable because it provides:

- glass-box ownership
- separate worktrees/branches
- explicit step assignment
- better observability
- better git reasoning
- a cleaner future path to distributed execution

### Why subagents still matter

Subagents are still useful inside a session for:

- scoped search
- local analysis
- constrained delegation
- temporary parallel help

But they should remain subordinate to the visible workflow/session model.

In product terms:

- **top level**: glass-box workflows coordinating multiple sessions
- **inside a session**: optional black-box subagent acceleration

## Git/mainline behavior

The product should actively help users stay aligned with remote main.

### Workspace level

Show a durable summary of:

- ahead/behind relative to remote main
- conflict state
- dirty state
- stale branch/worktree signals

### Session level

Warn when the session’s branch/worktree has drifted materially from its base or from main.

### Workflow level

Warn when the workflow spec or execution context is stale relative to mainline, especially before starting or continuing execution.

This design intentionally treats git awareness as part of workflow reliability, not as a side panel concern.

## Transition strategy

The product should not abruptly de-emphasize sessions, because existing users still work session-first.

Therefore the redesign should be progressive:

1. keep workspace header placement stable for now
2. keep sessions prominent and easy to access
3. add workflows as a parallel first-class object
4. move functional surfaces into object-level tabs
5. gradually shift larger tasks toward workflow-first execution without breaking session-first flows

## Phase-1 acceptance criteria

This redesign is directionally complete when:

- users can clearly distinguish Sessions from Workflows in the left-side object model
- selecting an object reveals clear top-level tabs for that object’s views
- the default workflow view explains what the workflow is and what the next action is
- session views expose local changes/files/workflow linkage without pretending to be global surfaces
- git/mainline freshness is visible at workspace, session, and workflow levels
- workflow is clearly framed as spec-first orchestration across multiple CLI sessions

## Open questions deferred to implementation planning

- exact left-rail visual grouping and density
- exact badge language for git freshness and lifecycle state
- whether Workflows should support further sub-grouping by lifecycle
- how much of global Explore/SCM remains accessible outside object views
- when to expose assignment controls inline in Graph versus only in Execution
- what structured outputs/artifacts should be first-class in phase 1

## Final design statement

Code Bar workflow should evolve into an object-first, spec-first, git-aware orchestration control plane.

Users should first understand which object they are looking at, then which view of that object they want, then what action is expected next. Workflow should confirm a spec, decompose the task, and coordinate multiple CLI sessions to execute it. That is the right architectural layer for larger tasks, while session-internal subagents remain an optional implementation detail rather than the primary product model.

// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import { formatGitFreshness } from "./gitFreshness.ts";

test("formatGitFreshness reports behind-base branches as danger", () => {
  const vm = formatGitFreshness({
    currentBranch: "feature/workflow",
    baseBranch: "main",
    aheadCount: 2,
    behindCount: 3,
    dirty: false,
    conflicted: false,
  });

  assert.deepEqual(vm, {
    label: "Behind main by 3",
    detail: "Sync this branch with main before continuing larger workflow work.",
    tone: "danger",
  });
});

test("formatGitFreshness reports clean synchronized branches as success", () => {
  const vm = formatGitFreshness({
    currentBranch: "main",
    baseBranch: "main",
    aheadCount: 0,
    behindCount: 0,
    dirty: false,
    conflicted: false,
  });

  assert.deepEqual(vm, {
    label: "Synced to main",
    detail: "Mainline freshness looks good.",
    tone: "success",
  });
});

test("formatGitFreshness reports unknown base branches as neutral", () => {
  const vm = formatGitFreshness({
    currentBranch: "feature/workflow",
    baseBranch: null,
    aheadCount: 0,
    behindCount: 0,
    dirty: false,
    conflicted: false,
  });

  assert.deepEqual(vm, {
    label: "Branch health unavailable",
    detail: "Base branch is unknown.",
    tone: "neutral",
  });
});

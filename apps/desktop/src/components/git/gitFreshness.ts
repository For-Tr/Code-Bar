export interface GitBranchHealth {
  currentBranch: string | null;
  baseBranch: string | null;
  aheadCount: number;
  behindCount: number;
  dirty: boolean;
  conflicted: boolean;
}

export function formatGitFreshness(health: GitBranchHealth): {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  if (health.conflicted) {
    return {
      label: "Conflicts",
      detail: "Resolve conflicts before continuing workflow execution.",
      tone: "danger",
    };
  }

  if (!health.baseBranch) {
    return {
      label: "Branch health unavailable",
      detail: "Base branch is unknown.",
      tone: "neutral",
    };
  }

  const base = health.baseBranch;

  if (health.behindCount > 0) {
    return {
      label: `Behind ${base} by ${health.behindCount}`,
      detail: `Sync this branch with ${base} before continuing larger workflow work.`,
      tone: "danger",
    };
  }

  if (health.dirty) {
    return {
      label: "Uncommitted changes",
      detail: "This context has local changes that are not yet committed.",
      tone: "warning",
    };
  }

  if (health.aheadCount > 0) {
    return {
      label: `Ahead of ${base} by ${health.aheadCount}`,
      detail: `This branch has diverged from ${base}. Review before merging workflow output.`,
      tone: "warning",
    };
  }

  return {
    label: `Synced to ${base}`,
    detail: "Mainline freshness looks good.",
    tone: "success",
  };
}

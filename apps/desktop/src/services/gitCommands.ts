import { invoke } from "@tauri-apps/api/core";
import type { GitBranchHealth } from "../components/git/gitFreshness";

export function getGitBranchHealth(workdir: string, baseBranch?: string | null) {
  return invoke<GitBranchHealth>("git_branch_health", {
    workdir,
    baseBranch: baseBranch ?? null,
  });
}

import { useEffect, useState } from "react";
import { getGitBranchHealth } from "../../services/gitCommands";
import { formatGitFreshness, type GitBranchHealth } from "./gitFreshness";

const REFRESH_INTERVAL_MS = 15_000;

function badgeStyle(tone: "success" | "warning" | "danger" | "neutral") {
  if (tone === "success") {
    return {
      background: "var(--ci-green-bg)",
      color: "var(--ci-green-dark)",
      border: "1px solid var(--ci-green-bdr)",
    } as const;
  }
  if (tone === "warning") {
    return {
      background: "var(--ci-yellow-bg)",
      color: "var(--ci-yellow-dark)",
      border: "1px solid var(--ci-yellow-bdr)",
    } as const;
  }
  if (tone === "danger") {
    return {
      background: "var(--ci-deleted-bg)",
      color: "var(--ci-deleted-text)",
      border: "1px solid var(--ci-border-med)",
    } as const;
  }
  return {
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text-dim)",
    border: "1px solid var(--ci-toolbar-border)",
  } as const;
}

export function GitFreshnessBadge({
  workdir,
  baseBranch,
}: {
  workdir: string | null | undefined;
  baseBranch?: string | null;
}) {
  const [health, setHealth] = useState<GitBranchHealth | null>(null);

  useEffect(() => {
    if (!workdir || !("__TAURI_INTERNALS__" in window)) {
      setHealth(null);
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void getGitBranchHealth(workdir, baseBranch)
        .then((next) => {
          if (!cancelled) setHealth(next);
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    };

    refresh();
    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [baseBranch, workdir]);

  if (!health) return null;

  const vm = formatGitFreshness(health);
  const style = badgeStyle(vm.tone);

  return (
    <span
      title={vm.detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        ...style,
      }}
    >
      {vm.label}
    </span>
  );
}

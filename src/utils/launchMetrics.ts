type LaunchMetricDetails = Record<string, string | number | boolean | null | undefined>;

interface LaunchMetricState {
  startedAt: number;
}

const launchMetrics = new Map<string, LaunchMetricState>();

function formatDetails(details?: LaunchMetricDetails): string {
  if (!details) return "";
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function elapsedMs(sessionId: string): number {
  const current = launchMetrics.get(sessionId);
  if (current) return performance.now() - current.startedAt;

  const startedAt = performance.now();
  launchMetrics.set(sessionId, { startedAt });
  return 0;
}

function buildLine(sessionId: string, stage: string, details?: LaunchMetricDetails): string {
  const elapsed = elapsedMs(sessionId);
  return `[launch ${sessionId} +${elapsed.toFixed(1)}ms] ${stage}${formatDetails(details)}`;
}

export function beginLaunchMetric(
  sessionId: string,
  stage: string,
  details?: LaunchMetricDetails
): string {
  launchMetrics.set(sessionId, { startedAt: performance.now() });
  const line = `[launch ${sessionId} +0.0ms] ${stage}${formatDetails(details)}`;
  console.info(line);
  return line;
}

export function markLaunchMetric(
  sessionId: string,
  stage: string,
  details?: LaunchMetricDetails
): string {
  const line = buildLine(sessionId, stage, details);
  console.info(line);
  return line;
}

export function clearLaunchMetric(sessionId: string): void {
  launchMetrics.delete(sessionId);
}

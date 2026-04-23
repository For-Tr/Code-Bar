export function sanitizePtySegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function buildRunnerPtyId(sessionId: string) {
  return `runner:${sanitizePtySegment(sessionId)}`;
}

export function buildTerminalPtyId(sessionId: string, terminalId: string) {
  return `terminal:${sanitizePtySegment(sessionId)}:${sanitizePtySegment(terminalId)}`;
}

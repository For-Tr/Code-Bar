import { AnimatePresence, motion } from "framer-motion";
import { PtyTerminal } from "../PtyTerminal";

interface InstallTerminalProps {
  installId: string;
  installCmd: string;
  onFinished: () => void;
}

interface SessionRunnerSurfaceProps {
  isGlass: boolean;
  isOpen: boolean;
  installing: boolean;
  installId: string;
  installCmd?: string;
  recheckCli: () => void;
  querySent: boolean;
  ptyEverActive: boolean;
  sessionId: string;
  cliCommand: string;
  cliBaseArgs: string[];
  workdir: string;
  launchPrompt: string | null;
  supportsPromptLaunch: boolean;
  handlePtyReady: () => void;
  handlePtyWaiting: () => void;
  handlePtyRunning: () => void;
  handlePtyError: (error: string) => void;
  contextEnv: [string, string][];
  InstallTerminal: (props: InstallTerminalProps) => React.ReactNode;
}

export function SessionRunnerSurface({
  isGlass,
  isOpen,
  installing,
  installId,
  installCmd,
  recheckCli,
  querySent,
  ptyEverActive,
  sessionId,
  cliCommand,
  cliBaseArgs,
  workdir,
  launchPrompt,
  supportsPromptLaunch,
  handlePtyReady,
  handlePtyWaiting,
  handlePtyRunning,
  handlePtyError,
  contextEnv,
  InstallTerminal,
}: SessionRunnerSurfaceProps) {
  const installOverlayBackground = isGlass ? "transparent" : "var(--ci-pty-panel-bg)";
  const installStripBackground = isGlass ? "var(--ci-toolbar-bg)" : "transparent";
  const installPromptColor = isGlass ? "var(--ci-text-dim)" : "var(--ci-pty-mask-footer)";

  return (
    <>
      <AnimatePresence>
        {installing && installId && installCmd && (
          <motion.div
            key="install-terminal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            style={{
              position: "absolute", inset: 0, zIndex: 10,
              display: "flex", flexDirection: "column",
              background: installOverlayBackground,
            }}
          >
            <div style={{
              flexShrink: 0,
              padding: "8px 14px",
              borderBottom: isGlass ? "none" : "1px solid var(--ci-pty-titlebar-bdr)",
              background: installStripBackground,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 10, color: installPromptColor, fontFamily: "monospace" }}>$</span>
              <code style={{
                flex: 1, fontSize: 11,
                color: "rgba(251,191,36,0.8)",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {installCmd}
              </code>
            </div>
            <div style={{ flex: 1, overflow: "hidden", padding: isGlass ? 0 : "4px" }}>
              <InstallTerminal
                installId={installId}
                installCmd={installCmd}
                onFinished={recheckCli}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        padding: isGlass ? 0 : "8px 4px 4px",
        opacity: querySent && ptyEverActive ? 1 : 0,
        pointerEvents: querySent && ptyEverActive ? "auto" : "none",
      }}>
        <PtyTerminal
          sessionId={sessionId}
          command={cliCommand}
          args={cliBaseArgs}
          workdir={workdir}
          active={isOpen && querySent && ptyEverActive}
          initialPrompt={launchPrompt}
          supportsPromptArg={supportsPromptLaunch}
          onReady={handlePtyReady}
          onWaiting={handlePtyWaiting}
          onRunning={handlePtyRunning}
          onError={handlePtyError}
          env={contextEnv}
        />
      </div>
    </>
  );
}

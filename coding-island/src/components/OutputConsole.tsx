import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClaudeSession } from "../store/sessionStore";

const mono = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

interface Props {
  session: ClaudeSession;
}

export function OutputConsole({ session }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.output]);

  if (!session.output || session.output.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          borderTop: "1px solid var(--ci-border)",
          overflow: "hidden",
          background: "var(--ci-bg)",
        }}
      >
        <div style={{
          maxHeight: 160,
          overflowY: "auto",
          padding: "8px 14px",
          scrollbarWidth: "none",
        }}>
          <div style={{
            fontSize: 10,
            color: "var(--ci-text-dim)",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 6,
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}>
            输出
          </div>
          <pre style={{
            fontFamily: mono,
            fontSize: 11,
            lineHeight: "17px",
            color: "var(--ci-text-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
            padding: "6px 8px",
            background: "var(--ci-code-bg)",
            borderRadius: 7,
            border: "1px solid var(--ci-border)",
          }}>
            {session.output.join("\n")}
          </pre>
          <div ref={bottomRef} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

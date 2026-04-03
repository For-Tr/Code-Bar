import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClaudeSession } from "../store/sessionStore";

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
          borderTop: "1px solid rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        <div style={{
          maxHeight: 160,
          overflowY: "auto",
          padding: "8px 14px",
          background: "rgba(0,0,0,0.2)",
        }}>
          <div style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}>
            输出
          </div>
          <pre style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 11,
            lineHeight: "17px",
            color: "rgba(255,255,255,0.6)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
          }}>
            {session.output.join("\n")}
          </pre>
          <div ref={bottomRef} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

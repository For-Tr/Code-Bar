import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { useSettingsStore } from "../../store/settingsStore";

const LIGHT_THEME = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--ci-code-bg)",
    color: "var(--ci-text)",
  },
  ".cm-content": {
    caretColor: "var(--ci-accent)",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  },
  ".cm-gutters": {
    backgroundColor: "var(--ci-surface)",
    color: "var(--ci-text-dim)",
    borderRight: "1px solid var(--ci-toolbar-border)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(0,122,255,0.06)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(0,122,255,0.08)",
  },
});

const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
};

function languageExtension(path: string) {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".json")) return json();
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) return markdown();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return javascript({ jsx: normalized.endsWith("x"), typescript: normalized.includes(".ts") });
  }
  return [];
}

export function CodeEditorSurface({
  path,
  value,
  onChange,
  readOnly = false,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const themeMode = useSettingsStore((s) => s.settings.theme);
  const extensions = useMemo(() => {
    const language = languageExtension(path);
    const base = [EditorView.lineWrapping, EditorView.editable.of(!readOnly)];
    return Array.isArray(language)
      ? [...base, ...language]
      : [...base, language];
  }, [path, readOnly]);
  const cmTheme = useMemo(() => {
    if (themeMode === "dark") return oneDark;
    return LIGHT_THEME;
  }, [themeMode]);

  return (
    <div style={{ flex: 1, minHeight: 0, background: "var(--ci-code-bg)" }}>
      <CodeMirror
        value={value}
        height="100%"
        theme={cmTheme}
        extensions={extensions}
        basicSetup={BASIC_SETUP}
        onChange={onChange}
        editable={!readOnly}
        style={{ height: "100%", fontSize: 12 }}
      />
    </div>
  );
}

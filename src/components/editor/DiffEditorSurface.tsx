import { DiffViewer } from "../DiffViewer";
import { type DiffFile } from "../../store/sessionStore";

export function DiffEditorSurface({ file }: { file: DiffFile | null }) {
  if (!file) {
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "var(--ci-text-dim)",
        fontSize: 12,
        lineHeight: 1.7,
      }}>
        当前文件暂无 diff。
      </div>
    );
  }

  return <DiffViewer files={[file]} />;
}

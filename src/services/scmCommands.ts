import { openDiff } from "./editorCommands";
import { useScmStore } from "../store/scmStore";

export function selectScmFile(sessionId: string, path: string) {
  useScmStore.getState().setSelectedPath(sessionId, path);
  openDiff(sessionId, path);
}

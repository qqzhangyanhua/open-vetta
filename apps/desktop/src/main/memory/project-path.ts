import { resolve } from "node:path";
import { isSshProjectUri, normalizeProjectCwd } from "@vetta/ssh-transport";
import { DEFAULT_CONVERSATION_CWD } from "../config/desktop-config-store.js";
import { isConversationCwd } from "../conversations/session-paths.js";

/**
 * 项目记忆挂在项目根上。
 * 「对话」会话的运行目录是项目根下的产物子目录，这里收回到 conversation cwd。
 * SSH 项目保持 `ssh://` 主键，文件仍写在本机记忆目录，不往远端或项目仓库里写。
 */
export function memoryProjectPath(cwd: string): string {
	const trimmed = cwd.trim();
	if (!trimmed) throw new Error("memory:project-unavailable");
	if (isSshProjectUri(trimmed)) return normalizeProjectCwd(trimmed, resolve);
	if (isConversationCwd(trimmed)) return DEFAULT_CONVERSATION_CWD;
	return resolve(trimmed);
}

import { i18n } from "@shared/i18n";
import { openSessionFnRef } from "@shared/store/atoms";
import type { ExternalHistoryResume } from "@shared/store/external-history-resume";
import { showToast } from "@shared/store/toast-atoms";
import { openLiveExternalInvocation } from "./open-external-invocation-tab";

let opening = false;

/**
 * 没有可挂续跑胶囊的输入草稿时，先打开记录所在目录的会话，再在终端里执行该 Agent 的恢复命令。
 * 空提问配合 historyResume，主进程会变成 `grok --resume <id>` 这类参数，不会另起一条新记录。
 * 会话路由先提交，进程要等会话可发送之后才启动。
 */
export function launchExternalHistoryResumeTerminal(resume: ExternalHistoryResume, agentLabel: string): void {
	if (opening) return;
	const open = openSessionFnRef.current;
	if (!open) {
		showToast({ variant: "error", message: failedMessage(agentLabel) });
		return;
	}
	opening = true;
	let started = false;
	void open(resume.cwd, undefined, undefined, {
		navigateBeforeCreate: true,
		onPromptReady: (sessionId) => {
			started = true;
			void startResumeTerminal(sessionId, resume, agentLabel).finally(() => {
				opening = false;
			});
		},
	})
		.catch(() => {
			showToast({ variant: "error", message: failedMessage(agentLabel) });
		})
		.finally(() => {
			if (!started) opening = false;
		});
}

async function startResumeTerminal(
	sessionId: string,
	resume: ExternalHistoryResume,
	agentLabel: string,
): Promise<void> {
	const client = window.vetta?.externalInvocations;
	if (!client) {
		showToast({ variant: "error", message: failedMessage(agentLabel) });
		return;
	}
	try {
		const started = await client.start({
			sessionId,
			cwd: resume.cwd,
			prompt: "",
			agentId: resume.agentId,
			newSession: false,
			historyResume: { externalSessionId: resume.externalSessionId, cwd: resume.cwd },
		});
		openLiveExternalInvocation({
			fallbackCwd: resume.cwd,
			invocationId: started.invocationId,
			status: "running",
			agentLabel,
			externalSessionId: resume.externalSessionId,
			agentId: resume.agentId,
			createIfMissing: true,
		});
	} catch {
		showToast({ variant: "error", message: failedMessage(agentLabel) });
	}
}

function failedMessage(agentLabel: string): string {
	return i18n.t("chat:externalInvocation.resume.terminalFailed", { agent: agentLabel });
}

import { Button } from "@shared/components/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
	bottomPanelStateAtom,
	EXTERNAL_INVOCATION_COMPONENT_ID,
	type ExternalInvocationPanelPayload,
	findBottomPanelTab,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { type JSX, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBottomPanelFill, useBottomPanelInstance } from "../registry/instance-context";
import type { BottomPanelBuiltin } from "./types";

export const EXTERNAL_INVOCATION_PANEL_ID = EXTERNAL_INVOCATION_COMPONENT_ID;

function readPayload(payload: unknown): ExternalInvocationPanelPayload | null {
	if (typeof payload !== "object" || payload === null || !("invocationId" in payload) || !("status" in payload)) {
		return null;
	}
	return payload as ExternalInvocationPanelPayload;
}

export function ExternalInvocationSurface(): JSX.Element {
	const { t } = useTranslation("chat");
	const handle = useBottomPanelInstance();
	const fill = useBottomPanelFill();
	const layout = useAtomValue(bottomPanelStateAtom);
	const payload = readPayload(findBottomPanelTab(layout.root, handle.tabId)?.tab.payload);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const handleRef = useRef(handle);
	handleRef.current = handle;
	const refitRef = useRef<(() => void) | null>(null);
	const status = payload?.status ?? "finished";
	const statusRef = useRef(status);
	statusRef.current = status;
	const invocationIdRef = useRef(payload?.invocationId);
	invocationIdRef.current = payload?.invocationId;
	const externalSessionIdRef = useRef(payload?.externalSessionId);
	externalSessionIdRef.current = payload?.externalSessionId;
	const seenInvocations = useRef(new Set<string>());

	useEffect(() => {
		const agent = payload?.agentLabel || t("externalInvocation.panel");
		const project = payload?.projectLabel;
		handleRef.current.setMeta({
			label: project ? `${agent} · ${project}` : agent,
			status: status === "running" ? "active" : "idle",
		});
	}, [payload?.agentLabel, payload?.projectLabel, status, t]);

	useEffect(() => {
		const invocationId = payload?.invocationId;
		if (status !== "running" || !invocationId) {
			handleRef.current.setCloseGuard(null);
			return;
		}
		handleRef.current.setCloseGuard(() => ({
			title: t("externalInvocation.closeConfirm.title"),
			message: t("externalInvocation.closeConfirm.message"),
			confirmLabel: t("externalInvocation.closeConfirm.confirm"),
			destructive: true,
		}));
		return () => handleRef.current.setCloseGuard(null);
	}, [payload?.invocationId, status, t]);

	useEffect(() => {
		const container = containerRef.current;
		const invocationId = payload?.invocationId;
		const sessionId = payload?.sessionId;
		const api = window.vetta?.externalInvocations;
		if (!container || !invocationId || !sessionId || !api) return;
		let disposed = false;
		const terminal = new Terminal({
			fontSize: 12,
			cursorBlink: statusRef.current === "running",
			scrollback: 5000,
			convertEol: true,
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);
		terminalRef.current = terminal;
		const fitIfMeasurable = (): { cols: number; rows: number } | null => {
			if (disposed) return null;
			const rect = container.getBoundingClientRect();
			if (rect.width < 8 || rect.height < 8) return null;
			try {
				fit.fit();
			} catch {
				return null;
			}
			return { cols: terminal.cols, rows: terminal.rows };
		};
		const applyFit = (): void => {
			const size = fitIfMeasurable();
			const liveId = invocationIdRef.current;
			if (size && liveId) void api.resize(liveId, size.cols, size.rows);
		};
		refitRef.current = applyFit;
		applyFit();
		const observer = new ResizeObserver(applyFit);
		observer.observe(container);
		let acceptLive = false;
		const unsubscribe = api.subscribe(sessionId, (event) => {
			if (disposed) return;
			const liveId = invocationIdRef.current;
			const sameSession =
				Boolean(event.externalSessionId) && event.externalSessionId === externalSessionIdRef.current;
			if (!acceptLive || (event.invocationId !== liveId && !sameSession)) return;
			if (event.type === "running" && event.invocationId !== liveId && !seenInvocations.current.has(event.invocationId)) {
				seenInvocations.current.add(event.invocationId);
				terminal.writeln(
					`\r\n${t("externalInvocation.separator", {
						n: event.ordinal ?? 1,
						time: event.startedAt ?? "",
						status: t("externalInvocation.status.running"),
					})}`,
				);
			}
			if (event.type === "output" && event.chunk) terminal.write(event.chunk);
			if (event.type === "truncated") {
				terminal.writeln(`\r\n${t("externalInvocation.truncated", { bytes: event.discardedBytes ?? 0 })}`);
			}
		});
		void api.readOutput(sessionId, invocationId).then((saved) => {
			if (disposed) return;
			if (!saved) {
				acceptLive = true;
				return;
			}
			terminal.write(saved.head);
			if (saved.discardedBytes > 0) {
				terminal.writeln(`\r\n${t("externalInvocation.truncated", { bytes: saved.discardedBytes })}`);
			}
			if (saved.tail) terminal.write(saved.tail);
			terminal.scrollToTop();
			acceptLive = true;
		});
		const input = terminal.onData((data) => {
			const liveId = invocationIdRef.current;
			if (disposed || statusRef.current !== "running" || !liveId) return;
			void api.writeInput(liveId, data);
		});
		return () => {
			disposed = true;
			observer.disconnect();
			if (refitRef.current === applyFit) refitRef.current = null;
			input.dispose();
			unsubscribe();
			if (terminalRef.current === terminal) terminalRef.current = null;
			terminal.dispose();
		};
	}, [payload?.sessionId, t]);

	useEffect(() => {
		if (!handle.active) return;
		const frame = requestAnimationFrame(() => refitRef.current?.());
		return () => cancelAnimationFrame(frame);
	}, [handle.active]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{fill ? null : (
				<p className="flex items-center gap-2 px-3 pt-1.5 text-[11px] text-muted-foreground">
					<span>{payload?.agentLabel || t("externalInvocation.panel")}</span>
					<span>{payload?.projectLabel}</span>
					<span>{status === "running" ? t("externalInvocation.status.running") : t("externalInvocation.status.completed")}</span>
				</p>
			)}
			<div ref={containerRef} className={fill ? "min-h-0 flex-1" : "min-h-0 flex-1 px-2 py-1.5"} />
			{fill ? null : (
				<Button
					variant="ghost"
					size="sm"
					className="self-start"
					disabled={status === "running"}
					onClick={() => terminalRef.current?.clear()}
				>
					{t("externalInvocation.clear")}
				</Button>
			)}
		</div>
	);
}

export const externalInvocationPanelBuiltin: BottomPanelBuiltin = {
	id: EXTERNAL_INVOCATION_PANEL_ID,
	order: 1,
	icon: "icon-[solar--monitor-linear]",
	labelKey: "externalInvocation.panel",
	omitFromAddMenu: true,
	component: ExternalInvocationSurface,
};

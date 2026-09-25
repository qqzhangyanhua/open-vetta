import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
	activeInputDraftKeyAtom,
	bottomPanelStateAtom,
	dispatchBottomPanelAtom,
	pageHeaderLeftSlotAtom,
	pageHeaderRightSlotAtom,
} from "@shared/store/atoms";
import {
	externalRecipientFor,
	externalRecipientVersion,
	subscribeExternalRecipient,
} from "@shared/store/external-recipient";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { ChatHeaderActionsView } from "./chat-view/ChatHeaderActionsView";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { DefaultChatView, ChatComposer } from "./chat-view/DefaultChatView";
import { SessionMessageList } from "./SessionMessageList";
import { SessionAssistantRendering } from "./SessionAssistantRendering";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import { SessionExternalInvocationPage } from "./external-invocation/SessionExternalInvocationPage";
import type { ChatViewProps } from "./chat-view/types";

const SessionFeed = memo(SessionMessageList);

export const DefaultChatComposer = memo(function DefaultChatComposer({
	onSend,
	onAbort,
	onSendQueued,
	cwdOverride,
}: ChatViewProps): JSX.Element {
	return (
		<ChatComposer>
			<DefaultInputBarConnector
				onSend={onSend}
				onAbort={onAbort}
				onSendQueued={onSendQueued}
				cwdOverride={cwdOverride}
			/>
		</ChatComposer>
	);
});

export function ChatView(props: ChatViewProps): JSX.Element {
	const { actions, model } = useChatViewModel();
	const participants = useBoundAgentParticipants();
	const runtimeIds = useActiveSessionRuntimeIds();
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const dispatchBottomPanel = useSetAtom(dispatchBottomPanelAtom);
	const panel = useAtomValue(bottomPanelStateAtom);
	const draftKey = useAtomValue(activeInputDraftKeyAtom);
	const recipientVersion = useSyncExternalStore(subscribeExternalRecipient, externalRecipientVersion, () => 0);
	const recipient = recipientVersion >= 0 ? externalRecipientFor(draftKey) : "penguin";
	const surface = panel.filled ? "external-terminal" : "conversation";
	const headerActions = useMemo(
		() => <ChatHeaderActionsView actions={actions} model={model.header} />,
		[actions, model.header],
	);
	const workspace = useMemo(
		() =>
			createActivityWorkspace(
				model.cwd ?? model.sessionId ?? "conversation:unbound",
				model.cwd,
				runtimeIds,
			),
		[model.cwd, model.sessionId, runtimeIds],
	);
	const onAbort = useCallback(() => {
		void props.onAbort();
	}, [props.onAbort]);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	useEffect(() => {
		setHeaderLeftSlot(
			<>
				<ChatHeaderNewSessionButton />
				{surface === "external-terminal" ? (
					<SessionExternalInvocationPage
						session={
							model.sessionId && model.cwd
								? { sessionId: model.sessionId, cwd: model.cwd }
								: null
						}
						client={window.vetta?.externalInvocations ?? null}
						prompt=""
						onPromptChange={() => undefined}
						showPrompt={false}
						switcherOnly
						penguinTools={null}
						draftKey={draftKey}
						remote={Boolean(model.cwd && isSshProjectUri(model.cwd))}
					/>
				) : null}
			</>,
		);
		return () => setHeaderLeftSlot(null);
	}, [draftKey, model.cwd, model.sessionId, setHeaderLeftSlot, surface]);

	const previousRecipient = useRef("penguin");
	useEffect(() => {
		if (previousRecipient.current === recipient) return;
		previousRecipient.current = recipient;
		dispatchBottomPanel({ type: "set-filled", filled: recipient !== "penguin" });
	}, [dispatchBottomPanel, recipient]);

	return (
		<DefaultChatView
			messages={model.messages}
			workspace={workspace}
			rootClassName={model.rootClassName}
			exportState={model.exporting ? { title: model.exportTitle, onFinished: actions.finishExport } : undefined}
			surface={surface}
		>
			{surface === "conversation" ? (
				<>
					<SessionAssistantRendering>
						<SessionFeed
							messages={model.messages}
							workspace={workspace}
							isStreaming={model.isStreaming}
							sessionId={model.sessionId}
							participants={participants}
							onSend={props.onSend}
							onAbort={onAbort}
						/>
					</SessionAssistantRendering>
					<DefaultChatComposer {...props} />
				</>
			) : null}
		</DefaultChatView>
	);
}

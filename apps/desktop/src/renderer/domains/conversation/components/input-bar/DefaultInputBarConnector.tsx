import { useBottomPanelPills } from "@domains/bottom-panel/hooks/useBottomPanelPills";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import type { InputBarContextMenuViewProps } from "@vetta-org/theme-ui/chat";
import { inputValueAtom, mentionedFilesAtom } from "@shared/store/atoms";
import { activeInputDraftKeyAtom } from "@shared/store/session-input-draft";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useMemo, useRef, useState } from "react";
import { openExternalInvocationTabAtom } from "../external-invocation/open-external-invocation-tab";
import { useTranslation } from "react-i18next";
import { InputBar } from "../InputBar";
import type { ActiveActionCapsule } from "./ActiveActionCapsules";
import type { ConnectedInputBarProps, InputBarDrawerItem, InputBarModel, InputBarTodoModel } from "./types";
import { useInputBarAttachmentModel } from "./useInputBarAttachmentModel";
import { useInputBarContextMenuModel } from "./useInputBarContextMenuModel";
import {
	useInputBarDraftSource,
	useInputBarInteractionSource,
	useInputBarQueueSource,
	useInputBarSessionSource,
	useInputBarSuggestionSource,
	useInputBarTodoSource,
} from "./useInputBarSources";
import { useInputBarTriggerModel } from "./useInputBarTriggerModel";
import { useSpeechInput } from "./useSpeechInput";
import { useSessionDropZoneModel } from "../../hooks/useSessionDropZoneModel";
import { useInputActionBarModel } from "../useInputActionBarModel";
import { useDefaultContextRingModel } from "../../hooks/useContextRingModel";
import { useDefaultExecutionModeSelectorModel } from "../../hooks/useExecutionModeSelectorModel";
import { usePlanModeModel } from "../../hooks/usePlanModeModel";

/** 普通 Chat 的默认配方；每项能力由独立 source/model 提供，其他 Connector 可自行取舍。 */
export const DefaultInputBarConnector = memo(function DefaultInputBarConnector(props: ConnectedInputBarProps): JSX.Element {
	const { t } = useTranslation("chat");
	const session = useInputBarSessionSource(props.cwdOverride);
	const draft = useInputBarDraftSource();
	const inputValue = useAtomValue(inputValueAtom);
	const mentionedFiles = useAtomValue(mentionedFilesAtom);
	const draftKey = useAtomValue(activeInputDraftKeyAtom);
	const [externalRecipientId, setExternalRecipientId] = useState("penguin");
	const placeExternalInvocation = useSetAtom(openExternalInvocationTabAtom);
	const invocationStatus = useRef<Record<string, "running" | "finished">>({});
	const runtimeId = session.activeSession?.runtimeId;
	const interactions = useInputBarInteractionSource(runtimeId);
	const firstSuggestion = useInputBarSuggestionSource(runtimeId);
	const queue = useInputBarQueueSource(runtimeId);
	const todoItems = useInputBarTodoSource(runtimeId);
	const actionBar = useInputActionBarModel();
	const speechInput = useSpeechInput(session.hasSession);
	const executionModeModel = useDefaultExecutionModeSelectorModel();
	const planMode = usePlanModeModel();
	const contextUsageModel = useDefaultContextRingModel(true);
	const canSend =
		session.hasSession &&
		!session.isStreaming &&
		(!session.isBlank || Boolean(draft.appshotAttachment));
	const dropZone = useSessionDropZoneModel(session.effectiveCwd || undefined);
	const trigger = useInputBarTriggerModel({
		activeSession: session.activeSession,
		canSend: canSend,
		firstSuggestion: firstSuggestion,
		focusInputRequest: session.focusInputRequest,
		hasSession: session.hasSession,
		isEmpty: session.isBlank,
		isStreaming: session.isStreaming,
		onAbort: props.onAbort,
		onExpandedChange: props.onExpandedChange,
		onSend: props.onSend,
	});
	const imageAttachments = useMemo(
		() => draft.imagePaths.map((path, index) => ({ path, name: pathBasename(path), url: toVettaFileUrl(path), label: t("inputBar.capsule.imageBadge", { index: index + 1 }) })),
		[draft.imagePaths, t],
	);
	const attachments = useInputBarAttachmentModel({
		activeRuntimeId: session.activeSession?.runtimeId,
		effectiveCwd: session.effectiveCwd,
		hasSession: session.hasSession,
		imageAttachments,
		setAppshotAttachment: draft.setAppshotAttachment,
		setFilePreview: draft.setFilePreview,
		setInputValue: draft.setInputValue,
		setMentionedFiles: draft.setMentionedFiles,
		setPendingMessageEdit: draft.setPendingMessageEdit,
		setPromptAttachment: draft.setPromptAttachment,
	});
	const contextMenuModel = useInputBarContextMenuModel({
		activeRuntimeId: session.activeSession?.runtimeId,
		hasSession: session.hasSession,
	});
	const activeActions = useMemo<ActiveActionCapsule[]>(
		() => [
			...actionBar.builtins
				.filter((builtin) => builtin.active)
				.map((builtin) => ({ id: builtin.id, label: builtin.label, icon: <span className={`${builtin.iconClass} h-3 w-3`} />, onToggle: builtin.onToggle })),
			...actionBar.items.filter((item) => item.active).map((item) => ({ id: item.id, label: item.label, icon: item.icon, onToggle: () => actionBar.actions.toggleItem(item.id) })),
		],
		[actionBar],
	);
	const hasCapsules = imageAttachments.length > 0 || Boolean(draft.appshotAttachment) || Boolean(draft.pendingMessageEdit);
	const drawerItems = useMemo<InputBarDrawerItem[]>(() => {
		const items: InputBarDrawerItem[] = [];
		if (interactions.sandboxPermission) {
			items.push({ kind: "sandbox-permission", id: "sandbox-permission", label: t("inputBar.drawer.permissionLabel"), desc: t("inputBar.drawer.permissionDesc"), pulsing: true, request: interactions.sandboxPermission });
		}
		if (queue.items.length > 0 && session.activeSession) {
			const runtimeId = session.activeSession.runtimeId;
			items.push({ kind: "queue", id: "queue", label: t("inputBar.drawer.queueLabel"), desc: queue.paused ? t("inputBar.drawer.queuePausedDesc", { count: queue.items.length }) : t("inputBar.drawer.queueDesc", { count: queue.items.length }), pulsing: queue.paused, runtimeId, onSendNow: (id) => props.onSendQueued?.(runtimeId, id) });
		}
		return items;
	}, [props.onSendQueued, session.activeSession, queue.items.length, queue.paused, interactions.sandboxPermission, t]);
	const bottomPanelPills = useBottomPanelPills();
	const todo = useMemo<InputBarTodoModel | null>(() => todoItems.length > 0 ? { items: todoItems, onOpenPanel: trigger.openTodoPanel } : null, [todoItems, trigger.openTodoPanel]);
	const defaultPlaceholders = useMemo(() => {
		const raw = t("inputBar.placeholder.defaults", { returnObjects: true });
		return (Array.isArray(raw) ? raw : []).filter((item): item is string => typeof item === "string" && item.length > 0);
	}, [t]);
	const placeholderModel = useMemo(() => {
		if (!session.hasSession) return { placeholderTexts: [t("inputBar.placeholder.noSession")], placeholderRotating: false };
		if (externalRecipientId !== "penguin") {
			const agent = externalRecipientId === "grok" ? "Grok" : externalRecipientId;
			return { placeholderTexts: [t("externalInvocation.placeholder", { agent })], placeholderRotating: false };
		}
		if (session.isStreaming) return { placeholderTexts: [t("inputBar.placeholder.thinking")], placeholderRotating: false };
		if (session.placeholderVisible && firstSuggestion) return { placeholderTexts: [t("inputBar.placeholder.suggestion", { suggestion: firstSuggestion })], placeholderRotating: false };
		return { placeholderTexts: defaultPlaceholders, placeholderRotating: defaultPlaceholders.length > 1 };
	}, [defaultPlaceholders, externalRecipientId, firstSuggestion, session.hasSession, session.isStreaming, session.placeholderVisible, t]);
	const labels = useMemo<InputBarModel["labels"]>(() => ({
		capsule: { removeDefault: t("inputBar.capsule.removeDefault"), removeImage: t("inputBar.capsule.removeImage"), removeTooltip: (path) => t("inputBar.capsule.removeTooltip", { path }), activeGroup: (count) => t("inputBar.capsule.activeGroup", { count }) },
		permission: { deny: t("inputBar.permission.deny"), allow: t("inputBar.permission.allow"), allowSession: t("inputBar.permission.allowSession") },
		toolbar: { skills: t("inputBar.toolbar.skills"), addImage: t("inputBar.toolbar.addImage"), attachFile: t("inputBar.toolbar.attachFile"), queue: t("inputBar.drawer.queueLabel") },
	}), [t]);
	const contextMenu: InputBarContextMenuViewProps | null = contextMenuModel.contextMenu;

	const model: InputBarModel = {
		dropZone,
		isStreaming: session.isStreaming,
		sendPending: props.sendPending,
		pendingQuestion: interactions.pendingQuestion,
		pendingMcpElicitation: interactions.pendingMcpElicitation,
		pendingPlanReview: interactions.pendingPlanReview,
		imageAttachments,
		activeActions,
		appshotAttachment: draft.appshotAttachment,
		hasSession: session.hasSession,
		canSend: canSend,
		isEmpty: session.isBlank,
		showPlaceholder: session.placeholderVisible,
		hasCapsules,
		effectiveCwd: session.effectiveCwd,
		placeholderTexts: placeholderModel.placeholderTexts,
		placeholderRotating: placeholderModel.placeholderRotating,
		isFocused: trigger.isFocused,
		commands: {
			slashOpen: trigger.slashOpen,
			slashVisible: trigger.slashVisible,
			slashFilter: trigger.slashFilter,
			atOpen: trigger.atOpen,
			atFilter: trigger.atFilter,
			onTriggerChange: trigger.handleTriggerChange,
			onSlashClose: trigger.handleSlashClose,
			onSlashSelect: trigger.handleSlashSelect,
			onConnectorSelect: trigger.handleConnectorSelect,
			onAtClose: trigger.handleAtClose,
			onAtSelect: trigger.handleAtSelect,
				onOpen: trigger.handlePlusClick,
				allowCompaction: Boolean(session.activeSession),
			},
		drawerItems,
		drawerActiveTab: trigger.drawerActiveTab,
		todo,
		bottomPanelPills,
		speechInput: speechInput,
		hasPromptAttachment: Boolean(draft.promptAttachment),
		promptAttachmentIcon: draft.promptAttachment?.icon,
		promptAttachmentIconUrl: draft.promptAttachment?.ownerPluginIconUrl,
		promptAttachmentLabel: draft.promptAttachment?.label,
		promptAttachmentLabels: draft.promptAttachment?.labels ?? (draft.promptAttachment ? [draft.promptAttachment.label] : undefined),
		pendingMessageEdit: Boolean(draft.pendingMessageEdit),
		pendingEditHint: t("messageList.edit.pendingHint"),
		cancelPendingEditLabel: t("messageList.interrupt.cancel"),
		contextMenu,
		editor: { namespace: "chat-input" },
		modelSelector: { updateActiveSession: true },
		externalInvocation: {
			session: session.activeSession ? { sessionId: session.activeSession.runtimeId, cwd: session.effectiveCwd } : null,
			client: window.vetta?.externalInvocations ?? null,
			prompt: inputValue,
			onPromptChange: draft.setInputValue,
			onRecipientChange: setExternalRecipientId,
			draftKey,
			images: imageAttachments.map((image) => ({ path: image.path, name: image.name })),
			onRemoveImage: attachments.removeImage,
			referencedPaths: mentionedFiles.map((file) => file.path),
			remote: isSshProjectUri(session.effectiveCwd),
			onInvocationEvent: (event) => {
				const active = session.activeSession;
				if (!active) return;
				if (event.type === "running" || event.type === "completed" || event.type === "failed") {
					const status = event.type === "running" ? "running" : "finished";
					invocationStatus.current[event.invocationId] = status;
					placeExternalInvocation({
						invocationId: event.invocationId,
						status,
						cwd: session.effectiveCwd,
						sessionId: active.runtimeId,
						agentLabel: externalRecipientId === "grok" ? "Grok" : externalRecipientId,
					});
				}
			},
			onViewInTerminal: (invocationId) => {
				const active = session.activeSession;
				if (!active) return;
				placeExternalInvocation({
					invocationId,
					status: invocationStatus.current[invocationId] ?? "finished",
					cwd: session.effectiveCwd,
					sessionId: active.runtimeId,
					agentLabel: externalRecipientId === "grok" ? "Grok" : externalRecipientId,
				});
			},
		},
		leadingTools: [{ kind: "execution-mode", model: executionModeModel }],
		trailingTools: contextUsageModel ? [{ kind: "context-usage", model: contextUsageModel }] : [],
		sendBehavior: "queueable",
		labels,
		actions: {
			setFocused: trigger.setIsFocused,
			setDrawerActiveTab: trigger.setDrawerActiveTab,
			handleEnter: trigger.handleEnter,
			handleKeyDown: planMode.handleKeyDown,
			handleContextMenu: contextMenuModel.onContextMenu,
			removeImage: attachments.removeImage,
			openImagePreview: attachments.openImagePreview,
			removePromptAttachment: attachments.removePromptAttachment,
			removeAppshot: attachments.removeAppshot,
			handleSelectImages: attachments.handleSelectImages,
			handleSelectFiles: attachments.handleSelectFiles,
			handleSend: trigger.handleSend,
			handleAbort: trigger.handleAbort,
			cancelPendingEdit: attachments.cancelPendingEdit,
		},
	};

	return <InputBar model={model} />;
});

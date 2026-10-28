import { MessageInput } from "@vetta-org/theme-ui/chat/MessageInputView";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { InputBarMention } from "./InputBarMention";
import {
	InputBarActiveActions,
	InputBarAttachmentActions,
	InputBarContextAction,
	InputBarExecutionModeAction,
	InputBarSendAction,
	InputBarSkillsAction,
	InputBarSpeechAction,
	InputBarToolbarDivider,
} from "./InputBarToolbar";
import type { InputBarModel } from "./types";

export function InputBarLeadingActions({ model }: { readonly model: InputBarModel }): JSX.Element {
	const commands = model.commands;
	const slashOpen = commands?.slashOpen ?? false;
	return (
		<>
			{/*
			 * 标记给命令区的 click-outside 判定用：否则 mousedown 先收起、
			 * 随后的 click 又打开，按钮无法关闭面板。
			 */}
			{commands && !model.sendingExternally ? (
				<InputBarSkillsAction
					active={commands.slashOpen}
					disabled={!model.hasSession}
					title={model.labels.toolbar.skills}
					onSelect={commands.onOpen}
				/>
			) : null}
			{model.routing ? (
				<InputBarMention model={model.routing} disabled={!model.hasSession} visible={!slashOpen} />
			) : null}
			{commands ? <InputBarToolbarDivider /> : null}
			{/* 两组控件保持挂载、只切 display，避免展开动画首帧重建复杂 selector。 */}
			<InputBarAttachmentActions
				disabled={!model.hasSession}
				visible={!commands || commands.slashOpen}
				addImageTitle={model.labels.toolbar.addImage}
				addImageDisabled={model.sendingExternally}
				attachFileTitle={model.labels.toolbar.attachFile}
				onSelectFiles={() => void model.actions.handleSelectFiles()}
				onSelectImages={() => void model.actions.handleSelectImages()}
			/>
			{model.leadingTools.map((tool) => (
				<InputBarExecutionModeAction
					key={tool.kind}
					visible={!slashOpen && !model.sendingExternally}
					model={tool.model}
				/>
			))}
			<InputBarRecipientAnchor hidden={slashOpen} />
			<InputBarActiveActions
				items={model.activeActions}
				removeHint={model.labels.capsule.removeDefault}
				groupLabel={model.labels.capsule.activeGroup}
			/>
		</>
	);
}

export function InputBarTrailingActions({ model }: { readonly model: InputBarModel }): JSX.Element {
	const slashOpen = model.commands?.slashOpen ?? false;
	return (
		<>
			{model.trailingTools.map((tool) => (
				<InputBarContextAction key={tool.kind} visible={!slashOpen} model={tool.model} render={tool.render} />
			))}
			{slashOpen ? null : <InputBarSpeechAction input={model.speechInput} />}
			{slashOpen || (model.sendingExternally === true && model.externalInvocation?.hideComposer === true) ? null : (
				<InputBarSendAction
					canSend={model.sendingExternally === true ? model.canSendExternally === true : model.canSend}
					canQueue={model.sendingExternally !== true && model.sendBehavior === "queueable"}
					isEmpty={model.isEmpty}
					isStreaming={model.sendingExternally === true ? false : model.isStreaming}
					queueTitle={model.labels.toolbar.queue}
					pending={model.sendingExternally === true ? undefined : model.sendPending}
					onAbort={model.actions.handleAbort}
					onSend={
						model.sendingExternally === true
							? () => model.externalInvocation?.onEditorSend()
							: model.actions.handleSend
					}
				/>
			)}
		</>
	);
}

const ToolbarRecipientElementContext = createContext<HTMLElement | null>(null);
const SetToolbarRecipientElementContext = createContext<(element: HTMLElement | null) => void>(() => {});

/** 输入栏左侧「发给」锚点。工具栏外（标题栏、终端会话）没有这个锚点，下拉框留在原处。 */
export function useToolbarRecipientElement(): HTMLElement | null {
	return useContext(ToolbarRecipientElementContext);
}

function InputBarRecipientAnchor({ hidden }: { readonly hidden: boolean }): JSX.Element {
	const setElement = useContext(SetToolbarRecipientElementContext);
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		setElement(ref.current);
		return () => setElement(null);
	}, [setElement]);
	// contents：没有「发给」时不占位，也不给左侧工具栏多出一条缝。
	return <div ref={ref} className={hidden ? "hidden" : "contents"} />;
}

/** Shared toolbar recipe: callers compose the model controls, common actions keep their order. */
export function InputBarToolbar({
	model,
	children,
}: {
	readonly model: InputBarModel;
	readonly children: ReactNode;
}): JSX.Element {
	const [recipientElement, setRecipientElement] = useState<HTMLElement | null>(null);
	return (
		<SetToolbarRecipientElementContext.Provider value={setRecipientElement}>
			<ToolbarRecipientElementContext.Provider value={recipientElement}>
				<MessageInput.ToolbarLeading>
					<InputBarLeadingActions model={model} />
				</MessageInput.ToolbarLeading>
				<MessageInput.ToolbarTrailing>
					<div className={model.commands?.slashOpen ? "hidden" : "flex min-w-0 shrink items-center gap-1"}>
						{children}
					</div>
					<InputBarTrailingActions model={model} />
				</MessageInput.ToolbarTrailing>
			</ToolbarRecipientElementContext.Provider>
		</SetToolbarRecipientElementContext.Provider>
	);
}

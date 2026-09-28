import { createContext, useContext } from "react";
import type { BottomPanelHandle } from "./types";

const BottomPanelInstanceContext = createContext<BottomPanelHandle | null>(null);

export const BottomPanelInstanceProvider = BottomPanelInstanceContext.Provider;

const BottomPanelFillContext = createContext(false);

export const BottomPanelFillProvider = BottomPanelFillContext.Provider;

const BottomPanelScopeKeyContext = createContext("bottom-panel:unbound");

export const BottomPanelScopeKeyProvider = BottomPanelScopeKeyContext.Provider;

/** 当前底部面板的工作表面 key。加号菜单等面板外控件用来把操作写进同一份状态。 */
export function useBottomPanelScopeKey(): string {
	return useContext(BottomPanelScopeKeyContext);
}

/** 外部智能体铺满主区时为 true：内容组件据此去掉状态行和内边距。 */
export function useBottomPanelFill(): boolean {
	return useContext(BottomPanelFillContext);
}

/**
 * 面板内容组件取自己的实例身份与控制面。
 * 在面板之外调用是接线错误，所以直接抛而不是返回 null——否则错误会以「改名没生效」
 * 这种难查的形式出现。
 */
export function useBottomPanelInstance(): BottomPanelHandle {
	const handle = useContext(BottomPanelInstanceContext);
	if (!handle) throw new Error("useBottomPanelInstance must be called inside a bottom panel tab");
	return handle;
}

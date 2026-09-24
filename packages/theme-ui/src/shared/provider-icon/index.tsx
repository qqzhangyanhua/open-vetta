import type { JSX } from "react";
import { BrandMark } from "./brand-mark";
import { getProviderIcon, isMonochromeProviderIcon } from "./icons";

export { AgentBrandIcon } from "./agent-brand-icons";
export { PROVIDER_ICONS, getProviderIcon } from "./icons";

/**
 * 供应商图标。按 symbol 解析到内置图标渲染;symbol 为空或未注册时不渲染任何东西
 * (icon 字段可选,见 CONTEXT.md「icon symbol」)。
 */
export function ProviderIcon({
	symbol,
	className,
}: {
	symbol: string | undefined | null;
	className?: string;
}): JSX.Element | null {
	const src = getProviderIcon(symbol);
	if (!src) return null;
	return <BrandMark src={src} monochrome={isMonochromeProviderIcon(symbol)} className={className} />;
}

import type { JSX } from "react";
import agyIcon from "@lobehub/icons-static-svg/icons/antigravity-color.svg?url";
import codexIcon from "@lobehub/icons-static-svg/icons/codex-color.svg?url";
import cursorIcon from "@lobehub/icons-static-svg/icons/cursor.svg?url";
import grokIcon from "@lobehub/icons-static-svg/icons/grok.svg?url";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import piIcon from "@lobehub/icons-static-svg/icons/pi.svg?url";
import { BrandMark } from "./brand-mark";

type BrandAppearance = "color" | "monochrome";

const AGENT_BRAND_ASSETS = {
	grok: { src: grokIcon, appearance: "monochrome" },
	"cursor-agent": { src: cursorIcon, appearance: "monochrome" },
	agy: { src: agyIcon, appearance: "color" },
	codex: { src: codexIcon, appearance: "color" },
	pi: { src: piIcon, appearance: "monochrome" },
	opencode: { src: opencodeIcon, appearance: "monochrome" },
} as const satisfies Record<string, { readonly src: string; readonly appearance: BrandAppearance }>;

export function AgentBrandIcon({
	agentId,
	className,
}: {
	readonly agentId: string;
	readonly className?: string;
}): JSX.Element | null {
	if (!Object.hasOwn(AGENT_BRAND_ASSETS, agentId)) return null;
	const asset = AGENT_BRAND_ASSETS[agentId as keyof typeof AGENT_BRAND_ASSETS];
	return <BrandMark src={asset.src} monochrome={asset.appearance === "monochrome"} className={className} />;
}

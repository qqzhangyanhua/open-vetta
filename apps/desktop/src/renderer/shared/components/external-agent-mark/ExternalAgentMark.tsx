import { cn } from "@shared/lib/utils";
import { AgentBrandIcon } from "@vetta-org/theme-ui/shared";
import type { JSX } from "react";

const droidMarkUrl = new URL("./marks/droid.svg", import.meta.url).href;

const MARK_CLASS = "size-3.5";

/** 外部智能体的产品标志。没有对应图的不占位。 */
export function ExternalAgentMark({ agentId }: { readonly agentId: string }): JSX.Element | null {
	if (agentId === "penguin") {
		return <img src="./icon.png" alt="" aria-hidden className={cn(MARK_CLASS, "shrink-0 rounded-sm object-cover")} />;
	}
	if (agentId === "omp") return <OmpMark />;
	if (agentId === "droid") return <DroidMark />;
	return <AgentBrandIcon agentId={agentId} className={MARK_CLASS} />;
}

function OmpMark(): JSX.Element {
	return (
		<svg viewBox="0 0 120 90" aria-hidden className={cn(MARK_CLASS, "shrink-0 text-foreground")}>
			<rect x="10" y="8" width="100" height="12" rx="2" fill="currentColor" />
			<rect x="25" y="20" width="12" height="62" rx="2" fill="currentColor" />
			<rect x="75" y="20" width="12" height="45" rx="2" fill="currentColor" />
			<g className="text-primary">
				<rect x="71" y="55" width="20" height="16" rx="3" fill="currentColor" />
			</g>
			<rect x="76" y="59" width="3" height="8" rx="1" fill="var(--background)" />
			<rect x="82" y="59" width="3" height="8" rx="1" fill="var(--background)" />
		</svg>
	);
}

function DroidMark(): JSX.Element {
	const maskImage = `url(${JSON.stringify(droidMarkUrl)})`;
	return (
		<span
			aria-hidden
			className={cn(MARK_CLASS, "inline-block shrink-0 bg-current")}
			style={{
				maskImage,
				maskPosition: "center",
				maskRepeat: "no-repeat",
				maskSize: "contain",
				WebkitMaskImage: maskImage,
				WebkitMaskPosition: "center",
				WebkitMaskRepeat: "no-repeat",
				WebkitMaskSize: "contain",
			}}
		/>
	);
}

import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

/** 彩色标志用图片；单色标志用 currentColor 蒙版，好跟着明暗主题变。 */
export function BrandMark({
	src,
	monochrome,
	className,
}: {
	readonly src: string;
	readonly monochrome: boolean;
	readonly className?: string;
}): JSX.Element {
	if (monochrome) {
		const maskImage = `url(${JSON.stringify(src)})`;
		return (
			<span
				aria-hidden
				className={cn("inline-block shrink-0 bg-current", className)}
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

	return <img src={src} alt="" aria-hidden className={cn("shrink-0 rounded object-contain", className)} />;
}

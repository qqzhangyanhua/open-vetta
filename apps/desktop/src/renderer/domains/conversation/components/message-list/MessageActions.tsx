import { CopyButton as ThemeCopyButton, formatDuration, formatTime, RelativeTimeLabel } from "@vetta-org/theme-ui/chat/MessageActions";
import { useTranslation } from "react-i18next";

export { formatDuration, formatTime, RelativeTimeLabel };

export function GenerateMemoryButton({
	label,
	onGenerate,
}: {
	readonly label: string;
	readonly onGenerate: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onGenerate}
			title={label}
			aria-label={label}
			className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground"
		>
			<span className="icon-[solar--notebook-linear] h-3.5 w-3.5" />
		</button>
	);
}

export function CopyButton({
	getText,
	onCopy,
}: {
	getText: () => string;
	onCopy?: () => void | Promise<void>;
}): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<ThemeCopyButton
			getText={getText}
			onCopy={onCopy}
			labels={{
				copy: t("messageList.copyButton.copy"),
				copied: t("messageList.copyButton.copied"),
			}}
		/>
	);
}

import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@vetta-org/ui/dropdown-menu";

export function SessionMemoryMenu({
	menuLabel,
	generateLabel,
	onGenerate,
}: {
	readonly menuLabel: string;
	readonly generateLabel: string;
	readonly onGenerate: () => Promise<void>;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button type="button" variant="ghost" size="icon-xs" aria-label={menuLabel}>
					<span className="icon-[solar--menu-dots-linear] size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onSelect={() => {
						void onGenerate();
					}}
				>
					{generateLabel}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

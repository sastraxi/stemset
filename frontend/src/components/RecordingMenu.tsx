import { MoreVertical, QrCode, Pencil, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface RecordingMenuProps {
	onShowQR: () => void;
	onEdit: () => void;
	onDelete: () => void;
	disabled?: boolean;
}

export function RecordingMenu({
	onShowQR,
	onEdit,
	onDelete,
	disabled = false,
}: RecordingMenuProps) {
	return (
		<>
			{/* Desktop: Horizontal buttons */}
			<div className="recording-menu-desktop">
				<Button
					variant="outline"
					size="icon"
					onClick={onShowQR}
					disabled={disabled}
					title="Share recording"
					className="recording-menu-button"
				>
					<QrCode className="h-5 w-5" />
				</Button>
				<Button
					variant="outline"
					size="icon"
					onClick={onEdit}
					disabled={disabled}
					title="Edit metadata"
					className="recording-menu-button"
				>
					<Pencil className="h-4 w-4" />
				</Button>
				<Button
					variant="outline"
					size="icon"
					onClick={onDelete}
					disabled={disabled}
					title="Delete recording"
					className="recording-menu-button recording-menu-button-delete"
				>
					<Trash2 className="h-4 w-4" />
				</Button>
			</div>

			{/* Mobile: Dropdown menu */}
			<div className="recording-menu-mobile">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							disabled={disabled}
							title="Recording menu"
							className="recording-menu-trigger"
						>
							<MoreVertical className="h-5 w-5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={onShowQR}>
							<QrCode className="mr-2 h-4 w-4" />
							Share recording
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onEdit}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit metadata
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={onDelete}
							className="text-destructive focus:text-destructive"
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete recording
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</>
	);
}

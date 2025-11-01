import { Trash2 } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeleteConfirmationModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	recordingTitle: string;
	isDeleting?: boolean;
}

export function DeleteConfirmationModal({
	isOpen,
	onClose,
	onConfirm,
	recordingTitle,
	isDeleting = false,
}: DeleteConfirmationModalProps) {
	return (
		<AlertDialog open={isOpen} onOpenChange={onClose}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<Trash2 className="h-5 w-5 text-destructive" />
						Delete Recording
					</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete <strong>"{recordingTitle}"</strong>?
						This will permanently remove the recording and all its stems from
						your library. This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						disabled={isDeleting}
					>
						{isDeleting ? "Deleting..." : "Delete Recording"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

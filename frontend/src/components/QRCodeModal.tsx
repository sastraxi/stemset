import { Copy, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface QRCodeModalProps {
	isOpen: boolean;
	onClose: () => void;
	url: string;
	currentTime?: number;
}

export function QRCodeModal({
	isOpen,
	onClose,
	url,
	currentTime = 0,
}: QRCodeModalProps) {
	const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

	// QR code URL - no timestamp (easier to scan)
	const qrUrl = url.split("?")[0];

	// Display and copy link URL - includes timestamp
	const timestampedUrl = currentTime
		? `${qrUrl}?t=${Math.floor(currentTime)}`
		: qrUrl;

	useEffect(() => {
		if (canvas && qrUrl) {
			QRCode.toCanvas(canvas, qrUrl, {
				width: 300,
				margin: 2,
				color: {
					dark: "#000000",
					light: "#ffffff",
				},
			}).catch((err) => {
				console.error("QR code generation failed:", err);
			});
		}
	}, [canvas, qrUrl]);

	const handleCopyLink = async () => {
		try {
			await navigator.clipboard.writeText(timestampedUrl);
			const timeStr =
				currentTime > 0
					? ` (${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, "0")})`
					: "";
			toast.success(`Share link${timeStr} copied to clipboard!`);
		} catch (err) {
			console.error("Failed to copy to clipboard:", err);
			toast.error(`Could not copy to clipboard. Link: ${timestampedUrl}`);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="sm:max-w-md qr-modal-dialog">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<QrCode className="h-5 w-5" />
						Share Track
					</DialogTitle>
					<DialogDescription>
						Scan this QR code to view this recording, or copy the timestamped
						link below
					</DialogDescription>
				</DialogHeader>

				<div className="flex justify-center p-4 bg-white rounded-lg">
					<canvas ref={setCanvas} className="max-w-full h-auto" />
				</div>

				<div className="space-y-4">
					<Input
						type="text"
						value={timestampedUrl}
						readOnly
						className="font-mono text-sm cursor-pointer"
						onClick={(e) => e.currentTarget.select()}
					/>
					<Button
						onClick={handleCopyLink}
						className="w-full"
						variant="default"
						size="lg"
					>
						<Copy className="h-4 w-4 mr-2" />
						Copy Link
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

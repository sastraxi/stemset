import { Copy, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./QRCodeModal.css";

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
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [error, setError] = useState<string | null>(null);

	// QR code URL - no timestamp (easier to scan)
	const qrUrl = url.split("?")[0];

	// Copy link URL - includes timestamp
	const timestampSeconds = Math.floor(currentTime);
	const timestampedUrl = timestampSeconds > 0
		? `${qrUrl}?t=${timestampSeconds}`
		: qrUrl;

	useEffect(() => {
		if (isOpen && canvasRef.current && qrUrl) {
			QRCode.toCanvas(canvasRef.current, qrUrl, {
				width: 300,
				margin: 2,
				color: {
					dark: "#000000",
					light: "#ffffff",
				},
			}).catch((err) => {
				console.error("QR code generation failed:", err);
				setError("Failed to generate QR code");
			});
		}
	}, [isOpen, qrUrl]);

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
			<DialogContent className="sm:max-w-[425px] qr-modal-dialog-content [&>button]:hidden sm:[&>button]:hidden">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<QrCode className="h-6 w-6" />
						<span>Share Track</span>
					</DialogTitle>
					<DialogDescription>
						Scan this QR code to view this recording, or copy the timestamped link below
					</DialogDescription>
				</DialogHeader>

				<div className="qr-modal-body">
					{error ? (
						<div className="qr-modal-error">{error}</div>
					) : (
						<div className="qr-modal-qr-container">
							<canvas ref={canvasRef} className="qr-modal-canvas" />
						</div>
					)}

					<div className="qr-modal-url">
						<Input
							type="text"
							value={timestampedUrl}
							readOnly
							className="qr-modal-url-input"
							onClick={(e) => e.currentTarget.select()}
						/>
					</div>

					<div className="qr-modal-actions">
						<Button
							type="button"
							onClick={handleCopyLink}
							className="w-full"
							variant="default"
						>
							<Copy className="h-4 w-4 mr-2" />
							<span>Copy Link</span>
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

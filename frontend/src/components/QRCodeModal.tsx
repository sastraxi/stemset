import { Copy, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
	const timestampedUrl = currentTime
		? `${qrUrl}?t=${Math.floor(currentTime)}`
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

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) {
				onClose();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div className="qr-modal-overlay" onClick={onClose}>
			<div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
				<div className="qr-modal-header">
					<div className="qr-modal-title">
						<QrCode className="h-6 w-6" />
						<span>Share Track</span>
					</div>
					<button onClick={onClose} className="qr-modal-close" title="Close">
						<X className="h-5 w-5" />
					</button>
				</div>

				<div className="qr-modal-body">
					<p className="qr-modal-description">
						Scan this QR code to view this recording, or copy the timestamped
						link below
					</p>

					{error ? (
						<div className="qr-modal-error">{error}</div>
					) : (
						<div className="qr-modal-qr-container">
							<canvas ref={canvasRef} className="qr-modal-canvas" />
						</div>
					)}

					<div className="qr-modal-url">
						<input
							type="text"
							value={timestampedUrl}
							readOnly
							className="qr-modal-url-input"
							onClick={(e) => e.currentTarget.select()}
						/>
					</div>

					<div className="qr-modal-actions">
						<button
							type="button"
							onClick={handleCopyLink}
							className="qr-modal-action-button qr-modal-copy-button"
						>
							<Copy className="h-4 w-4" />
							<span>Copy Link</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

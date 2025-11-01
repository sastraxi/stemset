import { useEffect, useRef, useState } from "react";
import { X, QrCode } from "lucide-react";
import QRCode from "qrcode";
import "./QRCodeModal.css";

interface QRCodeModalProps {
	isOpen: boolean;
	onClose: () => void;
	url: string;
}

export function QRCodeModal({ isOpen, onClose, url }: QRCodeModalProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (isOpen && canvasRef.current && url) {
			QRCode.toCanvas(canvasRef.current, url, {
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
	}, [isOpen, url]);

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
						<QrCode className="h-5 w-5" />
						<span>Share Track</span>
					</div>
					<button onClick={onClose} className="qr-modal-close" title="Close">
						<X className="h-5 w-5" />
					</button>
				</div>

				<div className="qr-modal-body">
					<p className="qr-modal-description">
						Scan this QR code to upload your own track or view this recording
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
							value={url}
							readOnly
							className="qr-modal-url-input"
							onClick={(e) => e.currentTarget.select()}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

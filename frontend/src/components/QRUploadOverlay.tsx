import { useState } from "react";
import { X, Upload as UploadIcon, ArrowRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "./Upload";
import "./QRUploadOverlay.css";

interface QRUploadOverlayProps {
	profileName: string;
	recordingName: string;
	onUploadComplete: () => void;
	onNavigateToRecording: (profileName: string, fileName: string) => void;
}

export function QRUploadOverlay({
	profileName,
	recordingName,
	onUploadComplete,
	onNavigateToRecording,
}: QRUploadOverlayProps) {
	const [isClosing, setIsClosing] = useState(false);
	const navigate = useNavigate();

	const handleGoToRecording = () => {
		navigate({
			to: "/p/$profileName/$recordingName",
			params: { profileName, recordingName },
			search: {}, // Remove the source=qr parameter
		});
	};

	const handleClose = () => {
		setIsClosing(true);
		// Small delay to allow animation, then navigate
		setTimeout(() => {
			handleGoToRecording();
		}, 150);
	};

	return (
		<div className={`qr-upload-overlay ${isClosing ? "closing" : ""}`}>
			<div className="qr-upload-content">
				<div className="qr-upload-header">
					<div className="qr-upload-title">
						<UploadIcon className="h-6 w-6" />
						<span>Upload Your Track</span>
					</div>
					<button
						onClick={handleClose}
						className="qr-upload-close"
						title="Close and view original track"
					>
						<X className="h-5 w-5" />
					</button>
				</div>

				<div className="qr-upload-body">
					<p className="qr-upload-description">
						Welcome! Upload your own audio file to create stems and see how it
						sounds, or view the original track that was shared with you.
					</p>

					<div className="qr-upload-actions">
						<Upload
							profileName={profileName}
							onUploadComplete={onUploadComplete}
							onNavigateToRecording={onNavigateToRecording}
							shouldAutoNavigate={() => true}
						/>

						<div className="qr-upload-divider">
							<span>or</span>
						</div>

						<button
							onClick={handleGoToRecording}
							className="qr-upload-view-original"
						>
							View Original Recording
							<ArrowRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

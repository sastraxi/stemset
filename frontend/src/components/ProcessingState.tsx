import { Loader2 } from "lucide-react";
import "../styles/processing.css";

interface ProcessingStateProps {
	displayName: string;
	status?: "processing" | "error";
	errorMessage?: string;
}

export function ProcessingState({
	displayName,
	status = "processing",
	errorMessage,
}: ProcessingStateProps) {
	if (status === "error") {
		return (
			<div className="processing-state">
				<div className="processing-content error">
					<div className="processing-icon error-icon">⚠️</div>
					<h2 className="processing-title">Processing Failed</h2>
					<p className="processing-message">
						An error occurred while processing <strong>{displayName}</strong>
					</p>
					{errorMessage && (
						<p className="processing-error-detail">{errorMessage}</p>
					)}
					<p className="processing-hint">
						Please try uploading the file again or contact support if the problem
						persists.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="processing-state">
			<div className="processing-content">
				<Loader2 className="processing-spinner" />
				<h2 className="processing-title">Processing Recording</h2>
				<p className="processing-message">
					Separating stems for <strong>{displayName}</strong>
				</p>
				<p className="processing-hint">
					This usually takes 1-3 minutes. The page will automatically update
					when processing is complete.
				</p>
			</div>
		</div>
	);
}

import { createFileRoute } from "@tanstack/react-router";
import { RecordingPage } from "../../../components/RecordingPage";

export const Route = createFileRoute("/p/$profileName/$recordingName")({
	component: RecordingPage,
	validateSearch: (search) => {
		return {
			t: typeof search.t === "number" ? search.t : undefined,
			source: typeof search.source === "string" ? search.source : undefined,
		} as { t?: number; source?: string };
	},
	// Note: Playback position from URL parameter (t) is now handled by the component
	// directly via the recording config API, not localStorage
});

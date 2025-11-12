import { createFileRoute } from "@tanstack/react-router";
import { ClipPage } from "../../../../components/ClipPage";

export const Route = createFileRoute("/p/$profileName/clips/$clipId")({
	component: ClipPage,
	validateSearch: (search) => {
		return {
			t: typeof search.t === "number" ? search.t : undefined,
		} as { t?: number };
	},
});

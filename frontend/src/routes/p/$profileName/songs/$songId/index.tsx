import { createFileRoute } from "@tanstack/react-router";
import { SongPage } from "@/components/pages/SongPage";

export const Route = createFileRoute("/p/$profileName/songs/$songId/")({
  component: SongPage,
});

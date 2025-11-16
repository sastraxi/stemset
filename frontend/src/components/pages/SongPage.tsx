import { useParams } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthenticatedApp } from "@/components/app/AuthenticatedApp";
import { useAuth } from "@/contexts/AuthContext";
import { LoginPage } from "./LoginPage";

/**
 * SongPage - Displays a song's clips with authentication wrapper.
 *
 * Follows the same pattern as RecordingPage and ClipPage.
 */
export function SongPage() {
  const { profileName, songId } = useParams({
    from: "/p/$profileName/songs/$songId/",
  });
  const { authStatus, loading: authLoading } = useAuth();

  // Show login page if not authenticated
  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!authStatus?.authenticated) {
    return <LoginPage />;
  }

  return (
    <>
      <Toaster position="bottom-right" />
      <AuthenticatedApp initialProfile={profileName} initialSong={songId} />
    </>
  );
}

import { useParams, useSearch } from "@tanstack/react-router";
import { AuthenticatedApp } from "./AuthenticatedApp";
import { useAuth } from "../contexts/AuthContext";
import { LoginPage } from "./LoginPage";
import { Toaster } from "sonner";

/**
 * ClipPage - Displays a single clip with authentication wrapper.
 *
 * Follows the same pattern as RecordingPage - wraps the clip view in AuthenticatedApp.
 */
export function ClipPage() {
  const { profileName, clipId } = useParams({
    from: "/p/$profileName/clips/$clipId",
  });
  const { t: timeParam } = useSearch({ from: "/p/$profileName/clips/$clipId" });
  const { authStatus, loading: authLoading, logout } = useAuth();

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
      <AuthenticatedApp
        initialProfile={profileName}
        initialClip={clipId}
        timeParam={timeParam}
      />
    </>
  );
}

import { useParams, useSearch } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthenticatedApp } from "@/components/app/AuthenticatedApp";
import { useAuth } from "@/contexts/AuthContext";
import { LoginPage } from "./LoginPage";

export function RecordingPage() {
  const { profileName, recordingName } = useParams({
    from: "/p/$profileName/$recordingName",
  });
  const { source, initialState } = useSearch({
    from: "/p/$profileName/$recordingName",
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
      <AuthenticatedApp
        initialProfile={profileName}
        initialRecording={recordingName}
        sourceParam={source}
        initialStateParam={initialState}
      />
    </>
  );
}

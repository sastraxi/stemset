import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoginPage } from "../components/LoginPage";
import {
  getSessionProfile,
  getSessionRecording,
  setSessionProfile,
  clearSessionRecording,
} from "../lib/storage";
import { useProfiles, useProfileFiles } from "../hooks/queries";
import { Spinner } from "./ui/spinner";

export function HomePage() {
  const { authStatus, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { data: profiles, isLoading: profilesLoading } = useProfiles();
  const [lastProfile, setLastProfile] = useState<string | null>(null);

  // Get the last profile on mount
  useEffect(() => {
    if (authStatus?.authenticated) {
      setLastProfile(getSessionProfile());
    }
  }, [authStatus]);

  const { data: lastProfileFiles } = useProfileFiles(lastProfile || undefined);

  useEffect(() => {
    if (!authStatus?.authenticated || profilesLoading || !profiles) return;

    // Validate lastProfile still exists, clear if not
    const validLastProfile =
      lastProfile && profiles.some((p) => p.name === lastProfile);
    if (lastProfile && !validLastProfile) {
      console.log(
        "[HomePage] Clearing invalid lastProfile from localStorage:",
        lastProfile,
      );
      setSessionProfile("");
      setLastProfile(null);
    }

    const profileToUse = validLastProfile
      ? lastProfile
      : profiles.length > 0
        ? profiles[0].name
        : null;

    if (!profileToUse) {
      // No profiles exist - show empty state
      return;
    }

    // If we're checking the last profile, wait for files to load to validate recording
    if (lastProfile === profileToUse && lastProfileFiles !== undefined) {
      const lastRecording = getSessionRecording(lastProfile);

      // Validate lastRecording still exists
      const validRecording =
        lastRecording && lastProfileFiles.some((f) => f.name === lastRecording);
      if (lastRecording && !validRecording) {
        console.log(
          "[HomePage] Clearing invalid lastRecording from localStorage:",
          lastRecording,
        );
        clearSessionRecording(lastProfile);
      }

      if (validRecording) {
        // Valid recording exists, redirect to it
        console.log(
          "Redirecting to last recording:",
          lastProfile,
          lastRecording,
        );
        navigate({
          to: "/p/$profileName/$recordingName",
          params: { profileName: lastProfile, recordingName: lastRecording },
        });
      } else {
        // No valid recording, just go to profile
        navigate({
          to: "/p/$profileName",
          params: { profileName: lastProfile },
        });
      }
    } else if (lastProfile !== profileToUse) {
      // Using a different profile (fallback), just go to profile page
      navigate({
        to: "/p/$profileName",
        params: { profileName: profileToUse },
      });
    }
  }, [
    authStatus,
    profiles,
    profilesLoading,
    navigate,
    lastProfile,
    lastProfileFiles,
  ]);

  // Show login page if not authenticated
  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!authStatus?.authenticated) {
    return <LoginPage />;
  }

  // Show loading while we determine where to redirect
  if (profilesLoading || !profiles) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <h1>Stemset</h1>
          <p className="splash-subtitle">Loading profiles...</p>
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  // Show empty state if no profiles exist
  if (profiles.length === 0) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <h1>Stemset</h1>
          <p className="splash-subtitle">No profiles configured</p>
          <div className="splash-instructions">
            <p>
              To get started, configure a profile in your backend{" "}
              <code>config.yaml</code>:
            </p>
            <pre>
              <code>
                profiles: - name: "my-recordings" source_folder:
                "/path/to/audio/files" strategy: "hdemucs_mmi"
              </code>
            </pre>
            <p className="splash-hint">
              Then process some audio files using the CLI:
            </p>
            <pre>
              <code>uv run stemset process my-recordings</code>
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // This shouldn't render since we redirect above, but just in case
  return (
    <div className="splash-screen">
      <div className="splash-content">
        <h1>Stemset</h1>
        <p className="splash-subtitle">Redirecting...</p>
      </div>
    </div>
  );
}

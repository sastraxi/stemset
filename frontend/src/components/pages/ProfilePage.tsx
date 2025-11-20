import { useParams } from "@tanstack/react-router";
import { AuthenticatedApp } from "@/components/app/AuthenticatedApp";
import { useAuth } from "@/contexts/AuthContext";
import { LoginPage } from "./LoginPage";
import { Toaster } from "sonner";

export function ProfilePage() {
  const { profileName } = useParams({ from: "/p/$profileName" });
  const { authStatus, loading: authLoading } = useAuth();

  // Show login page if not authenticated
  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!authStatus?.authenticated) {
    return <LoginPage />;
  }

  // Check if we're on the home route (no recording/clip/song selected)
  const isHomePage = true; // This is the profile index route, so always home page

  return (
    <>
      <Toaster position="bottom-right" />
      <AuthenticatedApp
        showSidebar={!isHomePage}
        initialProfile={profileName}
      />
    </>
  );
}

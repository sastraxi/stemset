import { useParams } from "@tanstack/react-router";
import { AuthenticatedApp } from "./AuthenticatedApp";
import { useAuth } from "../contexts/AuthContext";
import { LoginPage } from "./LoginPage";
import { Toaster } from "sonner";

export function ProfilePage() {
	const { profileName } = useParams({ from: "/p/$profileName" });
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
				user={authStatus.user!}
				onLogout={logout}
				initialProfile={profileName}
			/>
		</>
	);
}

import { useAuth } from "../contexts/AuthContext";
import "./LoginPage.css";

export function LoginPage() {
	const { login } = useAuth();

	return (
		<div className="login-page">
			<div className="login-container">
				<h1>Stemset</h1>
				<p className="subtitle">AI-powered stem separation for band practice</p>
				<button onClick={login} className="login-button">
					Sign in with Google
				</button>
			</div>
		</div>
	);
}

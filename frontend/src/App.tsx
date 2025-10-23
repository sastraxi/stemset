import { useEffect, useState } from 'react';
import { StemPlayer } from './components/StemPlayer';
import { LoginPage } from './components/LoginPage';
import { UserNav } from './components/UserNav';
import { useAuth } from './contexts/AuthContext';
import { getProfiles, getProfileFiles } from './api';
import type { Profile, StemFile } from './types';
import { Toaster, toast } from 'sonner';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/splash.css';
import './styles/player.css';
import './styles/waveform.css';
import './styles/effects.css';

function App() {
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
      <AuthenticatedApp user={authStatus.user!} onLogout={logout} />
    </>
  );
}

function AuthenticatedApp({ user, onLogout }: { user: { id: string; name: string; email: string; picture?: string }; onLogout: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [files, setFiles] = useState<StemFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<StemFile | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  useEffect(() => {
    // Initial connection check and load profiles
    checkBackendConnection().then((connected) => {
      if (connected) {
        loadProfiles();
      }
    });

    // Poll backend connection every 5 seconds
    const interval = setInterval(async () => {
      try {
        await getProfiles();

        // If we were disconnected and just reconnected, reload profiles
        if (backendConnected === false) {
          await loadProfiles();
        }

        setBackendConnected(true);
      } catch (error) {
        // Backend not reachable
        setBackendConnected(false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [backendConnected]); // Re-run when connection status changes

  useEffect(() => {
    if (selectedProfile) {
      loadProfileFiles(selectedProfile);
    }
  }, [selectedProfile]);

  async function checkBackendConnection(): Promise<boolean> {
    try {
      // Simple connection check - getProfiles will throw if backend is down
      await getProfiles();
      setBackendConnected(true);
      return true;
    } catch (error) {
      console.error('Backend not connected:', error);
      setBackendConnected(false);
      return false;
    }
  }

  async function loadProfiles() {
    try {
      const data = await getProfiles();
      setProfiles(data);
      if (data.length > 0 && !selectedProfile) {
        setSelectedProfile(data[0].name);
      }
    } catch (error) {
      console.error('Error loading profiles:', error);
    }
  }

  async function loadProfileFiles(profileName: string) {
    try {
      const data = await getProfileFiles(profileName);
      setFiles(data);
    } catch (error) {
      console.error('Error loading files:', error);
    }
  }

  async function handleRefresh() {
    if (!selectedProfile) return;

    try {
      await loadProfileFiles(selectedProfile);
      toast.success('Refreshed file list');
    } catch (error) {
      console.error('Error refreshing files:', error);
      toast.error('Error refreshing file list');
    }
  }

  // Show splash screen if backend is not connected
  if (backendConnected === false) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <h1>Stemset</h1>
          <p className="splash-subtitle">Backend not running</p>
          <div className="splash-instructions">
            <p>Please start the backend server:</p>
            <pre><code>python -m src.main</code></pre>
            <p className="splash-hint">The frontend will automatically connect when the backend is ready.</p>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while checking connection
  if (backendConnected === null) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <h1>Stemset</h1>
          <p className="splash-subtitle">Connecting to backend...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>Stemset</h1>
          <p>AI-powered stem separation for band practice</p>
        </div>
        <div className="header-right">
          <UserNav user={user} onLogout={onLogout} />
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <div className="profile-selector">
            <h2>Profile</h2>
            <select
              value={selectedProfile || ''}
              onChange={(e) => setSelectedProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button onClick={handleRefresh} disabled={!selectedProfile}>
              Refresh Files
            </button>
          </div>

          <div className="file-list">
            <h2>Recordings</h2>
            {files.length === 0 ? (
              <p className="empty-state">No processed files yet. Use the CLI to process audio files.</p>
            ) : (
              <ul>
                {files.map((file) => (
                  <li
                    key={file.name}
                    className={selectedFile?.name === file.name ? 'selected' : ''}
                    onClick={() => setSelectedFile(file)}
                  >
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="player-area">
          {selectedFile && selectedProfile ? (
            <>
              <h2>{selectedFile.name}</h2>
              <StemPlayer
                profileName={selectedProfile}
                fileName={selectedFile.name}
                metadataUrl={selectedFile.metadata_url}
              />
            </>
          ) : (
            <div className="empty-state">
              <p>Select a recording to start playing</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

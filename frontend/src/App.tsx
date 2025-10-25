import { useEffect, useState, useRef } from 'react';
import { RefreshCw, Play } from 'lucide-react';
import { StemPlayer, type StemPlayerHandle } from './components/StemPlayer';
import { LoginPage } from './components/LoginPage';
import { UserNav } from './components/UserNav';
import { ProfileSelector } from './components/ProfileSelector';
import { Upload } from './components/Upload';
import { Spinner } from './components/Spinner';
import { Button } from './components/ui/button';
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
  const [fileCountByProfile, setFileCountByProfile] = useState<Record<string, number>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const stemPlayerRef = useRef<StemPlayerHandle>(null);

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
      // Clear selected file when profile changes to avoid loading incorrect file
      setSelectedFile(null);
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

      // Load file counts for all profiles
      const counts: Record<string, number> = {};
      await Promise.all(
        data.map(async (profile) => {
          try {
            const files = await getProfileFiles(profile.name);
            counts[profile.name] = files.length;
          } catch (error) {
            console.error(`Error loading files for profile ${profile.name}:`, error);
            counts[profile.name] = 0;
          }
        })
      );
      setFileCountByProfile(counts);
    } catch (error) {
      console.error('Error loading profiles:', error);
    }
  }

  async function loadProfileFiles(profileName: string) {
    setLoadingFiles(true);
    try {
      const data = await getProfileFiles(profileName);
      setFiles(data);
      // Update count for this profile
      setFileCountByProfile(prev => ({ ...prev, [profileName]: data.length }));
    } catch (error) {
      console.error('Error loading files:', error);
    } finally {
      setLoadingFiles(false);
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
      <header className="px-6 py-4 flex justify-between items-center">
        <div className="flex-1 flex items-center gap-4">
          <img src="/logo.png" alt="Stemset" className="h-10 w-auto" />
          <h1 className="lowercase text-4xl font-bold tracking-tight m-0" style={{ color: '#e8e8e8' }}>Stemset</h1>
        </div>
        <div className="flex-none ml-auto flex items-center gap-3">
          <ProfileSelector
            profiles={profiles}
            selectedProfile={selectedProfile}
            onSelectProfile={setSelectedProfile}
            fileCountByProfile={fileCountByProfile}
          />
          <UserNav user={user} onLogout={onLogout} />
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          {selectedProfile && (
            <Upload
              profileName={selectedProfile}
              onUploadComplete={handleRefresh}
            />
          )}

          <div className="file-list">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white uppercase tracking-wider">Recordings</h2>
              <Button
                onClick={handleRefresh}
                disabled={!selectedProfile}
                variant="ghost"
                size="icon"
                className="h-8 w-8 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400"
                title="Refresh file list"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {loadingFiles ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="md" />
              </div>
            ) : files.length === 0 ? (
              <p className="empty-state">No processed files yet. Upload a file above or use the CLI.</p>
            ) : (
              <ul className="list-none">
                {files.map((file) => (
                  <li
                    key={file.name}
                    className={`py-2.5 px-3 m-0 bg-transparent select-none border-none border-l-2 cursor-pointer transition-all text-sm rounded-r flex items-center justify-between gap-2
                      ${selectedFile?.name === file.name
                        ? 'bg-blue-400/10 border-l-blue-400 text-white'
                        : 'border-l-transparent hover:bg-white/5 hover:border-l-gray-700 text-gray-300'
                      }`}
                    onClick={() => {
                      setSelectedFile(file);
                      // Focus the player after a short delay to allow rendering
                      setTimeout(() => stemPlayerRef.current?.focus(), 100);
                    }}
                  >
                    <span className="truncate">{file.name}</span>
                    {selectedFile?.name === file.name && (
                      <Play className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" fill="currentColor" />
                    )}
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
                ref={stemPlayerRef}
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

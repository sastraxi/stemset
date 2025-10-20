import { useEffect, useState } from 'react';
import { StemPlayer } from './components/StemPlayer';
import { Toast } from './components/Toast';
import { getProfiles, getProfileFiles, scanProfile, getQueueStatus } from './api';
import type { Profile, StemFile, QueueStatus } from './types';
import './App.css';

interface ToastData {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [files, setFiles] = useState<StemFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<StemFile | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [toastIdCounter, setToastIdCounter] = useState(0);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = toastIdCounter;
    setToastIdCounter(id + 1);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const closeToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  useEffect(() => {
    // Initial connection check
    checkBackendConnection().then((connected) => {
      if (connected) {
        loadProfiles();
        loadQueueStatus();
      }
    });

    let wasProcessing = false;
    let wasConnected = backendConnected;

    // Poll backend connection and queue status every 2 seconds
    const interval = setInterval(async () => {
      try {
        // Try to fetch queue status - this also serves as a connection check
        const status = await getQueueStatus();
        setQueueStatus(status);

        // Check if we just reconnected
        const justConnected = !wasConnected && backendConnected !== false;
        if (justConnected) {
          // Backend just came online, reload profiles
          await loadProfiles();
        }

        setBackendConnected(true);
        wasConnected = true;

        // Refresh file list when processing just completed
        const justFinished = wasProcessing && !status.is_processing && status.queue_size === 0;
        if (selectedProfile && justFinished) {
          await loadProfileFiles(selectedProfile);
        }

        wasProcessing = status.is_processing;
      } catch (error) {
        // Backend not reachable
        setBackendConnected(false);
        wasConnected = false;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []); // Only run once on mount

  useEffect(() => {
    if (selectedProfile) {
      loadProfileFiles(selectedProfile);
    }
  }, [selectedProfile]);

  async function checkBackendConnection(): Promise<boolean> {
    try {
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

  async function loadQueueStatus() {
    try {
      const data = await getQueueStatus();
      setQueueStatus(data);
    } catch (error) {
      // Don't log error - it's normal when backend is down
      // Connection state is handled by the polling interval
    }
  }

  async function handleScan() {
    if (!selectedProfile) return;

    setIsScanning(true);
    try {
      const result = await scanProfile(selectedProfile);
      if (result.scanned === 0) {
        showToast('No new files found', 'info');
      } else {
        showToast(`Found ${result.scanned} new file(s), queued for processing`, 'success');
      }
      await loadQueueStatus();
      // Refresh file list after a delay to allow processing
      setTimeout(() => loadProfileFiles(selectedProfile), 1000);
    } catch (error) {
      console.error('Error scanning:', error);
      showToast('Error scanning for new files', 'error');
    } finally {
      setIsScanning(false);
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
        <h1>Stemset</h1>
        <p>AI-powered stem separation for band practice</p>
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
            <button onClick={handleScan} disabled={!selectedProfile || isScanning}>
              {isScanning ? 'Scanning...' : 'Scan for New Files'}
            </button>
          </div>

          {queueStatus && (
            <div className="queue-status">
              <h3>Queue Status</h3>
              <p>Queue: {queueStatus.queue_size} job(s)</p>
              {queueStatus.is_processing && queueStatus.current_job && (
                <p className="processing">
                  Processing: {queueStatus.current_job.input_file.split('/').pop()}
                </p>
              )}
            </div>
          )}

          <div className="file-list">
            <h2>Recordings</h2>
            {files.length === 0 ? (
              <p className="empty-state">No processed files yet. Click "Scan for New Files" to get started.</p>
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
                stems={selectedFile.stems}
                profileName={selectedProfile}
                fileName={selectedFile.name}
              />
            </>
          ) : (
            <div className="empty-state">
              <p>Select a recording to start playing</p>
            </div>
          )}
        </main>
      </div>

      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => closeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default App;

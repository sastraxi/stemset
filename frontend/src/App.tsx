import { useEffect, useState } from 'react';
import { StemPlayer } from './components/StemPlayer';
import { getProfiles, getProfileFiles, scanProfile, getQueueStatus } from './api';
import type { Profile, StemFile, QueueStatus } from './types';
import './App.css';

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [files, setFiles] = useState<StemFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<StemFile | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    loadProfiles();
    // Poll queue status every 2 seconds
    const interval = setInterval(loadQueueStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadProfileFiles(selectedProfile);
    }
  }, [selectedProfile]);

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
      setFiles(data.files);
    } catch (error) {
      console.error('Error loading files:', error);
    }
  }

  async function loadQueueStatus() {
    try {
      const data = await getQueueStatus();
      setQueueStatus(data);
    } catch (error) {
      console.error('Error loading queue status:', error);
    }
  }

  async function handleScan() {
    if (!selectedProfile) return;

    setIsScanning(true);
    try {
      const result = await scanProfile(selectedProfile);
      alert(`Scanned: ${result.scanned} new file(s) found and queued for processing`);
      await loadQueueStatus();
      // Refresh file list after a delay to allow processing
      setTimeout(() => loadProfileFiles(selectedProfile), 1000);
    } catch (error) {
      console.error('Error scanning:', error);
      alert('Error scanning for new files');
    } finally {
      setIsScanning(false);
    }
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
          {selectedFile ? (
            <>
              <h2>{selectedFile.name}</h2>
              <StemPlayer stems={selectedFile.stems} />
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

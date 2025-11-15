import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiSongsSongIdClipsGetSongClips } from "@/api/generated";
import { QRCodeModal } from "./QRCodeModal";
import { SongClipRow } from "./SongClipRow";
import { SongPageHeader } from "./SongPageHeader";
import { Spinner } from "./ui/spinner";
import "../styles/song-page.css";

interface SongPageViewProps {
  songId: string;
  songName: string;
  profileName: string;
}

/**
 * SongPageView - SoundCloud-inspired song page with clip players
 */
export function SongPageView({
  songId,
  songName,
  profileName,
}: SongPageViewProps) {
  const [showQRModal, setShowQRModal] = useState(false);
  const [shareClipId, setShareClipId] = useState<string | null>(null);

  // Fetch clips for this song
  const {
    data: clipsResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["song-clips", songId],
    queryFn: () =>
      apiSongsSongIdClipsGetSongClips({
        path: { song_id: songId },
      }),
  });

  const clips = clipsResponse?.data || [];

  // Calculate total duration
  const totalDuration = useMemo(() => {
    return clips.reduce((sum, clip) => {
      return sum + (clip.end_time_sec - clip.start_time_sec);
    }, 0);
  }, [clips]);

  // Handle share song
  const handleShare = () => {
    setShareClipId(null); // Share song, not a clip
    setShowQRModal(true);
  };

  // Handle share clip
  const handleShareClip = (clipId: string) => {
    setShareClipId(clipId);
    setShowQRModal(true);
  };

  // Build share URL
  const shareUrl = shareClipId
    ? `${window.location.origin}/p/${profileName}/clips/${shareClipId}`
    : `${window.location.origin}/p/${profileName}/songs/${songId}`;

  if (isLoading) {
    return (
      <div className="song-page-loading">
        <Spinner size="lg" />
        <p>Loading clips...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="song-page-error">
        <p>Error loading clips. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="song-page-view">
      <SongPageHeader
        songName={songName}
        clipCount={clips.length}
        totalDuration={totalDuration}
        onShare={handleShare}
      />

      {clips.length === 0 ? (
        <div className="song-page-empty">
          <p>No clips in this song yet.</p>
          <p className="song-page-empty-hint">
            Create clips from recordings and assign them to this song.
          </p>
        </div>
      ) : (
        <div className="song-clips-list">
          {clips.map((clip) => (
            <SongClipRow
              key={clip.id}
              clip={clip}
              profileName={profileName}
              onShare={() => handleShareClip(clip.id)}
            />
          ))}
        </div>
      )}

      {/* QR Code Modal */}
      {showQRModal && (
        <QRCodeModal
          isOpen={showQRModal}
          onClose={() => {
            setShowQRModal(false);
            setShareClipId(null);
          }}
          url={shareUrl}
        />
      )}
    </div>
  );
}

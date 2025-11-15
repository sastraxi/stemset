import { Music2, Edit, Share2 } from "lucide-react";
import { Button } from "./ui/button";

interface SongPageHeaderProps {
  songName: string;
  clipCount: number;
  totalDuration: number; // Total duration of all clips in seconds
  onShare: () => void;
  onEdit?: () => void;
}

/** Format duration in MM:SS */
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * SongPageHeader - Header for song page with metadata and actions
 */
export function SongPageHeader({
  songName,
  clipCount,
  totalDuration,
  onShare,
  onEdit,
}: SongPageHeaderProps) {
  return (
    <div className="song-page-header">
      <div className="song-page-header-content">
        <Music2 className="song-page-icon" />
        <div className="song-page-title-section">
          <h1 className="song-page-title">{songName}</h1>
          <div className="song-page-stats">
            <span>
              {clipCount} {clipCount === 1 ? "clip" : "clips"}
            </span>
            <span className="song-page-stats-separator">•</span>
            <span>{formatDuration(totalDuration)}</span>
          </div>
        </div>
      </div>

      <div className="song-page-actions">
        <Button
          onClick={onShare}
          variant="outline"
          size="sm"
          className="song-page-action-button"
        >
          <Share2 className="h-4 w-4 mr-2" />
          Share
        </Button>
        {onEdit && (
          <Button
            onClick={onEdit}
            variant="outline"
            size="sm"
            className="song-page-action-button"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

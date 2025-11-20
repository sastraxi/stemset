import { Circle, Mic, Square, Trash2, Upload as UploadIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VuMeter } from "@/components/player/VuMeter";
import { RecordingWaveform } from "./RecordingWaveform";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useRecordingVuMeter } from "@/hooks/useRecordingVuMeter";
import "./RecordingModal.css";

export interface RecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileName: string;
  onUpload: (audioBlob: Blob, filename: string) => Promise<void>;
}

/**
 * Modal for recording audio from the user's microphone.
 *
 * Features:
 * - Start/Stop recording
 * - Live VU meters (stereo)
 * - Waveform visualization
 * - Recording timer
 * - Save (upload) or Reset
 */
export function RecordingModal({
  isOpen,
  onClose,
  profileName,
  onUpload,
}: RecordingModalProps) {
  const { state, controls } = useAudioRecorder();
  const levels = useRecordingVuMeter(state.mediaStream, state.isRecording);

  const { isRecording, recordingTime, audioBlob, error } = state;
  const { startRecording, stopRecording, resetRecording } = controls;

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // Format recording time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartRecording = async () => {
    try {
      await startRecording();
    } catch (err) {
      // Error handling is done in the hook
      console.error("Failed to start recording:", err);
    }
  };

  const handleSaveRecording = async () => {
    if (!audioBlob) return;

    try {
      const filename = `recording-${Date.now()}.webm`;
      await onUpload(audioBlob, filename);
      resetRecording();
      onClose();
    } catch (err) {
      console.error("Failed to upload recording:", err);
      toast.error("Failed to upload recording");
    }
  };

  const handleReset = () => {
    resetRecording();
  };

  const handleClose = () => {
    if (isRecording) {
      stopRecording();
    }
    resetRecording();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] recording-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Record Audio
          </DialogTitle>
          <DialogDescription>
            {!audioBlob
              ? `Record audio from your microphone to upload to ${profileName}`
              : `Recording complete (${formatTime(recordingTime)})`}
          </DialogDescription>
        </DialogHeader>

        <div className="recording-modal-content">
          {/* Timer and Status */}
          <div className="recording-status">
            {isRecording && (
              <div className="recording-indicator">
                <Circle className="recording-pulse" fill="currentColor" />
                <span className="recording-text">RECORDING</span>
              </div>
            )}
            <div className="recording-timer">{formatTime(recordingTime)}</div>
          </div>

          {/* VU Meter */}
          {(isRecording || audioBlob) && (
            <div className="recording-vu-container">
              <VuMeter levels={levels} />
            </div>
          )}

          {/* Waveform */}
          <div className="recording-waveform-container">
            <RecordingWaveform
              mediaStream={state.mediaStream}
              isRecording={isRecording}
              width={600}
              height={100}
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="recording-error">
              <p>{error}</p>
            </div>
          )}

          {/* Instructions */}
          {!isRecording && !audioBlob && (
            <div className="recording-instructions">
              <p>Click "Start Recording" to begin</p>
              <p className="text-sm text-muted-foreground">
                You'll be asked for microphone permission on first use
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!audioBlob ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isRecording}>
                Cancel
              </Button>
              {!isRecording ? (
                <Button onClick={handleStartRecording} className="gap-2">
                  <Mic className="h-4 w-4" />
                  Start Recording
                </Button>
              ) : (
                <Button onClick={stopRecording} variant="destructive" className="gap-2">
                  <Square className="h-4 w-4" fill="currentColor" />
                  Stop Recording
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleReset} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Reset
              </Button>
              <Button onClick={handleSaveRecording} className="gap-2">
                <UploadIcon className="h-4 w-4" />
                Save Recording
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

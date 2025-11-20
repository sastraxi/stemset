import { Circle, Mic, Square, Upload as UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [waveformResetSignal, setWaveformResetSignal] = useState(0);

  const { isRecording, recordingTime, audioBlob, error } = state;
  const { startRecording, stopRecording, resetRecording, reRecord } = controls;

  // Debug: Log recordingTime changes
  useEffect(() => {
    console.log("RecordingModal - recordingTime:", recordingTime, "isRecording:", isRecording);
  }, [recordingTime, isRecording]);

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

  const handleClose = () => {
    if (isRecording) {
      stopRecording();
    }
    resetRecording();
    onClose();
  };

  // Render VU meter segments
  const SEGMENT_COUNT = 6;

  const getLitSegments = (level: number): number => {
    return Math.floor(level * SEGMENT_COUNT);
  };

  const getSegmentColor = (index: number, isLit: boolean): string => {
    if (!isLit) return "#1a1a22";
    if (index < 3) return "#22c55e"; // Green
    if (index < 5) return "#eab308"; // Yellow
    return "#ff6b35"; // Red
  };

  const renderLeftChannel = (level: number) => {
    const leftLit = getLitSegments(level);
    return (
      <div className="flex gap-[3px] items-center">
        {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
          const segmentIndex = SEGMENT_COUNT - 1 - i;
          const isLit = segmentIndex < leftLit;
          return (
            <div
              key={i}
              className={`vu-meter-segment ${isLit ? "lit" : ""}`}
              style={{
                backgroundColor: getSegmentColor(segmentIndex, isLit),
                boxShadow: isLit
                  ? `0 0 8px ${getSegmentColor(segmentIndex, true)}`
                  : "none",
              }}
            />
          );
        })}
      </div>
    );
  };

  const renderRightChannel = (level: number) => {
    const rightLit = getLitSegments(level);
    return (
      <div className="flex gap-[3px] items-center">
        {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
          const isLit = i < rightLit;
          return (
            <div
              key={i}
              className={`vu-meter-segment ${isLit ? "lit" : ""}`}
              style={{
                backgroundColor: getSegmentColor(i, isLit),
                boxShadow: isLit
                  ? `0 0 8px ${getSegmentColor(i, true)}`
                  : "none",
              }}
            />
          );
        })}
      </div>
    );
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
          {/* Integrated VCR Display - VU Meters flanking Timecode */}
          <div className="recording-vcr-display">
            {/* VU Meters and Timecode Row */}
            <div className="recording-vcr-status">
              {/* Left Channel VU Meter */}
              {(isRecording || audioBlob) && (
                <div className="recording-vu-left">
                  {renderLeftChannel(levels.left)}
                </div>
              )}

              {/* Center: Timecode with Recording Indicator */}
              <div className="recording-vcr-center">
                <div className="recording-indicator-slot">
                  {isRecording && (
                    <div className="recording-indicator">
                      <Circle className="recording-pulse" fill="currentColor" />
                      <span className="recording-text">REC</span>
                    </div>
                  )}
                </div>
                <div className="recording-timer">{formatTime(recordingTime)}</div>
              </div>

              {/* Right Channel VU Meter */}
              {(isRecording || audioBlob) && (
                <div className="recording-vu-right">
                  {renderRightChannel(levels.right)}
                </div>
              )}
            </div>

            {/* Waveform - Integrated below */}
            <div className="recording-waveform-container">
              <RecordingWaveform
                mediaStream={state.mediaStream}
                isRecording={isRecording}
                recordingTime={recordingTime}
                resetSignal={waveformResetSignal}
              />
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="recording-error">
              <p>{error}</p>
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
              <Button
                variant="outline"
                onClick={async () => {
                  setWaveformResetSignal((prev) => prev + 1);
                  await reRecord();
                }}
                className="gap-2"
              >
                <Mic className="h-4 w-4" />
                Re-record
              </Button>
              <Button onClick={handleSaveRecording} className="gap-2">
                <UploadIcon className="h-4 w-4" />
                Process
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useRef, useEffect } from "react";
import { Mic, Square, Play, Pause, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob | null) => void;
  audioBlob: Blob | null;
  className?: string;
}

export function AudioRecorder({
  onRecordingComplete,
  audioBlob,
  className,
}: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioUrl(null);
    }
  }, [audioBlob]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = mediaRecorder;

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
        onRecordingComplete(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Failed to start recording. Please check your microphone permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const playAudio = () => {
    if (audioRef.current && audioUrl) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const pauseAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const deleteRecording = () => {
    onRecordingComplete(null);
    setIsPlaying(false);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn("border border-gray-200 rounded-lg p-4", className)}>
      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
          {error}
        </div>
      )}

      {!audioBlob ? (
        <div className="flex items-center justify-center gap-4">
          {!isRecording ? (
            <div className="text-center">
              <Button
                type="button"
                onClick={startRecording}
                size="lg"
                className="rounded-full w-16 h-16 p-0"
              >
                <Mic className="w-6 h-6" />
              </Button>
              <p className="text-sm text-gray-600 mt-2">Click to start recording</p>
            </div>
          ) : (
            <div className="text-center">
              <Button
                type="button"
                onClick={stopRecording}
                size="lg"
                variant="destructive"
                className="rounded-full w-16 h-16 p-0"
              >
                <Square className="w-6 h-6" />
              </Button>
              <p className="text-sm text-gray-600 mt-2">
                Recording: {formatTime(recordingTime)}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
              <Mic className="w-4 h-4 text-orange-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Audio Recording</p>
              <p className="text-xs text-gray-500">
                {Math.round(audioBlob.size / 1024)}KB • WebM
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={deleteRecording}
              className="h-8 w-8 text-gray-400 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={isPlaying ? pauseAudio : playAudio}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
            
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startRecording}
            >
              <Mic className="w-4 h-4 mr-1" />
              Re-record
            </Button>
          </div>

          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              style={{ display: 'none' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
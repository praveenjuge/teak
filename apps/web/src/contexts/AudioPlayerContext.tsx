import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface AudioPlayerContextType {
  playAudio: (audio: HTMLAudioElement) => void;
  pauseAudio: (audio: HTMLAudioElement) => void;
  currentlyPlaying: HTMLAudioElement | null;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

export const AudioPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentlyPlaying, setCurrentlyPlaying] = useState<HTMLAudioElement | null>(null);
  const currentlyPlayingRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = useCallback((audio: HTMLAudioElement) => {
    if (currentlyPlayingRef.current && currentlyPlayingRef.current !== audio) {
      currentlyPlayingRef.current.pause();
    }
    currentlyPlayingRef.current = audio;
    audio.play().catch(error => {
      console.error("Failed to play audio:", error);
      if (currentlyPlayingRef.current === audio) {
        currentlyPlayingRef.current = null;
        setCurrentlyPlaying(null);
      }
    });
    setCurrentlyPlaying(audio);
  }, []);

  const pauseAudio = useCallback((audio: HTMLAudioElement) => {
    if (currentlyPlayingRef.current === audio) {
      audio.pause();
      currentlyPlayingRef.current = null;
      setCurrentlyPlaying(null);
    }
  }, []);

  const value = {
    playAudio,
    pauseAudio,
    currentlyPlaying,
  };

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
    </AudioPlayerContext.Provider>
  );
};

export const useAudioPlayer = () => {
  const context = useContext(AudioPlayerContext);
  if (context === undefined) {
    throw new Error('useAudioPlayer must be used within an AudioPlayerProvider');
  }
  return context;
};

"use client";

import React, { useState, useRef } from "react";

interface VoiceTauntRecorderProps {
  onRecordingComplete: (base64: string) => void;
  savedVoice?: string;
}

const VoiceTauntRecorder: React.FC<VoiceTauntRecorderProps> = ({ 
  onRecordingComplete,
  savedVoice 
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          onRecordingComplete(base64data);
        };
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);
      
      timerRef.current = setInterval(() => {
        setDuration(prev => {
          if (prev >= 3) { // Max 3 seconds for taunt
            stopRecording();
            return 3;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const playTaunt = () => {
    if (!savedVoice) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(savedVoice);
    audioRef.current = audio;
    audio.onended = () => setIsPlaying(false);
    audio.play();
    setIsPlaying(true);
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-black/40 rounded-2xl border border-zinc-800/60 backdrop-blur-md">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Voice Taunt (Max 3s)</span>
        {isRecording && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-mono text-red-500 font-bold">{duration}s</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {!isRecording ? (
          <button
            onClick={startRecording}
            className="flex-1 py-3 bg-red-950/20 border border-red-900/40 hover:bg-red-900/30 text-red-400 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer group"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <span className="text-[9px] font-black font-mono tracking-widest uppercase">Rekam Suara</span>
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex-1 py-3 bg-red-600 text-white rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer animate-pulse"
          >
            <div className="w-2.5 h-2.5 bg-white rounded-sm" />
            <span className="text-[9px] font-black font-mono tracking-widest uppercase">Berhenti</span>
          </button>
        )}

        {savedVoice && !isRecording && (
          <button
            onClick={playTaunt}
            disabled={isPlaying}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
              isPlaying ? "bg-zinc-800 text-zinc-600" : "bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 hover:bg-emerald-900/60"
            }`}
          >
            {isPlaying ? (
              <div className="flex gap-0.5 items-center">
                <div className="w-0.5 h-2 bg-emerald-500 animate-[bounce_0.6s_infinite]" />
                <div className="w-0.5 h-3 bg-emerald-500 animate-[bounce_0.6s_infinite_0.1s]" />
                <div className="w-0.5 h-2 bg-emerald-500 animate-[bounce_0.6s_infinite_0.2s]" />
              </div>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}
      </div>
      
      {savedVoice && !isRecording && (
        <span className="text-[8px] font-mono text-emerald-600/80 uppercase tracking-tight text-center">
          ✅ Taunt Tersimpan & Siap Digunakan
        </span>
      )}
    </div>
  );
};

export default VoiceTauntRecorder;

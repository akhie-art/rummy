import React from "react";
import { RemotePlayer, ViewState } from "../../types/game";
import VoiceTauntRecorder from "../VoiceTauntRecorder";

interface HostLobbyViewProps {
  roomCode: string;
  qrCodeUrl: string;
  remotePlayers: RemotePlayer[];
  handleStartGame: () => Promise<void>;
  setView: (view: ViewState) => void;
  cardBackColor: string;
  setCardBackColor: (color: string) => void;
  tableTheme: string;
  setTableTheme: (theme: string) => void;
  voiceTaunt?: string;
  onUpdateVoiceTaunt: (base64: string) => void;
}

const HostLobbyView: React.FC<HostLobbyViewProps> = ({
  roomCode,
  qrCodeUrl,
  remotePlayers,
  handleStartGame,
  setView,
  cardBackColor,
  setCardBackColor,
  tableTheme,
  setTableTheme,
  voiceTaunt,
  onUpdateVoiceTaunt,
}) => {
  return (
    <div className="max-w-md w-full bg-black/20 backdrop-blur-md rounded-2xl p-6 relative z-10 border border-zinc-800/60 animate-fade-in">
      <button
        onClick={() => setView("landing")}
        className="text-zinc-500 hover:text-zinc-300 mb-6 text-[10px] tracking-widest font-mono uppercase flex items-center gap-1 transition-colors cursor-pointer"
      >
        Kembali
      </button>

      <div className="text-center mb-6 flex flex-col items-center">
        <span className="text-zinc-500 text-[9px] tracking-[0.2em] uppercase">
          Kode Room
        </span>
        <div className="text-4xl font-light tracking-[0.3em] mt-1 mb-6 text-zinc-200">
          {roomCode}
        </div>

        {/* Custom-Themed Minimalist QR Code Container */}
        <div className="mb-5 p-3 rounded-2xl bg-[#09251d] border border-zinc-800/40 shadow-lg shadow-black/30 hover:scale-[1.02] transition-transform duration-300">
          <img
            src={qrCodeUrl}
            alt="Scan to Join"
            className="w-32 h-32 rounded-lg object-cover"
          />
        </div>

        <span className="text-[8px] font-mono text-zinc-500 tracking-widest uppercase leading-none block mb-2">
          Pindai QR untuk Gabung
        </span>
        <span className="text-[9px] text-emerald-600 font-mono tracking-[0.15em] uppercase animate-pulse leading-none block">
          Menunggu Pemain
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 mb-6 max-h-[200px] overflow-y-auto no-scrollbar px-1">
        {remotePlayers.map((p, idx) => (
          <div
            key={idx}
            className="bg-[#061f19]/40 border border-emerald-900/20 rounded-lg px-4 py-2.5 flex items-center justify-between animate-fade-in shadow-sm"
          >
            <span
              className={`text-xs tracking-wider ${
                p.isHost
                  ? "text-zinc-400 italic font-normal"
                  : "text-zinc-200 font-light uppercase"
              }`}
            >
              {p.name} {p.isHost ? "(Spectator)" : ""}
            </span>
            <span
              className={`text-[8px] font-mono uppercase tracking-widest ${
                p.isHost ? "text-zinc-600" : "text-emerald-600 font-bold"
              }`}
            >
              {p.isHost ? "Terhubung" : "Siap"}
            </span>
          </div>
        ))}

        {remotePlayers.length <= 1 && (
          <div className="text-center py-6 border border-dashed border-zinc-900 rounded-lg bg-black/10">
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest animate-pulse">
              Menunggu Pemain Bergabung...
            </span>
          </div>
        )}
      </div>

      {/* CARD BACK CUSTOMIZATION */}
      <div className="mb-6 px-1">
        <span className="text-[8px] font-mono text-zinc-500 tracking-widest uppercase block mb-3">
          Tema Kartu (Back)
        </span>
        <div className="flex gap-3 justify-center">
          {[
            { id: "emerald", color: "bg-emerald-900", border: "border-emerald-400" },
            { id: "rose", color: "bg-rose-900", border: "border-rose-400" },
            { id: "indigo", color: "bg-indigo-900", border: "border-indigo-400" },
            { id: "amber", color: "bg-amber-900", border: "border-amber-400" },
            { id: "zinc", color: "bg-zinc-800", border: "border-zinc-400" },
          ].map((theme) => (
            <button
              key={theme.id}
              onClick={() => setCardBackColor(theme.id)}
              className={`w-10 h-14 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer ${
                cardBackColor === theme.id 
                  ? `${theme.border} scale-110 shadow-[0_0_15px_rgba(255,255,255,0.2)]` 
                  : "border-transparent opacity-40 hover:opacity-100"
              } ${theme.color}`}
            >
              <div className="w-6 h-8 border border-white/20 rounded-sm" />
            </button>
          ))}
        </div>
      </div>

      {/* TABLE THEME CUSTOMIZATION */}
      <div className="mb-8 px-1">
        <span className="text-[8px] font-mono text-zinc-500 tracking-widest uppercase block mb-3">
          Tema Meja (Background)
        </span>
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: "emerald", name: "Forest", color: "bg-emerald-950", border: "border-emerald-500" },
            { id: "midnight", name: "Deep", color: "bg-slate-950", border: "border-slate-500" },
            { id: "wood", name: "Oak", color: "bg-[#1a0f0a]", border: "border-[#8b4513]" },
            { id: "casino", name: "Vegas", color: "bg-green-950", border: "border-green-500" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTableTheme(t.id)}
              className={`py-2 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
                tableTheme === t.id 
                  ? `${t.border} bg-white/5 scale-105 shadow-lg` 
                  : "border-zinc-800/40 bg-black/20 opacity-40 hover:opacity-80"
              }`}
            >
              <div className={`w-4 h-4 rounded-full mb-1.5 ${t.color}`} />
              <span className="text-[7px] font-black uppercase tracking-tighter text-zinc-400">{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* VOICE TAUNT RECORDER */}
      <div className="mb-8">
        <VoiceTauntRecorder 
          onRecordingComplete={onUpdateVoiceTaunt}
          savedVoice={voiceTaunt}
        />
      </div>

      <button
        onClick={handleStartGame}
        disabled={remotePlayers.length <= 1}
        className={`w-full py-2.5 rounded-lg border text-xs font-medium tracking-widest transition-all uppercase cursor-pointer ${
          remotePlayers.length <= 1
            ? "bg-zinc-950 border-zinc-900 text-zinc-700 cursor-not-allowed opacity-60"
            : "bg-zinc-900/80 border-zinc-700 hover:border-emerald-600/60 text-zinc-200 hover:bg-emerald-950/10 hover:text-emerald-400"
        }`}
      >
        Mulai Game
      </button>
    </div>
  );
};

export default HostLobbyView;

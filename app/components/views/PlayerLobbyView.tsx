import React from "react";
import { RemotePlayer } from "../../types/game";

interface PlayerLobbyViewProps {
  roomCode: string;
  playerName: string;
  remotePlayers: RemotePlayer[];
  sendLobbyEmoji: (emoji: string) => Promise<void>;
}

const PlayerLobbyView: React.FC<PlayerLobbyViewProps> = ({
  roomCode,
  playerName,
  remotePlayers,
  sendLobbyEmoji,
}) => {
  return (
    <div className="max-w-md w-full bg-black/30 backdrop-blur-xl rounded-3xl p-6 text-center border border-emerald-900/20 shadow-2xl relative overflow-hidden animate-fade-in">
      {/* Decorative Ambient Glow behind lobby */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header Lounge */}
      <div className="mb-6 flex flex-col items-center relative z-10">
        <span className="text-[8px] font-mono text-emerald-600 uppercase tracking-[0.3em] mb-1 leading-none">
          Multiplayer Lounge
        </span>
        <h2 className="text-xl font-light tracking-[0.2em] uppercase text-zinc-100">
          Ruang Tunggu
        </h2>
        <div className="mt-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/50 text-zinc-400 font-mono text-[10px] tracking-widest uppercase">
          ROOM: <b className="text-emerald-400">{roomCode}</b>
        </div>
      </div>

      {/* Participant List - Instant real-time grid! */}
      <div className="relative z-10 mb-6">
        <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest mb-2 block text-left px-1">
          Pemain Terhubung ({remotePlayers.length})
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[120px] overflow-y-auto no-scrollbar">
          {remotePlayers.map((p, idx) => (
            <div
              key={idx}
              className={`px-3 py-2 rounded-xl border flex items-center justify-between transition-all ${
                p.name.toUpperCase() === playerName.toUpperCase()
                  ? "bg-emerald-950/20 border-emerald-700/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                  : "bg-black/20 border-zinc-800/80"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    p.isHost ? "bg-zinc-700" : "bg-emerald-500 animate-pulse"
                  }`}
                />
                <span
                  className={`text-xs truncate uppercase tracking-wider ${
                    p.name.toUpperCase() === playerName.toUpperCase()
                      ? "text-emerald-400 font-medium"
                      : "text-zinc-300"
                  }`}
                >
                  {p.name}
                </span>
              </div>
              <span
                className={`text-[8px] font-mono uppercase px-2 py-0.5 rounded-full ${
                  p.isHost
                    ? "bg-zinc-900 text-zinc-500 border border-zinc-800"
                    : "bg-emerald-950/50 text-emerald-500 border border-emerald-900/40"
                }`}
              >
                {p.isHost ? "Spectator" : "Siap"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ⚡⚡ QUICK INTERACTIVE REACTION BAR ⚡⚡ */}
      <div className="relative z-10 bg-black/20 border border-zinc-800/60 rounded-2xl p-4 mb-6 shadow-inner">
        <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-[0.15em] block mb-3">
          Kirim Reaksi Instan ke Lawan 🔥
        </span>
        <div className="flex items-center justify-center gap-3.5">
          {["🔥", "😎", "😜", "⏰", "👊", "🤣"].map((emoji) => (
            <button
              key={emoji}
              onClick={() => sendLobbyEmoji(emoji)}
              className="w-10 h-10 rounded-full bg-zinc-900/80 hover:bg-emerald-950 border border-zinc-800 hover:border-emerald-600/50 text-lg flex items-center justify-center hover:scale-110 active:scale-90 shadow-sm shadow-black transition-all cursor-pointer relative group"
            >
              <div className="absolute inset-0 rounded-full bg-emerald-500/0 group-hover:bg-emerald-500/5 animate-ping duration-1000 pointer-events-none" />
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Footer Spinner Area */}
      <div className="relative z-10 flex flex-col items-center justify-center py-1 border-t border-zinc-900">
        <div className="flex items-center gap-2.5 mt-4">
          <div className="w-3.5 h-3.5 rounded-full border border-emerald-600/20 border-t-emerald-400 animate-spin" />
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
            Menunggu Host Mulai Game...
          </span>
        </div>
      </div>
    </div>
  );
};

export default PlayerLobbyView;

import React, { useState } from "react";
import { RemotePlayer } from "../../types/game";
import { getCardPoints } from "../../utils/gameLogic";

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  remotePlayers: RemotePlayer[];
}

const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  isOpen,
  onClose,
  remotePlayers,
}) => {
  const mode = "tournament";

  if (!isOpen) return null;

  // Exclude the Host Spectator from competitive rankings
  const activePlayers = remotePlayers.filter((p) => !p.isHost);

  // Calculate data based on tournament scores
  const rankedList = activePlayers
    .map((player) => {
      return {
        ...player,
        displayScore: player.score,
      };
    })
    // Highest score wins (points accumulated from melds)
    .sort((a, b) => b.displayScore - a.displayScore);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 animate-fade-in select-none">
      {/* Deep glassmorphic backdrop blur */}
      <div
        className="absolute inset-0 bg-[#040d0b]/80 backdrop-blur-md transition-all cursor-pointer"
        onClick={onClose}
      />

      {/* Glassmorphic Modal Card container */}
      <div className="relative bg-[#061a15]/90 border border-zinc-800/60 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl shadow-black/50 scale-up">
        
        {/* Subtle glow gradient in background */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800/50 relative z-10 flex justify-between items-center bg-black/20">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🏆</span>
            <div>
              <h3 className="text-sm font-medium tracking-[0.2em] uppercase text-zinc-100 leading-none">
                Klasemen Turnamen
              </h3>
              <span className="text-[8px] font-mono text-emerald-500 uppercase tracking-widest mt-1 block leading-none">
                Akumulasi Poin Kartu Jadi
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full border border-zinc-800 bg-black/40 flex items-center justify-center hover:bg-zinc-900/50 hover:border-zinc-700 text-zinc-400 transition-all cursor-pointer"
          >
            ×
          </button>
        </div>

        {/* Ranked Items List */}
        <div className="px-4 pb-6 pt-1 max-h-[320px] overflow-y-auto no-scrollbar relative z-10 flex flex-col gap-2.5">
          {rankedList.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-zinc-900 rounded-2xl bg-black/10">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
                Belum Ada Pemain Bermain
              </span>
            </div>
          ) : (
            rankedList.map((player, index) => {
              const isFirst = index === 0;
              const isSecond = index === 1;
              const isThird = index === 2;

              let borderStyle = "border-zinc-800/40 bg-black/20";
              let rankBadge = (
                <span className="text-[10px] font-mono text-zinc-500">
                  #{index + 1}
                </span>
              );
              let nameColor = "text-zinc-300";

              if (isFirst) {
                borderStyle =
                  "border-amber-600/30 bg-amber-950/5 shadow-[0_0_15px_rgba(245,158,11,0.03)]";
                rankBadge = <span className="text-base" title="Juara 1">🥇</span>;
                nameColor = "text-amber-400 font-semibold tracking-wider";
              } else if (isSecond) {
                borderStyle = "border-slate-400/20 bg-slate-900/10";
                rankBadge = <span className="text-base" title="Juara 2">🥈</span>;
              } else if (isThird) {
                borderStyle = "border-orange-700/20 bg-orange-950/5";
                rankBadge = <span className="text-base" title="Juara 3">🥉</span>;
              }

              return (
                <div
                  key={player.name}
                  className={`flex items-center justify-between border rounded-2xl px-4 py-3 transition-all animate-fade-in ${borderStyle}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                      {rankBadge}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs uppercase truncate ${nameColor}`}>
                          {player.name}
                        </span>
                        {isFirst && (
                          <span className="text-[7px] font-bold font-mono text-amber-500 bg-amber-950/80 border border-amber-600/30 px-1 rounded-sm leading-none py-0.5">
                            KING
                          </span>
                        )}
                      </div>
                      <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider mt-0.5 leading-none">
                        {player.hand.length} Kartu di Tangan
                      </span>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end justify-center">
                    <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.15em] leading-none mb-1">
                      Total Poin
                    </span>
                    <div className="flex items-baseline gap-0.5">
                      <span
                        className={`text-sm font-mono font-bold leading-none tracking-wide ${
                          isFirst ? "text-amber-400" : "text-zinc-200"
                        }`}
                      >
                        {player.displayScore}
                      </span>
                      <span className="text-[8px] font-mono text-zinc-600">pts</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Footer Bar */}
        <div className="p-3 text-center bg-black/30 border-t border-zinc-900/60 relative z-10">
          <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
            • Total skor turnamen terkumpul •
          </span>
        </div>
      </div>
    </div>
  );
};

export default LeaderboardModal;

import React, { useState, useEffect, useRef } from "react";
import PlayingCard from "../PlayingCard";
import { RemotePlayer, ViewState, ChatMessage } from "../../types/game";
import { Card } from "../../utils/gameLogic";

interface HostGameBoardViewProps {
  roomCode: string;
  remotePlayers: RemotePlayer[];
  deck: Card[];
  discardPile: Card[];
  turnIndex: number;
  initGame: () => void;
  setView: (view: ViewState) => void;
  chatMessages: ChatMessage[];
}

const HostGameBoardView: React.FC<HostGameBoardViewProps> = ({
  roomCode,
  remotePlayers,
  deck,
  discardPile,
  turnIndex,
  initGame,
  setView,
  chatMessages,
}) => {
  const seatPlayers = remotePlayers.filter((p) => !p.isHost);
  const bottomPlayer = seatPlayers[0];

  const renderPlayerMelds = (player: RemotePlayer | undefined, layout: "horizontal" | "vertical" = "horizontal") => {
    const playerMelds = player?.melds || [];
    if (playerMelds.length === 0) return null;

    return (
      <div className={`flex ${layout === "horizontal" ? "flex-row gap-1.5" : "flex-col gap-1.5"} justify-center items-center mt-1.5 max-w-[140px] overflow-x-auto no-scrollbar`}>
        {playerMelds.map((meld, gIdx) => (
          <div key={gIdx} className="flex gap-0 flex-shrink-0 bg-zinc-950/30 border border-emerald-900/30 rounded px-0.5 py-0.5 backdrop-blur-[1px] shadow-inner">
            {meld.map((c, cIdx) => (
              <div 
                key={c.id} 
                className="w-3.5 h-5 md:w-4 md:h-6 rounded bg-zinc-100 border border-zinc-300 shadow flex flex-col items-center justify-center relative -ml-1 first:ml-0"
                style={{ zIndex: cIdx }}
              >
                <span className={`text-[6.5px] md:text-[7.5px] leading-none font-black tracking-tighter ${
                  c.suit === "hearts" || c.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
                }`}>
                  {c.value}
                </span>
                <span className={`text-[4.5px] md:text-[5.5px] leading-none font-bold ${
                  c.suit === "hearts" || c.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
                }`}>
                  {c.suit === "hearts" ? "♥" : c.suit === "diamonds" ? "♦" : c.suit === "clubs" ? "♣" : "♠"}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderSpeechBubble = (targetName: string | undefined, placement: "top" | "bottom" | "left" | "right") => {
    if (!targetName || !activeSpeaker || activeSpeaker.sender.toUpperCase() !== targetName.toUpperCase()) return null;

    // Position mappings relative to player seat container bounds
    const positionClasses = {
      top: "-top-16 left-1/2 -translate-x-1/2 animate-bounce", 
      bottom: "-bottom-16 left-1/2 -translate-x-1/2 animate-bounce", 
      left: "-left-[115px] top-1/2 -translate-y-1/2 animate-pulse", 
      right: "-right-[115px] top-1/2 -translate-y-1/2 animate-pulse", 
    };

    return (
      <div className={`absolute z-[999] flex flex-col items-center pointer-events-none animate-fade-in ${positionClasses[placement]}`}>
        {placement === "bottom" && (
          <div className="w-2.5 h-2.5 rotate-45 bg-[#0b1613]/95 border-l border-t border-emerald-500/30 -mb-1.5 relative z-10" />
        )}
        
        <div className="px-2.5 py-2 bg-[#0b1613]/95 backdrop-blur-md border border-emerald-500/40 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.25)] flex flex-col gap-1 min-w-[90px] max-w-[120px]">
          {activeSpeaker.text && (
            <span className="text-[8px] font-semibold text-emerald-200 leading-tight tracking-wide text-center break-words drop-shadow">
              "{activeSpeaker.text}"
            </span>
          )}
          {activeSpeaker.photoBase64 && (
            <div className="rounded overflow-hidden border border-emerald-600/30 shadow max-w-[100px]">
              <img src={activeSpeaker.photoBase64} alt="Live shared" className="w-full h-auto object-cover" />
            </div>
          )}
        </div>

        {placement !== "bottom" && (
          <div className={`w-2.5 h-2.5 rotate-45 bg-[#0b1613]/95 border-r border-b border-emerald-500/30 -mt-1.5 relative z-10 ${
            placement === "left" ? "ml-auto mr-4" : placement === "right" ? "mr-auto ml-4" : ""
          }`} />
        )}
      </div>
    );
  };

  // --- PREMIUM CENTRAL ACTION BROADCASTER ---
  const [broadcast, setBroadcast] = useState<{
    title: string;
    subtitle: string;
    type: "draw" | "discard" | "meld";
    card?: Card;
  } | null>(null);

  const broadcastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef<boolean>(true);

  // Core Stat Diff Trackers
  const lastSeenDeckSize = useRef<number>(deck.length);
  const lastSeenMeldsCount = useRef<{ [name: string]: number }>({});
  const lastSeenDiscardPileCount = useRef<number>(discardPile.length);
  const lastSeenDiscardId = useRef<string | null>(discardPile[0]?.id || null);
  const lastSeenPlayersHands = useRef<{ [name: string]: number }>({});

  // --- INTEGRATED SPECTATOR SPEECH BUBBLE ENGINE ---
  const [activeSpeaker, setActiveSpeaker] = useState<{ sender: string, text?: string, photoBase64?: string } | null>(null);
  const lastProcessedMsgTime = useRef<number>(Date.now());
  const speakerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!chatMessages || chatMessages.length === 0) return;
    const lastMsg = chatMessages[chatMessages.length - 1];
    
    // Filter Kerahasiaan: Layar Host/Spectator HANYA menampilkan chat publik (Semua)
    if (lastMsg.recipient && lastMsg.recipient !== "All") return;
    
    if (lastMsg.timestamp > lastProcessedMsgTime.current) {
      lastProcessedMsgTime.current = lastMsg.timestamp;
      
      if (speakerTimeoutRef.current) clearTimeout(speakerTimeoutRef.current);
      
      setActiveSpeaker({
        sender: lastMsg.sender,
        text: lastMsg.text,
        photoBase64: lastMsg.photoBase64
      });
      
      speakerTimeoutRef.current = setTimeout(() => {
        setActiveSpeaker(null);
      }, 4000); // Hover for 4 seconds of pure amusement!
    }
  }, [chatMessages]);

  // PREMIUM CARD THROWING ANIMATION ENGINE
  const [flyingCard, setFlyingCard] = useState<{
    card: Card;
    sourceDirection: "bottom" | "top" | "left" | "right";
  } | null>(null);

  const triggerBroadcast = (b: { title: string; subtitle: string; type: "draw" | "discard" | "meld"; card?: Card }) => {
    if (broadcastTimeoutRef.current) clearTimeout(broadcastTimeoutRef.current);
    setBroadcast(b);
    broadcastTimeoutRef.current = setTimeout(() => {
      setBroadcast(null);
    }, 2200); // Show for 2.2 seconds for smooth dynamic sequencing!
  };

  useEffect(() => {
    const activeSeatPlayers = remotePlayers.filter((p) => !p.isHost);

    // 0. HYDRATE BASELINE ON FIRST RENDER (No false initial flashes!)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      
      lastSeenDeckSize.current = deck.length;
      lastSeenDiscardPileCount.current = discardPile.length;
      lastSeenDiscardId.current = discardPile[0]?.id || null;
      
      const initHands: { [name: string]: number } = {};
      const initMelds: { [name: string]: number } = {};
      remotePlayers.forEach((p) => {
        initHands[p.name] = p.hand.length;
        initMelds[p.name] = p.melds?.length || 0;
      });
      lastSeenPlayersHands.current = initHands;
      lastSeenMeldsCount.current = initMelds;
      return;
    }

    // A. EXCLUSIVE STRATEGIC MODAL: DETECT DRAW FROM DISCARD (Top card was picked up!)
    if (discardPile.length < lastSeenDiscardPileCount.current) {
      const activePlayer = remotePlayers[turnIndex];
      if (activePlayer) {
        triggerBroadcast({
          title: "🔥 AMBIL BUANGAN!",
          subtitle: `${activePlayer.name.toUpperCase()} memungut kartu strategis dari buangan!`,
          type: "draw"
        });
      }
    }

    // B. DETECT DISCARD (Buang Kartu) - ONLY TRIGGERS FLYING ANIMATION (NO MODAL BANNER)
    else if (discardPile[0] && discardPile[0].id !== lastSeenDiscardId.current) {
      let discarderIndex = -1;

      for (let i = 0; i < activeSeatPlayers.length; i++) {
        const p = activeSeatPlayers[i];
        const prev = lastSeenPlayersHands.current[p.name] || 0;
        if (p.hand.length < prev) {
          discarderIndex = i;
          break;
        }
      }

      if (discarderIndex === -1) {
        const prevIndex = (turnIndex - 1 + remotePlayers.length) % remotePlayers.length;
        const previousPlayer = remotePlayers[prevIndex];
        if (previousPlayer) {
          discarderIndex = activeSeatPlayers.findIndex((p) => p.name === previousPlayer.name);
        }
      }

      // Trigger physical throwing physics only
      if (discarderIndex !== -1) {
        const c = discardPile[0];
        const directions: ("bottom" | "top" | "left" | "right")[] = ["bottom", "top", "left", "right"];
        const dir = directions[discarderIndex % 4] || "bottom";
        setFlyingCard({ card: c, sourceDirection: dir });
        setTimeout(() => setFlyingCard(null), 700);
      }
    }

    // --- SYNC Baseline Refs for Next React Render Cycle ---
    lastSeenDeckSize.current = deck.length;
    lastSeenDiscardPileCount.current = discardPile.length;
    lastSeenDiscardId.current = discardPile[0]?.id || null;
    
    const nextHands: { [name: string]: number } = {};
    const nextMelds: { [name: string]: number } = {};
    remotePlayers.forEach((p) => {
      nextHands[p.name] = p.hand.length;
      nextMelds[p.name] = p.melds?.length || 0;
    });
    lastSeenPlayersHands.current = nextHands;
    lastSeenMeldsCount.current = nextMelds;
  }, [deck, discardPile, remotePlayers, turnIndex]);

  return (
    <div className="w-full max-w-5xl h-[90vh] relative z-10 flex flex-col justify-between animate-fade-in">
      {/* 
        FIXED COORDINATES INJECTION:
        The target slot for the top discard sits exactly at Y: -135px relative to table center!
        Now final transform lands exactly on the discard pile ring instead of the central deck!
      */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes throw-from-bottom {
          0% { transform: translateY(280px) scale(0.4) rotate(0deg); opacity: 0; filter: blur(2px); }
          15% { opacity: 1; filter: blur(0); }
          75% { transform: translateY(-205px) scale(1.05) rotate(360deg); }
          100% { transform: translateY(-195px) scale(1) rotate(360deg); opacity: 1; }
        }
        @keyframes throw-from-top {
          0% { transform: translateY(-320px) scale(0.4) rotate(0deg); opacity: 0; filter: blur(2px); }
          15% { opacity: 1; filter: blur(0); }
          75% { transform: translateY(-185px) scale(1.05) rotate(-360deg); }
          100% { transform: translateY(-195px) scale(1) rotate(-360deg); opacity: 1; }
        }
        @keyframes throw-from-left {
          0% { transform: translateX(-320px) translateY(0px) scale(0.4) rotate(0deg); opacity: 0; filter: blur(2px); }
          15% { opacity: 1; filter: blur(0); }
          75% { transform: translateX(10px) translateY(-205px) scale(1.05) rotate(180deg); }
          100% { transform: translateX(0) translateY(-195px) scale(1) rotate(180deg); opacity: 1; }
        }
        @keyframes throw-from-right {
          0% { transform: translateX(320px) translateY(0px) scale(0.4) rotate(0deg); opacity: 0; filter: blur(2px); }
          15% { opacity: 1; filter: blur(0); }
          75% { transform: translateX(-10px) translateY(-205px) scale(1.05) rotate(-180deg); }
          100% { transform: translateX(0) translateY(-195px) scale(1) rotate(-180deg); opacity: 1; }
        }

        .anim-fly-bottom { animation: throw-from-bottom 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .anim-fly-top { animation: throw-from-top 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .anim-fly-left { animation: throw-from-left 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .anim-fly-right { animation: throw-from-right 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }

        @keyframes scale-up {
          0% { transform: scale(0.85); opacity: 0; filter: blur(6px); }
          100% { transform: scale(1); opacity: 1; filter: blur(0); }
        }
        .animate-scale-up { animation: scale-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      `}} />

      {/* Minimal Top Bar */}
      <div className="flex justify-between items-center rounded-xl px-4 py-2.5 mx-auto w-full max-w-xl border border-zinc-800/50 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600"></span>
          <span className="font-mono text-[10px] text-zinc-500 tracking-wider uppercase">
            Room: <b className="text-zinc-300 font-normal">{roomCode}</b>
          </span>
        </div>
        <h3 className="text-[10px] font-medium tracking-[0.25em] text-zinc-400 uppercase">
          Meja Utama
        </h3>
        <button
          onClick={() => {
            initGame();
            setView("landing");
          }}
          className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 tracking-widest uppercase transition-colors cursor-pointer"
        >
          Ulangi
        </button>
      </div>

      {/* Table layout */}
      <div className="flex-1 flex relative items-center justify-center">
        {/* Derived seat tracking list */}
        <>
          {/* Player 2 (Top) */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-center z-20">
            {renderSpeechBubble(seatPlayers[1]?.name, "bottom")}
            <div
              className={`text-[10px] font-mono uppercase tracking-wider ${
                seatPlayers[1]
                  ? "text-zinc-300"
                  : "text-zinc-600 italic opacity-50"
              }`}
            >
              {seatPlayers[1] ? seatPlayers[1].name : "(Kursi Kosong)"}
            </div>
            {seatPlayers[1] && (
              <div className="flex gap-0.5 mt-1 justify-center opacity-40 scale-75">
                {[...Array(seatPlayers[1].hand.length)].map((_, i) => (
                  <div
                    key={i}
                    className="w-3 h-5 rounded-sm bg-zinc-700 border border-zinc-800 shadow-sm"
                  />
                ))}
              </div>
            )}
            {seatPlayers[1] && renderPlayerMelds(seatPlayers[1], "horizontal")}
          </div>

          {/* Player 3 (Left) */}
          <div className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-20">
            {renderSpeechBubble(seatPlayers[2]?.name, "right")}
            <div
              className={`text-[10px] font-mono -rotate-90 mb-2 uppercase tracking-wider ${
                seatPlayers[2]
                  ? "text-zinc-300"
                  : "text-zinc-700 italic opacity-50"
              }`}
            >
              {seatPlayers[2] ? seatPlayers[2].name : "(Kosong)"}
            </div>
            {seatPlayers[2] && (
              <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono">
                {seatPlayers[2].hand.length}
              </div>
            )}
            {seatPlayers[2] && renderPlayerMelds(seatPlayers[2], "vertical")}
          </div>

          {/* Player 4 (Right) */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-20">
            {renderSpeechBubble(seatPlayers[3]?.name, "left")}
            <div
              className={`text-[10px] font-mono rotate-90 mb-2 uppercase tracking-wider ${
                seatPlayers[3]
                  ? "text-zinc-300"
                  : "text-zinc-700 italic opacity-50"
              }`}
            >
              {seatPlayers[3] ? seatPlayers[3].name : "(Kosong)"}
            </div>
            {seatPlayers[3] && (
              <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono">
                {seatPlayers[3].hand.length}
              </div>
            )}
            {seatPlayers[3] && renderPlayerMelds(seatPlayers[3], "vertical")}
          </div>
        </>

        {/* CLEAN CIRCULAR TABLE CONTAINER */}
        <div className="w-[70vh] max-w-[480px] aspect-square rounded-full relative flex items-center justify-center border border-zinc-800/40 bg-black/10">
          {/* Subdued Orbit Ring */}
          <div className="absolute inset-8 border border-zinc-900/50 border-dashed rounded-full pointer-events-none" />

          {/* PREMIUM DEALER SHOE STOCK PILE (DIAGONAL TOP-LEFT) */}
          <div className="absolute z-30 -top-6 -left-6 md:-top-12 md:-left-12 p-2.5 rounded-2xl border border-zinc-700/30 bg-[#051b15]/95 shadow-[0_20px_50px_rgba(0,0,0,0.8)] -rotate-[15deg] transition-all hover:scale-105 select-none backdrop-blur-md">
            {/* Elegant Dealer Shoe label */}
            <div className="text-[7px] font-mono text-zinc-500 uppercase tracking-[0.25em] text-center mb-1.5 leading-none">
              Ambil Dek
            </div>

            <div className="relative w-14 h-20 md:w-18 md:h-26">
              <PlayingCard
                suit="hearts"
                value="A"
                faceUp={false}
                className="w-full h-full relative z-10 border-zinc-800 pointer-events-none bg-zinc-900 shadow-inner"
              />
              
              {/* Glowing Emerald Count Badge */}
              <div className="absolute -bottom-2 -right-2 z-20 bg-zinc-950 text-emerald-400 px-2 py-0.5 rounded border border-emerald-900/50 shadow-[0_0_15px_rgba(16,185,129,0.15)] font-mono font-bold text-[9px] tracking-wide leading-none flex items-center justify-center min-w-[24px]">
                {deck.length}
              </div>
            </div>
          </div>

          {/* DISCARD PILE CIRCULAR */}
          {discardPile.map((card, index) => {
            // Distribute ALL discard cards evenly! Min slots is 7 for spacing, but grows dynamically!
            const totalSlots = Math.max(7, discardPile.length);
            const angleStep = 360 / totalSlots;
            const angle = index * angleStep - 90;
            const radius = 195; // Expanded elegant orbit utilizing wide table ring

            const style = {
              transform: `rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`,
              transition: "all 0.4s ease",
              zIndex: 100 - index, // Top card is ALWAYS on top
              // Slower opacity decay so older cards remain nicely visible in the ring!
              opacity: Math.max(0.35, 1 - index * 0.04),
            };

            return (
              <div
                key={card.id}
                className="absolute origin-center scale-65 md:scale-75 transition-transform cursor-pointer"
                style={style}
              >
                <PlayingCard
                  suit={card.suit}
                  value={card.value}
                  className={`border ${
                    index === 0
                      ? "border-zinc-400 shadow-lg"
                      : "border-zinc-700/50"
                  }`}
                />

                {/* Chronological Sequence Number Badge (Top-Left) */}
                <div
                  className={`absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black font-mono border shadow-sm z-30 transition-all ${
                    index === 0
                      ? "bg-emerald-950 text-emerald-400 border-emerald-700/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                      : "bg-zinc-900/90 text-zinc-400 border-zinc-700"
                  }`}
                >
                  {discardPile.length - index}
                </div>

                {/* Sleek Glass Attribution Nameplate (Bottom Floating) */}
                <div 
                  className={`absolute -bottom-3.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded backdrop-blur-md border font-mono text-[8px] uppercase tracking-[0.1em] font-bold z-30 whitespace-nowrap max-w-[68px] truncate shadow-md transition-all duration-300 ${
                    index === 0
                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/60 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
                      : "bg-zinc-950/80 text-zinc-400 border-zinc-800/80 shadow-sm"
                  }`}
                  title={card.thrownBy}
                >
                  {card.thrownBy || "Dealer"}
                </div>
              </div>
            );
          })}

          {discardPile.length === 0 && (
            <div className="absolute text-[9px] font-mono text-zinc-700 uppercase tracking-wider">
              Buangan Kosong
            </div>
          )}

          {/* GLORIOUS FLYING CARD OVERLAY ELEMENT (RECALIBRATED LANDING) */}
          {flyingCard && (
            <div
              className={`absolute z-[99] pointer-events-none scale-65 md:scale-75 shadow-[0_10px_40px_rgba(0,0,0,0.6)] rounded-lg overflow-hidden anim-fly-${flyingCard.sourceDirection}`}
            >
              <PlayingCard
                suit={flyingCard.card.suit}
                value={flyingCard.card.value}
                className="border-zinc-200 bg-white"
              />
            </div>
          )}
        </div>

        {/* Player 1 (Bottom Seat) */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 border border-zinc-800 bg-zinc-900/30 px-5 py-2 rounded-xl flex flex-col items-center z-20 animate-fade-in">
          {renderSpeechBubble(bottomPlayer?.name, "top")}
          <div className="text-[9px] text-zinc-400 font-mono tracking-[0.2em] uppercase font-normal flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                bottomPlayer ? "bg-emerald-600 animate-pulse" : "bg-zinc-800"
              }`}
            />
            {bottomPlayer ? bottomPlayer.name : "(Kursi Kosong)"}
          </div>
          {bottomPlayer && (
            <div className="flex gap-0.5 mt-1 justify-center scale-75 opacity-70">
              {[...Array(bottomPlayer.hand.length)].map((_, i) => (
                <div
                  key={i}
                  className="w-4 h-6 rounded-sm bg-zinc-700 border border-zinc-800 shadow-sm"
                />
              ))}
            </div>
          )}
          {bottomPlayer && renderPlayerMelds(bottomPlayer, "horizontal")}
        </div>
      </div>

      {/* CENTRAL HIGH-FIDELITY BROADCAST BANNER (ACTION ANNOUNCEMENT MODAL) */}
      {broadcast && (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/35 backdrop-blur-[2px] transition-all duration-300 pointer-events-none animate-fade-in">
          <div className={`px-9 py-7 rounded-2xl border ${
            broadcast.type === "meld" 
              ? "bg-amber-950/50 border-amber-500/60 shadow-[0_0_50px_rgba(245,158,11,0.25)]"
              : broadcast.type === "draw"
              ? "bg-emerald-950/50 border-emerald-500/60 shadow-[0_0_50px_rgba(16,185,129,0.25)]"
              : "bg-rose-950/50 border-rose-500/60 shadow-[0_0_50px_rgba(244,63,94,0.25)]"
          } flex flex-col items-center gap-3.5 animate-scale-up select-none min-w-[340px] text-center backdrop-blur-md`}>
            
            {/* Dynamic Icon Badge with Bouncy Micro-Animation */}
            <div className={`w-16 h-16 rounded-full border flex items-center justify-center text-3xl shadow-xl animate-bounce ${
              broadcast.type === "meld"
                ? "bg-amber-950 border-amber-500 text-amber-400 shadow-amber-500/20"
                : broadcast.type === "draw"
                ? "bg-emerald-950 border-emerald-500 text-emerald-400 shadow-emerald-500/20"
                : "bg-rose-950 border-rose-500 text-rose-400 shadow-rose-500/20"
            }`}>
              {broadcast.type === "meld" ? "🏆" : broadcast.type === "draw" ? "🃏" : "🗑️"}
            </div>

            {/* Floating Notification Typography */}
            <div>
              <h2 className={`text-[11px] font-black font-mono uppercase tracking-[0.35em] mb-1.5 ${
                broadcast.type === "meld"
                  ? "text-amber-400"
                  : broadcast.type === "draw"
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}>
                {broadcast.title}
              </h2>
              <p className="text-[14px] font-semibold text-zinc-100 px-2 max-w-xs leading-relaxed text-balance tracking-wide drop-shadow-sm">
                {broadcast.subtitle}
              </p>
            </div>

            {/* Dynamic Card Preview: Injected for Discards! */}
            {broadcast.card && (
              <div className="mt-2.5 transform scale-85 hover:scale-90 transition-transform border border-zinc-700/50 rounded-lg shadow-2xl overflow-hidden flex items-center justify-center bg-[#0b0f0d] p-1 animate-pulse">
                <PlayingCard 
                  suit={broadcast.card.suit} 
                  value={broadcast.card.value} 
                  className="border-zinc-800 shadow-md"
                />
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default HostGameBoardView;

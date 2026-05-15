import React, { useState, useEffect, useRef } from "react";
import FloatingEmojis from "../VFX/FloatingEmojis";
import PlayingCard from "../PlayingCard";
import { RemotePlayer, ViewState, ChatMessage } from "../../types/game";
import { Card, getCardPoints } from "../../utils/gameLogic";

interface HostGameBoardViewProps {
  roomCode: string;
  remotePlayers: RemotePlayer[];
  deck: Card[];
  discardPile: Card[];
  turnIndex: number;
  initGame: () => void;
  setView: (view: ViewState) => void;
  chatMessages: ChatMessage[];
  finishGame: (updatedPlayers: RemotePlayer[]) => Promise<void>;
  triggerGlobalEndGame: (updatedPlayers: RemotePlayer[]) => Promise<void>;
  fireTauntEvent: { sender: string; target: string } | null;
  voiceTauntEvent: { sender: string; timestamp: number } | null;
  reactions: { id: string; emoji: string; timestamp: number }[];
  tableThemeClass?: string;
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
  finishGame,
  triggerGlobalEndGame,
  fireTauntEvent,
  voiceTauntEvent,
  reactions,
  tableThemeClass,
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
                <span className={`text-[6.5px] md:text-[7.5px] leading-none font-black tracking-tighter ${c.suit === "hearts" || c.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
                  }`}>
                  {c.value}
                </span>
                <span className={`text-[4.5px] md:text-[5.5px] leading-none font-bold ${c.suit === "hearts" || c.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
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

    // Detect if the message is just a single emoji for a cleaner "sticker" look
    const isSingleEmoji = activeSpeaker.text && activeSpeaker.text.length <= 2 && /\p{Emoji}/u.test(activeSpeaker.text);

    // Position mappings relative to player seat container bounds
    const positionClasses = {
      top: "-top-16 left-1/2 -translate-x-1/2 animate-bounce",
      bottom: "top-full mt-4 left-1/2 -translate-x-1/2 animate-bounce",
      left: "-left-[120px] top-1/2 -translate-y-1/2 animate-pulse",
      right: "left-full ml-4 top-1/2 -translate-y-1/2 animate-pulse",
    };

    return (
      <div className={`absolute z-[999] flex flex-col items-center pointer-events-none animate-fade-in ${positionClasses[placement]}`}>
        {placement === "bottom" && (
          <div className="w-2.5 h-2.5 rotate-45 bg-zinc-900 border-l border-t border-emerald-500/30 -mb-1.5 relative z-10" />
        )}

        <div className={`px-3 py-2 bg-zinc-900/95 backdrop-blur-xl border border-emerald-500/40 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex flex-col items-center gap-1.5 min-w-[60px] max-w-[140px] ${isSingleEmoji ? "aspect-square justify-center p-0 w-12 h-12 rounded-full" : ""}`}>
          {activeSpeaker.text && (
            <span className={`${isSingleEmoji ? "text-2xl" : "text-[10px]"} font-bold text-zinc-100 leading-tight tracking-wide text-center break-words drop-shadow-md`}>
              {activeSpeaker.text}
            </span>
          )}
          {activeSpeaker.photoBase64 && activeSpeaker.photoBase64.length > 100 && (
            <div className="rounded-lg overflow-hidden border border-emerald-600/30 shadow-lg max-w-[110px]">
              <img src={activeSpeaker.photoBase64} alt="Live shared" className="w-full h-auto object-cover" />
            </div>
          )}
        </div>

        {(placement === "top" || placement === "left" || placement === "right") && (
          <div className={`w-2.5 h-2.5 rotate-45 bg-zinc-900 border-r border-b border-emerald-500/30 -mt-1.5 relative z-10 ${placement === "left" ? "ml-auto mr-4" : placement === "right" ? "mr-auto ml-4" : ""
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

  // --- MATCH START INTRO BANNER ENGINE ---
  const [showIntroModal, setShowIntroModal] = useState<boolean>(true);
  const [showFinishConfirm, setShowFinishConfirm] = useState<boolean>(false);

  // --- PLAYER ABANDONMENT ENGINE ---
  const [abandonedPlayerName, setAbandonedPlayerName] = useState<string | null>(null);
  const lastSeenPlayerNamesRef = useRef<string[]>(remotePlayers.map((p) => p.name));

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

  // --- ADMINISTRATOR GAME OVER STANDINGS ENGINE ---
  const triggerFinishGameDialog = async () => {
    // 1. Hitung poin kartu di tangan untuk masing-masing pemain aktif
    const rawStandings = seatPlayers.map((player) => {
      const roundPoints = player.hand.reduce((sum, card) => sum + getCardPoints(card), 0);
      const prevScore = player.score || 0;
      const totalScore = prevScore + roundPoints;

      return {
        name: player.name,
        roundPoints,
        prevScore,
        totalScore
      };
    });

    // 2. Remi Indonesia: Total Poin PALING RENDAH adalah Pemenangnya! (Urutkan Naik)
    rawStandings.sort((a, b) => a.totalScore - b.totalScore);

    // 3. Siapkan daftar remotePlayers baru dengan skor kumulatif yang sudah diperbarui
    const updatedPlayers = remotePlayers.map((p) => {
      if (p.isHost) return p;
      const match = rawStandings.find((s) => s.name === p.name);
      return {
        ...p,
        score: match ? match.totalScore : p.score
      };
    });

    // Langsung update remote room dengan status "finished" via prop
    await triggerGlobalEndGame(updatedPlayers);
  };

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

      // Trigger physical throwing physics AND high-fidelity modal announcement
      if (discarderIndex !== -1) {
        const c = discardPile[0];
        const discardPlayerName = activeSeatPlayers[discarderIndex]?.name || "Pemain";

        // 1. Animasi melempar kartu melayang
        const directions: ("bottom" | "top" | "left" | "right")[] = ["bottom", "top", "left", "right"];
        const dir = directions[discarderIndex % 4] || "bottom";
        setFlyingCard({ card: c, sourceDirection: dir });
        setTimeout(() => setFlyingCard(null), 700);

        // 2. Munculkan Modal Penyiaran Pusat (Broadcast Banner)
        triggerBroadcast({
          title: "KARTU DIBUANG",
          subtitle: `${discardPlayerName.toUpperCase()} membuang kartu ke meja!`,
          type: "discard",
          card: c
        });
      }
    }

    // C. EXCLUSIVE ALERT: DETECT PLAYER ABANDONMENT (A player dropped out of the room)
    const currentPlayerNames = remotePlayers.map((p) => p.name);
    const departedPlayer = lastSeenPlayerNamesRef.current.find(
      (name) => !currentPlayerNames.includes(name)
    );

    if (departedPlayer) {
      console.log("🚨 [ABANDONMENT DETECTED]:", departedPlayer);
      setAbandonedPlayerName(departedPlayer);
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
    lastSeenPlayerNamesRef.current = currentPlayerNames;
  }, [deck, discardPile, remotePlayers, turnIndex]);

  // --- VOICE TAUNT PLAYBACK SYSTEM ---
  const lastTauntTimestamps = useRef<{ [name: string]: number }>({});
  const audioUnlocked = useRef(false);
  const tauntAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    tauntAudioRef.current = new Audio();
    return () => {
      if (tauntAudioRef.current) {
        tauntAudioRef.current.pause();
        tauntAudioRef.current.src = "";
      }
    };
  }, []);

  const unlockAudio = () => {
    if (audioUnlocked.current) return;
    if (tauntAudioRef.current) {
      tauntAudioRef.current.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A";
      tauntAudioRef.current.play().then(() => {
        audioUnlocked.current = true;
        console.log("🔊 Host Audio Context Primed!");
      }).catch(() => {});
    }
  };

  const pendingTaunt = useRef<{ sender: string, timestamp: number } | null>(null);

  // --- INSTANT BROADCAST TAUNT LISTENER ---
  useEffect(() => {
    if (voiceTauntEvent) {
      const p = remotePlayers.find(pl => pl.name.toUpperCase() === voiceTauntEvent.sender.toUpperCase());
      
      if (p && p.voice_taunt) {
        // We have the audio! Play it now.
        console.log(`⚡ [HOST INSTANT TAUNT] From: ${p.name}`);
        playVoiceAudio(p.voice_taunt, p.name);
        pendingTaunt.current = null; // Clear if it was pending
      } else {
        // Audio not yet synced. Mark as pending.
        console.log(`⏳ [HOST PENDING TAUNT] Waiting for audio data from: ${voiceTauntEvent.sender}`);
        pendingTaunt.current = voiceTauntEvent;
      }
    }
  }, [voiceTauntEvent, remotePlayers]);

  // Effect to catch pending taunts when remotePlayers updates
  useEffect(() => {
    if (pendingTaunt.current) {
      const p = remotePlayers.find(pl => pl.name.toUpperCase() === pendingTaunt.current!.sender.toUpperCase());
      if (p && p.voice_taunt) {
        console.log(`✅ [HOST RESOLVED TAUNT] Audio data arrived for: ${p.name}`);
        playVoiceAudio(p.voice_taunt, p.name);
        pendingTaunt.current = null;
      }
    }
  }, [remotePlayers]);

  const playVoiceAudio = (base64: string, senderName: string) => {
    if (!tauntAudioRef.current) return;
    
    try {
      tauntAudioRef.current.pause();
      tauntAudioRef.current.src = base64;
      tauntAudioRef.current.load();
      tauntAudioRef.current.play().catch(e => console.log("Host playback blocked:", e));
    } catch (e) {
      console.error("Host playback error:", e);
    }
  };

  // --- DB SYNC TAUNT LISTENER (FALLBACK) ---
  useEffect(() => {
    remotePlayers.forEach(p => {
      const lastTs = lastTauntTimestamps.current[p.name] || 0;
      if (p.last_voice_taunt_at && p.last_voice_taunt_at > lastTs) {
        const isRecent = (Date.now() - p.last_voice_taunt_at) < 2000;
        if (isRecent && p.voice_taunt) {
           console.log(`🔊 [HOST DB SYNC TAUNT] From: ${p.name}`);
           playVoiceAudio(p.voice_taunt, p.name);
        }
        lastTauntTimestamps.current[p.name] = p.last_voice_taunt_at;
      }
    });
  }, [remotePlayers]);

  return (
    <div 
      onClick={unlockAudio}
      className={`w-full max-w-5xl h-[90vh] relative z-10 flex flex-col justify-between animate-fade-in ${tableThemeClass || ""}`}
    >
      {/* 
        FIXED COORDINATES INJECTION:
        The target slot for the top discard sits exactly at Y: -135px relative to table center!
        Now final transform lands exactly on the discard pile ring instead of the central deck!
      */}
      <style dangerouslySetInnerHTML={{
        __html: `
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFinishConfirm(true)}
            className="text-[9px] font-bold font-mono bg-emerald-950 border border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/30 px-2.5 py-1 rounded tracking-widest uppercase transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.15)] active:scale-95"
          >
            Selesaikan
          </button>
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
      </div>

      {/* Table layout */}
      <div className="flex-1 flex relative items-center justify-center">
        {/* DYNAMIC SEAT-TO-SEAT FIRE TAUNT ANIMATION (HOST ONLY) */}
        {fireTauntEvent && (() => {
          const sName = fireTauntEvent.sender.trim().toUpperCase();
          const tName = fireTauntEvent.target.trim().toUpperCase();
          
          console.log(`🔥 [HOST ANIM] Taunt from ${sName} to ${tName}`);
          
          const senderIdx = seatPlayers.findIndex(p => p.name.trim().toUpperCase() === sName);
          const targetIdx = seatPlayers.findIndex(p => p.name.trim().toUpperCase() === tName);

          if (senderIdx === -1 || targetIdx === -1) {
            console.warn(`⚠️ [HOST ANIM] Could not find seats for: S:${senderIdx} T:${targetIdx}`);
            return null;
          }

          // Mapping indices to normalized layout positions
          // 0: Bottom, 1: Top, 2: Left, 3: Right
          const getPos = (idx: number) => {
            if (idx === 0) return { x: '50%', y: '85%' };
            if (idx === 1) return { x: '50%', y: '15%' };
            if (idx === 2) return { x: '15%', y: '50%' };
            if (idx === 3) return { x: '85%', y: '50%' };
            return { x: '50%', y: '50%' };
          };

          const start = getPos(senderIdx);
          const end = getPos(targetIdx);

          return (
            <div key={`${sName}-${tName}-${Math.random()}`} className="absolute inset-0 z-[100] pointer-events-none overflow-hidden">
              <style dangerouslySetInnerHTML={{ __html: `
                @keyframes fireball-travel {
                  0% { left: ${start.x}; top: ${start.y}; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                  15% { opacity: 1; }
                  85% { opacity: 1; }
                  100% { left: ${end.x}; top: ${end.y}; transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
                }
                @keyframes host-impact-shake {
                  0%, 100% { transform: translate(0,0); }
                  20% { transform: translate(-6px, -3px); }
                  40% { transform: translate(6px, 3px); }
                  60% { transform: translate(-4px, 2px); }
                  80% { transform: translate(4px, -2px); }
                }
                @keyframes host-taunt-pop {
                  0%   { opacity:0; transform:translate(-50%,-50%) scale(0.2); }
                  60%  { opacity:1; transform:translate(-50%,-50%) scale(1.1); }
                  100% { opacity:1; transform:translate(-50%,-50%) scale(1); }
                }
                .host-fireball {
                  position: absolute;
                  filter: drop-shadow(0 0 20px #f97316);
                  animation: fireball-travel 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                  z-index: 999;
                }
                .host-shake {
                  animation: host-impact-shake 0.5s ease 0.8s;
                  width: 100%; height: 100%; position: absolute; inset: 0;
                }
                .host-taunt-banner {
                  position: absolute;
                  left: ${end.x}; top: ${end.y};
                  animation: host-taunt-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) 0.8s both;
                  z-index: 1000;
                }
              `}} />
              
              {/* Subtle Red Vignette during flight */}
              <div className="absolute inset-0 bg-gradient-to-br from-red-950/20 via-transparent to-red-950/20" />

              {/* Fireballs */}
              {[0, 0.1, 0.2].map((delay, i) => (
                <div key={i} className="host-fireball" style={{ animationDelay: `${delay}s` }}>
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <radialGradient id={`host-fire-grad-${i}`} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#fff" />
                        <stop offset="30%" stopColor="#fbbf24" />
                        <stop offset="60%" stopColor="#f97316" />
                        <stop offset="100%" stopColor="transparent" />
                      </radialGradient>
                    </defs>
                    <path
                      d="M12 2c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.1.9-2 2-2s2 .9 2 2zm1 14c0 3.3-2.7 6-6 6s-6-2.7-6-6c0-1.7.7-3.2 1.8-4.2C3.1 10.7 4 8.7 4 6.5 4 4 5 2 7 1c-.7 1.3-1 2.8-1 4.5 0 3.9 3.1 7 7 7 .6 0 1.1-.1 1.6-.2-.4 1.1-.6 2.3-.6 3.7z"
                      fill={`url(#host-fire-grad-${i})`}
                    />
                  </svg>
                </div>
              ))}

              {/* Screen Shake & Impact Banner at Destination */}
              <div className="host-shake">
                <div className="host-taunt-banner bg-zinc-950/95 border border-red-700/60 backdrop-blur-md px-5 py-3 rounded-xl flex flex-col items-center gap-1 shadow-[0_0_40px_rgba(239,68,68,0.35)] select-none">
                  <span className="text-xl animate-bounce">🔥</span>
                  <span className="text-[8px] font-mono font-black text-red-500 uppercase tracking-[0.3em]">BAKAR LAYAR!</span>
                  <span className="text-[10px] font-semibold text-zinc-200 uppercase tracking-wider">
                    {fireTauntEvent.sender} → {fireTauntEvent.target}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Derived seat tracking list */}
        <>
          {/* Player 2 (Top) */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
            {renderSpeechBubble(seatPlayers[1]?.name, "right")}
            <div className="border border-zinc-800 bg-zinc-900/30 px-4 py-1.5 rounded-xl flex flex-col items-center animate-fade-in">
              <div className="text-[9px] text-zinc-400 font-mono tracking-[0.2em] uppercase font-normal flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${seatPlayers[1]?.name === remotePlayers[turnIndex]?.name ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"}`} />
                {seatPlayers[1] ? seatPlayers[1].name : "(Kursi Kosong)"}
              </div>
              {seatPlayers[1] && (
                <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono mt-1 mx-auto">
                  {seatPlayers[1].hand.length}
                </div>
              )}
              {seatPlayers[1] && renderPlayerMelds(seatPlayers[1], "horizontal")}
            </div>
          </div>

          {/* Player 3 (Left) */}
          <div className="absolute left-2 top-1/2 -translate-y-1/2 z-20">
            {renderSpeechBubble(seatPlayers[2]?.name, "bottom")}
            <div className="border border-zinc-800 bg-zinc-900/30 px-4 py-1.5 rounded-xl flex flex-col items-center animate-fade-in">
              <div className="text-[9px] text-zinc-400 font-mono tracking-[0.2em] uppercase font-normal flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${seatPlayers[2]?.name === remotePlayers[turnIndex]?.name ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"}`} />
                {seatPlayers[2] ? seatPlayers[2].name : "(Kursi Kosong)"}
              </div>
              {seatPlayers[2] && (
                <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono mt-1 mx-auto">
                  {seatPlayers[2].hand.length}
                </div>
              )}
              {seatPlayers[2] && renderPlayerMelds(seatPlayers[2], "vertical")}
            </div>
          </div>

          {/* Player 4 (Right) */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20">
            {renderSpeechBubble(seatPlayers[3]?.name, "top")}
            <div className="border border-zinc-800 bg-zinc-900/30 px-4 py-1.5 rounded-xl flex flex-col items-center animate-fade-in">
              <div className="text-[9px] text-zinc-400 font-mono tracking-[0.2em] uppercase font-normal flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${seatPlayers[3]?.name === remotePlayers[turnIndex]?.name ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"}`} />
                {seatPlayers[3] ? seatPlayers[3].name : "(Kursi Kosong)"}
              </div>
              {seatPlayers[3] && (
                <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono mt-1 mx-auto">
                  {seatPlayers[3].hand.length}
                </div>
              )}
              {seatPlayers[3] && renderPlayerMelds(seatPlayers[3], "vertical")}
            </div>
          </div>
        </>

        {/* CLEAN CIRCULAR TABLE CONTAINER */}
        <div className="w-[75vmin] max-w-[480px] aspect-square rounded-full relative flex items-center justify-center border border-zinc-800/40 bg-black/10">
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
                  className={`border ${index === 0
                      ? "border-zinc-400 shadow-lg"
                      : "border-zinc-700/50"
                    }`}
                />

                {/* Chronological Sequence Number Badge (Top-Left) */}
                <div
                  className={`absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black font-mono border shadow-sm z-30 transition-all ${index === 0
                      ? "bg-emerald-950 text-emerald-400 border-emerald-700/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                      : "bg-zinc-900/90 text-zinc-400 border-zinc-700"
                    }`}
                >
                  #{discardPile.length - index}
                </div>

                {/* Sleek Glass Attribution Nameplate (Bottom Floating) */}
                <div
                  className={`absolute -bottom-3.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded backdrop-blur-md border font-mono text-[8px] uppercase tracking-[0.1em] font-bold z-30 whitespace-nowrap max-w-[68px] truncate shadow-md transition-all duration-300 ${index === 0
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
          {renderSpeechBubble(bottomPlayer?.name, "left")}
          <div className="text-[9px] text-zinc-400 font-mono tracking-[0.2em] uppercase font-normal flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${bottomPlayer?.name === remotePlayers[turnIndex]?.name ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"
                }`}
            />
            {bottomPlayer ? bottomPlayer.name : "(Kursi Kosong)"}
          </div>
          {bottomPlayer && (
            <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono mt-1">
              {bottomPlayer.hand.length}
            </div>
          )}
          {bottomPlayer && renderPlayerMelds(bottomPlayer, "horizontal")}
        </div>
      </div>

      {/* CENTRAL HIGH-FIDELITY BROADCAST BANNER (ACTION ANNOUNCEMENT MODAL) */}
      {/* BROADCAST TOAST — Top Center, slim & unobtrusive */}
      {broadcast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none animate-fade-in">
          <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border backdrop-blur-md shadow-lg select-none ${broadcast.type === "meld"
              ? "bg-amber-950/80 border-amber-700/60 shadow-amber-950/50"
              : broadcast.type === "draw"
                ? "bg-emerald-950/80 border-emerald-800/60 shadow-emerald-950/50"
                : "bg-rose-950/80 border-rose-800/60 shadow-rose-950/50"
            }`}>
            {/* SVG Icon */}
            <span className={`flex-shrink-0 ${broadcast.type === "meld" ? "text-amber-400" : broadcast.type === "draw" ? "text-emerald-400" : "text-rose-400"
              }`}>
              {broadcast.type === "meld" && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
              )}
              {broadcast.type === "draw" && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <path d="M16 2H8l-2 4h12l-2-4Z" />
                  <path d="M12 10v6" />
                  <path d="m9 13 3 3 3-3" />
                </svg>
              )}
              {broadcast.type === "discard" && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              )}
            </span>

            {/* Text */}
            <div className="flex flex-col min-w-0">
              <span className={`text-[8px] font-black font-mono uppercase tracking-[0.3em] leading-none mb-0.5 ${broadcast.type === "meld" ? "text-amber-400" : broadcast.type === "draw" ? "text-emerald-400" : "text-rose-400"
                }`}>
                {broadcast.title}
              </span>
              <span className="text-[10px] font-medium text-zinc-200 leading-snug truncate max-w-[200px]">
                {broadcast.subtitle}
              </span>
            </div>

            {/* Card Preview (discard only) */}
            {broadcast.card && (
              <div className="flex-shrink-0 w-7 h-10 rounded-md overflow-hidden border border-zinc-600/50 shadow-md bg-white flex items-center justify-center ml-1">
                <PlayingCard
                  suit={broadcast.card.suit}
                  value={broadcast.card.value}
                  className="scale-[0.55] origin-center"
                />
              </div>
            )}
          </div>
        </div>
      )}


      {/* LEGACY FIREBALL ANIMATION BLOCK REMOVED TO PREVENT CONFLICTS WITH THE NEW SVG ANIMATION */}

      {/* FINISH GAME CONFIRMATION MODAL */}
      {showFinishConfirm && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-3xl p-7 shadow-2xl text-center animate-scale-up">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-xs font-mono font-black text-zinc-400 uppercase tracking-widest mb-2">Konfirmasi</h3>
            <p className="text-[11px] text-zinc-300 leading-relaxed mb-6 font-medium">
              Selesaikan babak ini dan hitung poin semua pemain?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowFinishConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-zinc-800 text-zinc-500 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-zinc-900 transition-all"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  setShowFinishConfirm(false);
                  await triggerFinishGameDialog();
                }}
                className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]"
              >
                Ya, Selesaikan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IMMERSIVE PLAYER ABANDONMENT WARNING POPUP */}
      {abandonedPlayerName && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-xs bg-[#100303]/95 border border-red-950 rounded-2xl shadow-[0_25px_70px_rgba(220,38,38,0.15)] p-5 text-center relative overflow-hidden animate-scale-up">
            {/* Red glow in background */}
            <div className="absolute -top-16 -left-16 w-40 h-40 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />

            {/* Warning Icon */}
            <div className="w-12 h-12 rounded-full bg-red-950 border border-red-800/40 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.15)] mb-3 mx-auto animate-pulse">
              <span className="text-xl">🚨</span>
            </div>

            <span className="text-[7px] font-mono font-black text-red-500 uppercase tracking-[0.35em] block leading-none mb-2">
              Peringatan Meja
            </span>

            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-widest mb-2">
              PEMAIN TELAH KELUAR
            </h3>

            <p className="text-[9px] font-mono text-zinc-400 leading-relaxed uppercase tracking-wide mb-5 px-2">
              Pemain <b className="text-red-400 font-bold">"{abandonedPlayerName}"</b> telah menyerah dan meninggalkan ruangan.
            </p>

            <button
              onClick={() => setAbandonedPlayerName(null)}
              className="w-full bg-red-950 hover:bg-red-900/40 border border-red-800/60 text-red-400 py-2 rounded-xl text-[9px] font-black font-mono tracking-widest uppercase transition-all active:scale-95 shadow-[0_0_15px_rgba(239,68,68,0.1)] cursor-pointer"
            >
              Oke, Lanjutkan
            </button>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* IMMERSIVE MATCH START ANNOUNCEMENT (HOST TV SCREEN)     */}
      {/* ======================================================= */}
      {showIntroModal && discardPile.length === 0 && (
        <div className="fixed inset-0 z-[999999] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
          <div className="w-full max-w-md bg-[#031a15]/95 border border-emerald-500/20 rounded-3xl shadow-[0_0_80px_rgba(16,185,129,0.2)] p-8 flex flex-col items-center text-center relative overflow-hidden animate-scale-up">
            {/* Emerald ambient lighting */}
            <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
            <div className="absolute -top-32 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

            {/* Giant Golden Card Icon Container */}
            <div className="w-20 h-20 rounded-full bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-center shadow-inner shadow-emerald-500/10 mb-6 relative animate-pulse">
              <span className="text-4xl">👑</span>
              <div className="absolute -bottom-1.5 -right-1.5 bg-emerald-500 text-black font-mono text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg">8</div>
            </div>

            <span className="text-[10px] font-mono font-extrabold text-emerald-400 uppercase tracking-[0.4em] mb-2.5">
              PERMAINAN DIMULAI!
            </span>

            <h2 className="text-xl font-black uppercase text-zinc-100 tracking-widest mb-6">
              PEMAIN PERTAMA TERPILIH
            </h2>

            <div className="w-full bg-gradient-to-b from-[#06281f] to-[#041a15] border border-emerald-800/30 rounded-2xl p-5 mb-6 shadow-[inset_0_0_20px_rgba(0,0,0,0.6)]">
              <span className="block text-[8px] font-mono text-emerald-500/50 uppercase tracking-[0.3em] mb-1.5">GILIRAN PERTAMA:</span>
              <span className="block text-2xl font-black text-zinc-100 uppercase tracking-widest filter drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] animate-bounce">
                {seatPlayers[turnIndex]?.name || "Pemain"}
              </span>
            </div>

            <p className="text-xs font-mono text-zinc-500 leading-relaxed tracking-wide uppercase mb-8 max-w-xs">
              Pemain di atas terpilih secara acak untuk membuang kartu pertama & dibekali 8 kartu di awal!
            </p>

            <button
              onClick={() => setShowIntroModal(false)}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-black rounded-xl text-[11px] font-extrabold font-mono tracking-[0.2em] uppercase transition-all shadow-[0_5px_25px_rgba(16,185,129,0.3)] active:scale-95 cursor-pointer"
            >
              Lanjut ke Meja Game 🎲
            </button>
          </div>
        </div>
      )}
      <FloatingEmojis reactions={reactions} />
    </div>
  );
};

export default HostGameBoardView;

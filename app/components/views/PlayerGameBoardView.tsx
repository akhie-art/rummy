import React, { useState } from "react";
import SortableCardWrapper from "../SortableCardWrapper";
import { Card, isSet, isRun, getPlayerRank } from "../../utils/gameLogic";
import { ViewState } from "../../types/game";

// Drag and drop sorting imports
import {
  DndContext,
  closestCenter,
  closestCorners,
  MouseSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
  TouchSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
} from "@dnd-kit/sortable";

interface PlayerGameBoardViewProps {
  isMyTurn: boolean;
  hasDrawnThisTurn: boolean;
  activePlayerName: string;
  bots: { name: string; cardCount: number }[];
  discardPile: Card[];
  deckCount: number;
  selectedDiscardIndex: number | null;
  setSelectedDiscardIndex: (index: number | null) => void;
  isDiscardSelectionValid: boolean;
  playerHand: Card[];
  setPlayerHand: React.Dispatch<React.SetStateAction<Card[]>>;

  setView: (view: ViewState) => void;
  sendFireTaunt: (targetName: string) => void;
  sendChatMessage: (text?: string, photoBase64?: string, recipient?: string) => void;
  drawFromDiscardAtIndex: (index: number) => Promise<void>;
  drawFromStock: () => Promise<Card | null>;
  sortMyHand: () => void;
  discardSelected: (cardId: string) => Promise<void>;
  meldSelectedCards: (cardIds: string[]) => Promise<boolean>;
  finishShowdown: () => Promise<void>;
  gameStatus: string;
  syncHandSort: (newSortedHand: Card[]) => Promise<void>;
  setToastMsg: (msg: string | null) => void;
  onShowLeaderboard: () => void;
  melds?: Card[][];
  isDoneShowdown?: boolean;
  remotePlayers: any[];
  turnIndex: number;
  playerName: string;
  sendReaction: (emoji: string) => Promise<void>;
  sendVoiceTaunt: () => Promise<void>;
  myVoiceTaunt?: string;
  tableThemeClass?: string;
}

const PlayerGameBoardView: React.FC<PlayerGameBoardViewProps> = ({
  isMyTurn,
  hasDrawnThisTurn,
  activePlayerName,
  bots,
  discardPile,
  deckCount,
  selectedDiscardIndex,
  setSelectedDiscardIndex,
  isDiscardSelectionValid,
  playerHand,
  setPlayerHand,
  setView,
  sendFireTaunt,
  sendChatMessage,
  drawFromDiscardAtIndex,
  drawFromStock,
  sortMyHand,
  discardSelected,
  meldSelectedCards,
  finishShowdown,
  gameStatus,
  syncHandSort,
  setToastMsg,
  onShowLeaderboard,
  melds = [],
  isDoneShowdown = false,
  remotePlayers,
  turnIndex,
  playerName,
  sendReaction,
  sendVoiceTaunt,
  myVoiceTaunt,
  tableThemeClass,
}) => {
  const isShowdown = gameStatus === "showdown";
  const circularDiscards = [...discardPile].reverse(); // Render from oldest to newest (left-to-right)

  // --- ACTION CONFIRMATION MODAL STATE ---
  const [confirmState, setConfirmState] = useState<{
    type: "draw" | "discard" | "warning";
    card?: Card;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // --- IMMERSIVE CARD REVEAL OVERLAY ---
  const [revealCard, setRevealCard] = useState<Card | null>(null);

  // --- DISCARD OVERLAY: Kartu yang dipilih untuk dibuang (tap 1x setelah ambil) ---
  const [discardOverlayCard, setDiscardOverlayCard] = useState<Card | null>(null);

  // --- LOCAL MULTI-CARD HAND SELECTION ---
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);

  // --- BROADCAST SYSTEM (MIRROR HOST) ---
  const [broadcast, setBroadcast] = useState<{
    title: string;
    subtitle: string;
    type: "draw" | "discard" | "meld";
    card?: Card;
  } | null>(null);

  const lastSeenDiscardId = React.useRef<string | null>(null);
  const lastSeenDiscardPileCount = React.useRef<number>(0);
  const lastSeenPlayersHands = React.useRef<{ [name: string]: number }>({});
  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    // 0. Initialize baseline
    if (isFirstRender.current) {
      isFirstRender.current = false;
      lastSeenDiscardPileCount.current = discardPile.length;
      lastSeenDiscardId.current = discardPile[0]?.id || null;
      const initHands: { [name: string]: number } = {};
      remotePlayers.forEach(p => { initHands[p.name] = p.hand.length; });
      lastSeenPlayersHands.current = initHands;
      return;
    }

    // Detect Discard
    if (discardPile[0] && discardPile[0].id !== lastSeenDiscardId.current) {
      // Find who discarded
      const discarder = remotePlayers.find(p => (lastSeenPlayersHands.current[p.name] || 0) > p.hand.length);
      const discardPlayerName = discarder?.name || remotePlayers[(turnIndex - 1 + remotePlayers.length) % remotePlayers.length]?.name || "Pemain";

      setBroadcast({
        title: "KARTU DIBUANG",
        subtitle: `${discardPlayerName.toUpperCase()} membuang kartu!`,
        type: "discard",
        card: discardPile[0]
      });
      setTimeout(() => setBroadcast(null), 2500);
    }

    // Update refs for next run
    lastSeenDiscardPileCount.current = discardPile.length;
    lastSeenDiscardId.current = discardPile[0]?.id || null;
    const nextHands: { [name: string]: number } = {};
    remotePlayers.forEach(p => { nextHands[p.name] = p.hand.length; });
    lastSeenPlayersHands.current = nextHands;
  }, [discardPile, remotePlayers, turnIndex]);

  const lastTauntTimestamps = React.useRef<{ [name: string]: number }>({});
  const audioUnlocked = React.useRef(false);
  const tauntAudioRef = React.useRef<HTMLAudioElement | null>(null);

  // Initialize persistent audio element
  React.useEffect(() => {
    tauntAudioRef.current = new Audio();
    return () => {
      if (tauntAudioRef.current) {
        tauntAudioRef.current.pause();
        tauntAudioRef.current.src = "";
      }
    };
  }, []);

  // Function to unlock audio on first interaction
  const unlockAudio = () => {
    if (audioUnlocked.current) return;
    if (tauntAudioRef.current) {
      tauntAudioRef.current.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A";
      tauntAudioRef.current.play().then(() => {
        audioUnlocked.current = true;
        console.log("🔊 Audio Context Primed!");
      }).catch(() => {});
    }
  };

  React.useEffect(() => {
    remotePlayers.forEach(p => {
      const lastTs = lastTauntTimestamps.current[p.name] || 0;
      if (p.last_voice_taunt_at && p.last_voice_taunt_at > lastTs) {
        console.log(`🔊 [VOICE TAUNT] From: ${p.name}`);
        
        // Visual indicator
        if (p.name.toUpperCase() !== playerName.toUpperCase()) {
          setToastMsg(`${p.name.toUpperCase()} mengirim suara! 🎙️`);
          setTimeout(() => setToastMsg(null), 3000);
        }

        // Play taunt!
        if (p.voice_taunt && tauntAudioRef.current) {
          try {
            tauntAudioRef.current.pause();
            tauntAudioRef.current.src = p.voice_taunt;
            tauntAudioRef.current.load();
            tauntAudioRef.current.play().catch(e => {
              console.warn("Auto-play blocked for voice taunt:", e);
              if (p.name.toUpperCase() !== playerName.toUpperCase()) {
                setToastMsg("Suara diblokir browser. Tap layar untuk aktifkan! 🔇");
              }
            });
          } catch (e) {
            console.error("Taunt playback error:", e);
          }
        }
        lastTauntTimestamps.current[p.name] = p.last_voice_taunt_at;
      }
    });
  }, [remotePlayers, playerName, setToastMsg]);

  // --- OPPONENT MELD MODAL ---
  const [viewingOpponent, setViewingOpponent] = useState<any | null>(null);

  // --- QUICK CHAT REMOVED (MOVED TO SOCIAL DECK) ---
  const [showQuickChat, setShowQuickChat] = useState(false);

  // Calculate if current selection forms a valid meld (Smart Glow VFX)
  const selectedCards = playerHand.filter(c => selectedCardIds.includes(c.id));
  const isValidMeld = selectedCards.length >= 3 && (isSet(selectedCards) || isRun(selectedCards));

  // --- DRAG AND DROP SENSORS ---
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        distance: 5, // Instantly draggable after moving 5px, no long-press needed!
      },
    })
  );

  const DroppableDiscardArea = ({ isMyTurn, hasDrawnThisTurn }: { isMyTurn: boolean, hasDrawnThisTurn: boolean }) => {
    const { isOver, setNodeRef } = useDroppable({
      id: "discard-pile-drop-zone",
    });

    if (!isMyTurn || !hasDrawnThisTurn) return <div className="h-20" />;

    return (
      <div className="w-full flex justify-center px-6 py-3 animate-fade-in">
        <div
          ref={setNodeRef}
          className={`w-full max-w-md py-6 px-4 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center backdrop-blur-sm transition-all duration-500 select-none ${isOver
            ? "border-red-500 bg-red-950/40 scale-[1.03] shadow-[0_0_30px_rgba(239,68,68,0.25)]"
            : "border-zinc-800/60 bg-zinc-950/25 hover:border-zinc-700/80 hover:bg-zinc-950/40 shadow-[inset_0_0_15px_rgba(0,0,0,0.4)]"
            }`}
        >
          {/* Refined Trash Icon Circle */}
          <div className={`w-12 h-12 rounded-full mb-3 flex items-center justify-center transition-all duration-500 ${isOver
            ? "bg-red-500/20 scale-110 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
            : "bg-zinc-900/80 border border-zinc-800 shadow-md"
            }`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isOver ? "#ef4444" : "#71717a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${isOver ? "animate-bounce" : "opacity-70"}`}>
              <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
            </svg>
          </div>

          {/* Clean Typography Stack */}
          <div className="flex flex-col items-center gap-1">
            <span className={`text-[10px] font-mono font-black tracking-[0.25em] uppercase text-center transition-all duration-300 ${isOver ? "text-red-400" : "text-zinc-400"}`}>
              {isOver ? "Lepas Untuk Buang" : "Seret Kartu Kesini"}
            </span>
            <span className={`text-[8px] font-medium tracking-wide transition-all duration-300 ${isOver ? "text-red-500/80" : "text-zinc-600"}`}>
              Atau tap 1x pada kartu pilihan
            </span>
          </div>
        </div>
      </div>
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Check if dropped on discard zone
    if (over && over.id === "discard-pile-drop-zone") {
      if (isMyTurn && hasDrawnThisTurn) {
        discardSelected(active.id as string);
        setSelectedCardIds([]);
      }
      return;
    }

    if (over && active.id !== over.id) {
      const activeIndex = playerHand.findIndex((c) => c.id === active.id);
      const overIndex = playerHand.findIndex((c) => c.id === over.id);
      if (activeIndex !== -1 && overIndex !== -1) {
        const nextHand = arrayMove(playerHand, activeIndex, overIndex);
        syncHandSort(nextHand);
      }
    }
  };

  return (
    <div
      onClick={() => {
        unlockAudio();
        // Klik di luar kartu → batalkan semua seleksi
        setSelectedDiscardIndex(null);
        setSelectedCardIds([]);
        setDiscardOverlayCard(null);
      }}
      className={`fixed inset-0 ${tableThemeClass || "bg-[#041410]"} z-50 flex flex-col justify-between select-none animate-fade-in transition-colors duration-1000`}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        {/* 5.1 Clean Top Status Bar */}
        <div className="pl-6 pr-36 py-3 flex justify-between items-center border-b border-zinc-900/80 relative">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-1.5 h-1.5 rounded-full ${isMyTurn ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"
                  }`}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium text-zinc-300 uppercase tracking-[0.2em] block leading-none">
                  {isShowdown ? "Turunkan Sisa Kartu" : (isMyTurn
                    ? hasDrawnThisTurn
                      ? "Pilih & Buang"
                      : "Giliran Anda"
                    : `Giliran: ${activePlayerName}`)}
                </span>
                {(() => {
                  const myData = remotePlayers.find(p => p.name.toUpperCase() === playerName.toUpperCase());
                  const rank = getPlayerRank(myData?.score || 0);
                  return (
                    <span className={`text-[6.5px] font-black uppercase tracking-[0.25em] ${rank.color}`}>
                      {rank.title}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>



          {/* BROADCAST TOAST (MODERN SLIM) */}
          {broadcast && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] pointer-events-none animate-fade-in flex items-center gap-2 px-3 py-1.5 rounded-xl border border-rose-800/60 bg-rose-950/90 backdrop-blur-md shadow-lg shadow-rose-950/40 select-none max-w-[200px]">
              <div className="flex flex-col min-w-0">
                <span className="text-[7px] font-black font-mono text-rose-400 uppercase tracking-[0.2em] leading-none mb-0.5">
                  {broadcast.title}
                </span>
                <span className="text-[9px] font-semibold text-zinc-100 truncate">
                  {broadcast.subtitle}
                </span>
              </div>
              {broadcast.card && (
                <div className="w-5 h-7 rounded bg-white flex items-center justify-center border border-zinc-400 shadow-sm overflow-hidden flex-shrink-0">
                  <span className={`text-[9px] font-black leading-none ${broadcast.card.suit === 'hearts' || broadcast.card.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-900'}`}>
                    {broadcast.card.value}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {isShowdown && (
          <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-center gap-2 animate-pulse select-none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-[10px] font-black font-mono text-amber-500 uppercase tracking-[0.3em]">
              {isDoneShowdown ? "MENUNGGU PEMAIN LAIN..." : "BABAK TURUN KARTU (SHOWDOWN)"}
            </span>
          </div>
        )}

        {/* 5.1.5 Interactive Opponent Taunting Row */}
        <div className="px-6 py-2 border-b border-zinc-900/50 bg-black/10 flex flex-col gap-2 flex-shrink-0 select-none">
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.2em] flex-shrink-0">
              Bakar Lawan
            </span>
            <div className="flex items-center gap-2 flex-1">
              {bots.map((bot, idx) => (
                <button
                  key={idx}
                  onClick={() => sendFireTaunt(bot.name)}
                  className="px-2.5 py-1 rounded-lg border border-zinc-800/60 hover:border-red-900/60 bg-black/20 hover:bg-red-950/15 text-[9px] font-mono text-zinc-500 hover:text-red-500 flex items-center gap-1.5 cursor-pointer transition-all uppercase active:scale-95 group"
                  title={`Bakar layar ${bot.name}`}
                >
                  <span className="group-hover:scale-110 transition-transform flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 animate-pulse">
                      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3 0-1.07.73-2.73 2-3.33 0 1.1 1.08 1.58 1.5 2.67.33.89.5 1.5.5 2.17 0 2.1-1.79 3.5-3.5 3.5-1.84 0-3.5-1.63-3.5-3.5 0-1.23.35-2.26 1-3.1 0 1.5 1.5 2 2 3.5z" />
                      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3-4-4-6.5c-.66 1.9-2 4.5-1 7 0 2-3 3-3 6a6 6 0 0 0 4 6z" />
                    </svg>
                  </span>
                  <span className="font-medium tracking-wide">{bot.name}</span>
                </button>
              ))}
              
              {/* My Custom Voice Taunt Trigger */}
              {myVoiceTaunt && (
                <button
                  onClick={sendVoiceTaunt}
                  className="px-2.5 py-1 rounded-lg border border-emerald-900/40 bg-emerald-950/15 text-[9px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 cursor-pointer transition-all uppercase active:scale-95 group shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                  title="Kirim Taunt Suara Anda"
                >
                  <span className="group-hover:scale-110 transition-transform flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </span>
                  <span className="font-bold tracking-widest">VOICE TAUNT</span>
                </button>
              )}
            </div>
          </div>

          {/* Emoji Taunt Bar */}
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar border-t border-white/5 pt-2">
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.2em] flex-shrink-0">
              Kirim Emoji
            </span>
            <div className="flex items-center gap-2">
              {["😂", "😮", "😡", "🤡", "🔥", "💩"].map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => sendReaction(emoji)}
                  className="w-9 h-9 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center text-xl hover:scale-110 active:scale-95 transition-all cursor-pointer hover:bg-white/10 hover:border-white/20 shadow-lg"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 5.2 Console: Clickable Dealer Shoe + Scrollable Discard Drawer */}
        <div className={`px-6 pt-4 flex flex-col transition-all duration-500 ${hasDrawnThisTurn ? "opacity-75 scale-95" : "animate-fade-in"}`}>
          {/* Interactive Section Header */}
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[9px] font-bold font-mono text-zinc-400 uppercase tracking-[0.15em]">
              {hasDrawnThisTurn ? "Tumpukan Kartu" : "Ambil Kartu"}
            </span>
          </div>

          {/* TacTile Console Row */}
          <div className="flex items-center gap-4 pb-2 overflow-visible">

            {/* 1. IMMERSIVE ROTATED DEALER SHOE (TACTILE PLAYER DRAWING) */}
            <div
              onClick={async (e) => {
                e.stopPropagation(); // Mencegah reset saat mengambil dek
                if (isMyTurn && !hasDrawnThisTurn) {
                  const drawn = await drawFromStock();
                  if (drawn) {
                    setRevealCard(drawn);
                  }
                }
              }}
              className={`flex-shrink-0 relative select-none transition-all duration-300 ${isMyTurn && !hasDrawnThisTurn
                ? "cursor-pointer active:scale-[0.96]"
                : "opacity-40 cursor-not-allowed"
                }`}
            >
              <div className={`p-1.5 rounded-xl border ${isMyTurn && !hasDrawnThisTurn
                ? "border-zinc-700/40 bg-[#051b15]/95 shadow-[0_10px_30px_rgba(0,0,0,0.7)] ring-1 ring-emerald-950/30"
                : "border-zinc-800/50 bg-black/30 shadow-none"
                } -rotate-[8deg] backdrop-blur-sm`}>

                <div className="text-[6px] font-mono font-black text-zinc-500 uppercase tracking-[0.2em] text-center mb-1 leading-none">
                  AMBIL DEK
                </div>

                <div className="relative w-12 h-18 rounded-lg bg-zinc-950 border border-zinc-800 shadow-inner flex items-center justify-center overflow-hidden">
                  <div className="absolute inset-0.5 bg-red-950 border border-red-800/30 rounded-md flex flex-col items-center justify-center p-1 overflow-hidden shadow-md">
                    {/* Micro Texture */}
                    <div className="absolute inset-0 opacity-[0.12] bg-[repeating-linear-gradient(45deg,#000,#000_3px,#fff_3px,#fff_6px)]" />
                    {/* Mini Suit Icons as in Screenshot */}
                    <div className="relative z-10 flex items-center justify-center gap-0.5 text-[9px] font-bold text-yellow-600/75 select-none">
                      <span>♠</span><span>♣</span><span>♦</span><span>♥</span>
                    </div>
                  </div>

                  {/* Emerald Count */}
                  <div className={`absolute bottom-1 right-1 z-20 bg-black/80 text-emerald-400 border px-1 rounded font-mono font-black text-[7px] scale-90 shadow-sm ${isMyTurn && !hasDrawnThisTurn ? "border-emerald-900/50" : "border-zinc-800 text-zinc-500"
                    }`}>
                    {deckCount}
                  </div>
                </div>
              </div>

              {/* Live Attention Glow Pulse */}
              {isMyTurn && !hasDrawnThisTurn && (
                <div className="absolute inset-0 rounded-xl border border-emerald-500/30 animate-pulse pointer-events-none" />
              )}
            </div>

            {/* 2. Scrollable Discards */}
            <div className="flex-1 flex gap-2 overflow-x-auto pb-4 pt-8 px-0.5 snap-x no-scrollbar scrollbar-thin">
              {circularDiscards.map((card, index) => {
                const logicalIndex = (circularDiscards.length - 1) - index;
                const isSelected = selectedDiscardIndex === logicalIndex;

                // Get visual index of selection to draw tail to the right
                const selectedRenderedIndex = selectedDiscardIndex !== null ? (circularDiscards.length - 1) - selectedDiscardIndex : null;

                // 'Tail' cards are the clicked card and all newer cards to its RIGHT (stacking on top of it)
                const isPartOfTail = selectedRenderedIndex !== null && index >= selectedRenderedIndex;
                const isTailTooLong = selectedDiscardIndex !== null && (selectedDiscardIndex + 1) > 7;

                return (
                  <div
                    key={card.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasDrawnThisTurn) return; // HANYA BISA SCROLL SETELAH AMBIL KARTU

                      if (isSelected) {
                        if (isDiscardSelectionValid && isMyTurn && !hasDrawnThisTurn && !isTailTooLong) {
                          drawFromDiscardAtIndex(logicalIndex);
                          setSelectedDiscardIndex(null);
                        } else {
                          setSelectedDiscardIndex(null);
                        }
                      } else {
                        setSelectedDiscardIndex(logicalIndex);
                      }
                    }}
                    className={`flex-shrink-0 relative transition-all duration-500 snap-start ${hasDrawnThisTurn ? "cursor-default" : "cursor-pointer"} ${isPartOfTail ? "-translate-y-2.5" : ""} ${isSelected ? "scale-[1.05] z-30" : isPartOfTail ? "z-20" : "z-10"
                      }`}
                  >
                    <div className={`relative transition-all duration-300 ${isPartOfTail
                      ? isTailTooLong
                        ? "ring-2 ring-red-600/80 shadow-[0_0_15px_rgba(220,38,38,0.4)] rounded-xl scale-[1.02]"
                        : "ring-2 ring-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)] rounded-xl scale-[1.02]"
                      : ""
                      }`}>
                      {/* Identity Badge for Tail (Starts at 1 on selection, increases to the right) */}
                      {isPartOfTail && (
                        <div className={`absolute -top-3 left-1/2 -translate-x-1/2 z-50 px-2 py-0.5 rounded-full text-[8px] font-black font-mono shadow-lg ${isTailTooLong ? "bg-red-600 text-white" : "bg-amber-400 text-black"
                          }`}>
                          {selectedRenderedIndex !== null ? (index - selectedRenderedIndex) + 1 : 0}
                        </div>
                      )}

                      <div className={`relative w-13 h-18 md:w-14 md:h-20 rounded-lg border relative flex flex-col items-center justify-center select-none transition-all duration-300 ${isSelected
                        ? "border-amber-400 bg-white shadow-[0_10px_20px_rgba(0,0,0,0.4)]"
                        : isPartOfTail
                          ? isTailTooLong ? "border-red-500 bg-red-100" : "border-amber-500 bg-amber-50"
                          : "border-zinc-300/80 bg-zinc-200/90 shadow-sm"
                        }`}>
                        <span
                          className={`text-base leading-none font-bold ${card.suit === "hearts" || card.suit === "diamonds"
                            ? "text-red-600"
                            : "text-zinc-950"
                            }`}
                        >
                          {card.value}
                        </span>
                        <span
                          className={`text-xs leading-none mt-0.5 ${card.suit === "hearts" || card.suit === "diamonds"
                            ? "text-red-600"
                            : "text-zinc-950"
                            }`}
                        >
                          {card.suit === "hearts"
                            ? "♥"
                            : card.suit === "diamonds"
                              ? "♦"
                              : card.suit === "clubs"
                                ? "♣"
                                : "♠"}
                        </span>

                        {/* Sequence Number (Chronological: leftmost is oldest #1, rightmost is newest) */}
                        <div className="absolute top-0.5 right-1 text-[7.5px] font-black font-mono text-zinc-500">
                          #{index + 1}
                        </div>

                        {/* Thrown By Attribution */}
                        <div className="absolute bottom-0 left-0 right-0 text-center text-[5.5px] font-mono uppercase tracking-[0.05em] font-bold text-zinc-500 truncate px-0.5 border-t border-zinc-200 bg-zinc-200/60 py-0.5 rounded-b-lg">
                          {card.thrownBy || "Dealer"}
                        </div>

                        {/* GLASS ACTION OVERLAY: Muncuk ketika kartu diketuk! */}
                        {isSelected && !hasDrawnThisTurn && (
                          <div className={`absolute inset-0 z-40 rounded-lg flex flex-col items-center justify-center backdrop-blur-[1.5px] border border-white/20 animate-fade-in transition-all duration-300 ${isDiscardSelectionValid && isMyTurn && !hasDrawnThisTurn && !isTailTooLong
                            ? "bg-emerald-950/90 shadow-[0_0_15px_rgba(16,185,129,0.35)]"
                            : "bg-red-950/90 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                            }`}>
                            {isDiscardSelectionValid && isMyTurn && !hasDrawnThisTurn && !isTailTooLong ? (
                              <>
                                <span className="text-[8px] font-black text-emerald-400 tracking-widest animate-pulse">
                                  AMBIL
                                </span>
                                <svg className="w-3.5 h-3.5 text-emerald-400 animate-bounce mt-0.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                  <path d="M12 19V5m-7 7l7-7 7 7" />
                                </svg>
                              </>
                            ) : (
                              <>
                                <span className="text-[7px] font-black text-red-400 tracking-[0.15em] text-center px-1">
                                  {isTailTooLong ? "TERLALU BANYAK" : "TIDAK SAH"}
                                </span>
                                <svg className="w-3.5 h-3.5 text-red-400 mt-0.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                  <path d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {discardPile.length === 0 && (
                <div className="h-18 w-full border border-dashed border-zinc-800/30 rounded-xl flex items-center justify-center text-[8px] font-mono text-zinc-600 tracking-wider uppercase">
                  Kosong
                </div>
              )}
            </div>

          </div>
        </div>

        <DroppableDiscardArea isMyTurn={isMyTurn} hasDrawnThisTurn={hasDrawnThisTurn} />


        {/* 5.3 Main Compact Quick Actions (Horizontal, Clean SVG Icons) */}
        <div className="px-6 py-2 w-full max-w-md mx-auto min-h-[80px] flex items-center justify-center gap-3 z-50">
          {/* BUTTON TURUNKAN (MELD) - ONLY VISIBLE WHEN VALID */}
          {selectedCardIds.length >= 3 && (gameStatus !== "showdown" || !isDoneShowdown) && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const success = await meldSelectedCards(selectedCardIds);
                if (success) {
                  setSelectedCardIds([]);
                }
              }}
              className={`w-16 h-16 rounded-2xl border border-emerald-400/40 bg-emerald-500/20 backdrop-blur-xl text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.2)] animate-bounce-in flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all hover:bg-emerald-500/30 hover:border-emerald-400/60 ${isValidMeld ? "animate-pulse border-emerald-300 bg-emerald-500/40 shadow-[0_0_40px_rgba(16,185,129,0.5)]" : ""
                }`}
              title="Turunkan Kartu"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
              <span className="text-[7px] font-black font-mono tracking-tighter -mt-1">TURUN</span>
            </button>
          )}

          {isShowdown && !isDoneShowdown && (
            <button
              onClick={finishShowdown}
              className="px-8 py-4 bg-emerald-500/20 backdrop-blur-xl border border-emerald-500/30 text-emerald-400 rounded-2xl text-[11px] font-black font-mono tracking-widest uppercase transition-all active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.15)] flex items-center gap-2.5 cursor-pointer hover:bg-emerald-500/30 hover:border-emerald-500/50"
            >
              <span>Selesai</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )}

          {/* EMOJI REACTION BAR REMOVED FROM HERE */}
          {(() => {
            // Rule Refinement: Only show TUTUP when it's your turn, you've drawn, 
            // and you've melded everything except 1 final card.
            const canShowTutup = selectedCardIds.length === 1 && isMyTurn && hasDrawnThisTurn && playerHand.length === 1;
            if (!canShowTutup) return null;

            return (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  // Button only shows when it's valid to close (turn + drawn + 1 card left)
                  const cardId = selectedCardIds[0];
                  setSelectedCardIds([]);
                  await discardSelected(cardId);
                }}
                className="w-16 h-16 rounded-2xl border border-amber-400/40 bg-amber-950/40 backdrop-blur-xl text-amber-400 shadow-[0_0_40px_rgba(245,158,11,0.25)] animate-bounce-in scale-110 z-50 flex flex-col items-center justify-center cursor-pointer hover:bg-amber-900/60 hover:border-amber-400/60 active:scale-95 transition-all"
                title="Tutup Kartu!"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="mb-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                  <path d="M4 22h16"></path>
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                </svg>
                <span className="text-[6.5px] font-medium font-mono tracking-[0.1em] text-amber-200/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">TUTUP</span>
              </button>
            );
          })()}

        </div>

        {/* 5.4 Main Player Hand (Dnd Context) */}
        <div className="pb-8 px-4 flex flex-col items-center">
          <div className="w-full flex justify-center py-4 relative">
            <SortableContext
              items={playerHand.map((c) => c.id)}
              strategy={rectSortingStrategy}
            >
              <div className="flex flex-wrap justify-center gap-x-[-8px] md:gap-x-[-10px] gap-y-2 px-6">
                {playerHand.map((card) => (
                  <SortableCardWrapper
                    key={card.id}
                    id={card.id}
                    suit={card.suit as any}
                    value={card.value as any}
                    hasDrawnThisTurn={hasDrawnThisTurn}
                    isSelected={selectedCardIds.includes(card.id)}
                    isPartofValidMeld={isValidMeld && selectedCardIds.includes(card.id)}
                    onClick={() => {
                      // Multi-select logic: Toggle selection
                      setSelectedCardIds(prev =>
                        prev.includes(card.id)
                          ? prev.filter(id => id !== card.id)
                          : [...prev, card.id]
                      );
                      setDiscardOverlayCard(null); // Reset detail view
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </div>

          {/* 5.5 Section Opponent Melds (Compact Clickable Badges) */}
          <div className="mt-2 w-full max-w-4xl px-4 flex flex-col mb-4">
            <div className="flex items-center gap-2 mb-2 opacity-50 px-2">
              <div className="w-1 h-1 rounded-full bg-rose-500" />
              <span className="text-[8px] font-mono font-bold text-rose-400 uppercase tracking-[0.25em]">
                Kartu Lawan di Meja
              </span>
            </div>
            <div className="flex gap-2 p-2 overflow-x-auto no-scrollbar">
              {remotePlayers
                .filter(p => p.name.toUpperCase() !== playerName.toUpperCase() && !p.isHost)
                .map((opp, oIdx) => (
                  <button
                    key={oIdx}
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingOpponent(opp);
                    }}
                    className="flex items-center gap-3 bg-white/5 backdrop-blur-md hover:bg-white/10 p-2.5 rounded-2xl border border-white/10 transition-all active:scale-95 cursor-pointer group shadow-lg"
                  >
                    <div className="flex flex-col items-start min-w-[70px]">
                      <span className="text-[7px] font-mono font-black text-zinc-500 uppercase tracking-widest leading-none mb-0.5 group-hover:text-rose-400 transition-colors">LIHAT</span>
                      <span className="text-[10px] font-bold text-zinc-200 truncate max-w-[70px]">{opp.name}</span>
                    </div>
                    <div className="flex items-center justify-center bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1">
                      <span className="text-[10px] font-black font-mono text-rose-400">
                        {opp.melds?.length || 0}
                      </span>
                      <span className="text-[7px] font-bold text-rose-500/60 ml-1 uppercase">Grup</span>
                    </div>
                  </button>
                ))}
            </div>
          </div>

          {/* 5.6 Section My Meld Display (Zona Aman) */}
          <div className="w-full max-w-4xl px-4 flex flex-col">
            <div className="flex items-center gap-2 mb-2 opacity-50 px-2">
              <div className="w-1 h-1 rounded-full bg-emerald-500" />
              <span className="text-[8px] font-mono font-bold text-emerald-400 uppercase tracking-[0.25em]">
                Zona Aman (Milik Anda)
              </span>
            </div>
            <div className="flex flex-wrap gap-4 min-h-[70px] p-4 rounded-3xl border border-white/5 bg-white/[0.03] backdrop-blur-sm">
              {melds.map((meldGroup, gIdx) => (
                <div key={gIdx} className="flex gap-1.5 bg-white/[0.05] p-2 rounded-2xl border border-emerald-400/10 shadow-xl backdrop-blur-md">
                  {meldGroup.map((c, cIdx) => (
                    <div key={cIdx} className="w-8 h-12 md:w-9 md:h-13 bg-white rounded-md flex flex-col items-center justify-center shadow-sm relative overflow-hidden">
                      <span className={`text-[10px] font-black leading-none ${c.suit === 'hearts' || c.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-900'}`}>
                        {c.value}
                      </span>
                      <span className={`text-[8px] leading-none ${c.suit === 'hearts' || c.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-900'}`}>
                        {c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : c.suit === 'clubs' ? '♣' : '♠'}
                      </span>
                      {c.suit === 'joker' && <div className="absolute top-0 right-0 p-0.5"><span className="text-[6px]">⭐</span></div>}
                    </div>
                  ))}
                </div>
              ))}
              {melds.length === 0 && (
                <div className="flex-1 flex items-center justify-center border border-dashed border-zinc-800/30 rounded-xl">
                  <span className="text-[8px] font-mono text-zinc-700 uppercase tracking-widest">Belum Ada Kombinasi</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* OPPONENT MELD MODAL */}
        {viewingOpponent && (
          <div
            className="fixed inset-0 z-[11000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-fade-in"
            onClick={() => setViewingOpponent(null)}
          >
            <div
              className="w-full max-w-md bg-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 shadow-[0_30px_100px_rgba(0,0,0,0.8)] animate-scale-up flex flex-col max-h-[85vh] relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Decorative Glow */}
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-rose-500/10 rounded-full blur-[80px] pointer-events-none" />
              <div className="flex justify-between items-center mb-6">
                <div className="flex flex-col">
                  <span className="text-[8px] font-mono font-black text-rose-500 uppercase tracking-[0.3em] leading-none mb-1">KARTU TURUN</span>
                  <h3 className="text-lg font-bold text-zinc-100 uppercase tracking-wider">{viewingOpponent.name}</h3>
                </div>
                <button
                  onClick={() => setViewingOpponent(null)}
                  className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="flex flex-wrap gap-4 justify-center">
                  {viewingOpponent.melds && viewingOpponent.melds.length > 0 ? (
                    viewingOpponent.melds.map((meldGroup: any[], gIdx: number) => (
                      <div key={gIdx} className="flex gap-1 bg-zinc-900/60 p-2.5 rounded-2xl border border-zinc-800/80 shadow-inner">
                        {meldGroup.map((c, cIdx) => (
                          <div key={cIdx} className="w-10 h-14 md:w-12 md:h-16 bg-white rounded-lg flex flex-col items-center justify-center shadow-lg relative overflow-hidden">
                            <span className={`text-sm font-black leading-none ${c.suit === 'hearts' || c.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-900'}`}>
                              {c.value}
                            </span>
                            <span className={`text-base leading-none mt-0.5 ${c.suit === 'hearts' || c.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-900'}`}>
                              {c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : c.suit === 'clubs' ? '♣' : '♠'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <div className="w-full flex flex-col items-center justify-center py-12 opacity-30">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4">
                        <rect x="2" y="6" width="20" height="14" rx="2" />
                        <path d="M12 10v6" />
                        <path d="m9 13 3 3 3-3" />
                      </svg>
                      <span className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-500 italic">Belum Ada Kartu Turun</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CONFIRMATION OVERLAY MODAL */}
        {confirmState && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-3xl p-6 shadow-2xl animate-scale-up">
              <h3 className="text-xs font-mono font-black text-zinc-400 uppercase tracking-widest mb-4">
                {confirmState.type === "warning" ? "Aksi Terkunci" : "Konfirmasi Aksi"}
              </h3>
              <p className="text-[11px] text-zinc-300 leading-relaxed mb-6 font-medium whitespace-pre-line text-center">
                {confirmState.message}
              </p>
              <div className="flex gap-3">
                {confirmState.type !== "warning" ? (
                  <>
                    <button
                      onClick={() => setConfirmState(null)}
                      className="flex-1 py-3 rounded-xl border border-zinc-800 text-zinc-500 text-[10px] font-bold uppercase tracking-wider"
                    >
                      Batal
                    </button>
                    <button
                      onClick={confirmState.onConfirm}
                      className={`flex-1 py-3 rounded-xl text-black text-[10px] font-bold uppercase tracking-wider ${confirmState.type === "draw" ? "bg-emerald-500 shadow-emerald-900/20" : "bg-red-500 shadow-red-900/20"
                        }`}
                    >
                      Ya, Lakukan
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmState(null)}
                    className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-black font-mono uppercase tracking-wider shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all cursor-pointer"
                  >
                    Saya Mengerti
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CARD REVEAL OVERLAY (When drawing from deck) */}
        {revealCard && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 backdrop-blur-md animate-fade-in" onClick={() => setRevealCard(null)}>
            <div className="flex flex-col items-center animate-bounce-in">
              <div className="w-32 h-48 bg-white rounded-2xl shadow-2xl flex flex-col items-center justify-center border-4 border-emerald-500 scale-125">
                <span className={`text-5xl font-black ${revealCard.suit === 'hearts' || revealCard.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-950'}`}>
                  {revealCard.value}
                </span>
                <span className={`text-4xl mt-2 ${revealCard.suit === 'hearts' || revealCard.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-950'}`}>
                  {revealCard.suit === 'hearts' ? '♥' : revealCard.suit === 'diamonds' ? '♦' : revealCard.suit === 'clubs' ? '♣' : '♠'}
                </span>
              </div>
              <span className="text-white font-mono font-black text-sm uppercase tracking-[0.4em] mt-12 animate-pulse">
                KARTU BARU!
              </span>
            </div>
          </div>
        )}

        {/* DISCARD OVERLAY (Selection Detail) */}
        {discardOverlayCard && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 backdrop-blur-md animate-fade-in" onClick={() => setDiscardOverlayCard(null)}>
            <div className="flex flex-col items-center animate-scale-up">
              <div className="w-28 h-40 bg-white rounded-2xl shadow-2xl flex flex-col items-center justify-center border-4 border-red-500">
                <span className={`text-4xl font-black ${discardOverlayCard.suit === 'hearts' || discardOverlayCard.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-950'}`}>
                  {discardOverlayCard.value}
                </span>
                <span className={`text-3xl mt-2 ${discardOverlayCard.suit === 'hearts' || discardOverlayCard.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-950'}`}>
                  {discardOverlayCard.suit === 'hearts' ? '♥' : discardOverlayCard.suit === 'diamonds' ? '♦' : discardOverlayCard.suit === 'clubs' ? '♣' : '♠'}
                </span>
              </div>
              <span className="text-red-500 font-mono font-black text-[10px] uppercase tracking-[0.3em] mt-8">
                PILIH UNTUK BUANG?
              </span>
            </div>
          </div>
        )}

      </DndContext>
    </div>
  );
};

export default PlayerGameBoardView;

import React, { useState } from "react";
import SortableCardWrapper from "../SortableCardWrapper";
import { Card } from "../../utils/gameLogic";
import { ViewState } from "../../types/game";

// Drag and drop sorting imports
import {
  DndContext,
  closestCenter,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
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
  totalHandPoints: number;
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
  drawFromDiscardAtIndex: (index: number) => Promise<void>;
  drawFromStock: () => Promise<Card | null>;
  sortMyHand: () => void;
  discardSelected: (cardId: string) => Promise<void>;
  meldSelectedCards: (cardIds: string[]) => Promise<boolean>;
  syncHandSort: (newSortedHand: Card[]) => Promise<void>;
  setToastMsg: (msg: string | null) => void;
  melds?: Card[][];
}

const PlayerGameBoardView: React.FC<PlayerGameBoardViewProps> = ({
  isMyTurn,
  hasDrawnThisTurn,
  activePlayerName,
  totalHandPoints,
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
  drawFromDiscardAtIndex,
  drawFromStock,
  sortMyHand,
  discardSelected,
  meldSelectedCards,
  syncHandSort,
  setToastMsg,
  melds = [],
}) => {
  const circularDiscards = discardPile;

  // --- ACTION CONFIRMATION MODAL STATE ---
  const [confirmState, setConfirmState] = useState<{
    type: "draw" | "discard";
    card: Card;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // --- IMMERSIVE CARD REVEAL OVERLAY ---
  const [revealCard, setRevealCard] = useState<Card | null>(null);

  // --- DISCARD OVERLAY: Kartu yang dipilih untuk dibuang (tap 1x setelah ambil) ---
  const [discardOverlayCard, setDiscardOverlayCard] = useState<Card | null>(null);

  // --- LOCAL MULTI-CARD HAND SELECTION ---
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);

  // --- DRAG AND DROP SENSORS ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

const DroppableDiscardArea = ({ isMyTurn, hasDrawnThisTurn }: { isMyTurn: boolean, hasDrawnThisTurn: boolean }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: "discard-pile-drop-zone",
  });
  
  if (!isMyTurn || !hasDrawnThisTurn) return <div className="flex-1" />;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-2 animate-fade-in w-full">
      <div 
        ref={setNodeRef}
        className={`w-full h-full max-h-[160px] max-w-sm border-2 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all duration-300 ${
          isOver 
            ? "border-red-500 bg-red-950/40 scale-[1.02] shadow-[0_0_40px_rgba(239,68,68,0.3)]" 
            : "border-zinc-800/80 bg-zinc-950/20"
        }`}
      >
        <div className={`w-14 h-14 rounded-full mb-3 flex items-center justify-center transition-all duration-300 ${isOver ? "bg-red-500/20 scale-125 border border-red-500/40" : "bg-zinc-900 border border-zinc-800"}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isOver ? "#ef4444" : "#52525b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isOver ? "animate-bounce" : ""}>
            <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>
          </svg>
        </div>
        <span className={`text-[11px] font-mono font-bold tracking-[0.2em] uppercase text-center transition-colors ${isOver ? "text-red-400" : "text-zinc-600"}`}>
          {isOver ? "Lepas Untuk Buang" : "Seret Kartu Kesini"}
        </span>
        <span className={`text-[8px] font-mono tracking-wider mt-2 transition-colors ${isOver ? "text-red-500/70" : "text-zinc-700"}`}>
          Atau tap 1x pada kartu
        </span>
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
        // Klik di luar kartu → batalkan semua seleksi
        setSelectedDiscardIndex(null);
        setSelectedCardIds([]);
        setDiscardOverlayCard(null);
      }}
      className="fixed inset-0 bg-[#041410] z-50 flex flex-col justify-between select-none animate-fade-in"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
      {/* 5.1 Clean Top Status Bar */}
      <div className="pl-6 pr-36 py-3 flex justify-between items-center border-b border-zinc-900/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                isMyTurn ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"
              }`}
            />
            <div>
              <span className="text-[10px] font-medium text-zinc-300 uppercase tracking-[0.2em] block leading-none">
                {isMyTurn
                  ? hasDrawnThisTurn
                    ? "Pilih & Buang"
                    : "Giliran Anda"
                  : `Giliran: ${activePlayerName}`}
              </span>
            </div>
          </div>
        </div>

        {/* Live Hand Point Counter Badge */}
        <div className="text-center">
          <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.2em] block leading-none mb-0.5">
            TOTAL POIN
          </span>
          <span className="text-xs font-medium font-mono text-zinc-300 tracking-wide block leading-none">
            {totalHandPoints}
          </span>
        </div>


      </div>

      {/* 5.1.5 Interactive Opponent Taunting Row */}
      <div className="px-6 py-2 border-b border-zinc-900/50 bg-black/10 flex items-center gap-4 overflow-x-auto no-scrollbar flex-shrink-0 select-none">
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
                  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3 0-1.07.73-2.73 2-3.33 0 1.1 1.08 1.58 1.5 2.67.33.89.5 1.5.5 2.17 0 2.1-1.79 3.5-3.5 3.5-1.84 0-3.5-1.63-3.5-3.5 0-1.23.35-2.26 1-3.1 0 1.5 1.5 2 2 3.5z"/>
                  <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3-4-4-6.5c-.66 1.9-2 4.5-1 7 0 2-3 3-3 6a6 6 0 0 0 4 6z"/>
                </svg>
              </span>
              <span className="font-medium tracking-wide">{bot.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 5.2 Console: Clickable Dealer Shoe + Scrollable Discard Drawer */}
      {!hasDrawnThisTurn && (
        <div className="px-6 pt-4 animate-fade-in flex flex-col">
          {/* Interactive Section Header */}
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[9px] font-bold font-mono text-zinc-400 uppercase tracking-[0.15em]">
              Ambil Kartu
            </span>
          </div>

          {/* TacTile Console Row */}
          <div className="flex items-center gap-4 pb-2 overflow-hidden">
            
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
              className={`flex-shrink-0 relative select-none transition-all duration-300 ${
                isMyTurn && !hasDrawnThisTurn 
                  ? "cursor-pointer active:scale-[0.96]" 
                  : "opacity-40 cursor-not-allowed"
              }`}
            >
              <div className={`p-1.5 rounded-xl border ${
                isMyTurn && !hasDrawnThisTurn 
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
                  <div className={`absolute bottom-1 right-1 z-20 bg-black/80 text-emerald-400 border px-1 rounded font-mono font-black text-[7px] scale-90 shadow-sm ${
                    isMyTurn && !hasDrawnThisTurn ? "border-emerald-900/50" : "border-zinc-800 text-zinc-500"
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

            {/* Divider Line */}
            <div className="w-[1px] h-12 bg-gradient-to-b from-transparent via-zinc-800/60 to-transparent flex-shrink-0 opacity-80" />

            {/* 2. Scrollable Discards */}
            <div className="flex-1 flex gap-2 overflow-x-auto pb-2 pt-1 px-0.5 snap-x no-scrollbar scrollbar-thin">
              {circularDiscards.map((card, index) => {
                const isSelected = selectedDiscardIndex === index;
                return (
                  <div
                    key={card.id}
                    onClick={(e) => {
                      e.stopPropagation(); // Mencegah reset saat mengetuk kartu itu sendiri
                      if (isSelected) {
                        // Tap ke-2: Proses Ambil jika valid!
                        if (isDiscardSelectionValid && isMyTurn && !hasDrawnThisTurn) {
                          const cardsToTake = circularDiscards.length - index;
                          setConfirmState({
                            type: "draw",
                            card,
                            message: `Yakin ingin mengambil ${cardsToTake} kartu dari buangan?`,
                            onConfirm: () => {
                              drawFromDiscardAtIndex(index);
                              setConfirmState(null);
                              setSelectedDiscardIndex(null);
                            },
                          });
                        } else {
                          // Batal pilih jika tidak sah atau diklik ulang
                          setSelectedDiscardIndex(null);
                        }
                      } else {
                        // Tap ke-1: Pilih/Highlight
                        setSelectedDiscardIndex(index);
                      }
                    }}
                    className={`flex-shrink-0 relative transition-all duration-500 cursor-pointer snap-start ${
                      isSelected ? "-translate-y-2.5 scale-[1.05] z-30" : "z-10"
                    }`}
                  >
                    <div
                      className={`w-13 h-18 md:w-14 md:h-20 rounded-lg border relative flex flex-col items-center justify-center bg-zinc-100 select-none transition-all duration-300 ${
                        isSelected
                          ? "border-zinc-400 shadow-[0_10px_20px_rgba(0,0,0,0.4)] bg-white"
                          : "border-zinc-300/80 bg-zinc-200/90 shadow-sm"
                      }`}
                    >
                      <span
                        className={`text-base leading-none font-bold ${
                          card.suit === "hearts" || card.suit === "diamonds"
                            ? "text-red-600"
                            : "text-zinc-950"
                        }`}
                      >
                        {card.value}
                      </span>
                      <span
                        className={`text-xs leading-none mt-0.5 ${
                          card.suit === "hearts" || card.suit === "diamonds"
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

                      {/* Sequence Number */}
                      <div className="absolute top-0.5 right-1 text-[7.5px] font-black font-mono text-zinc-500">
                        #{((circularDiscards.length - index - 1) % 7) + 1}
                      </div>

                      {/* Thrown By Attribution */}
                      <div className="absolute bottom-0 left-0 right-0 text-center text-[5.5px] font-mono uppercase tracking-[0.05em] font-bold text-zinc-500 truncate px-0.5 border-t border-zinc-200 bg-zinc-200/60 py-0.5 rounded-b-lg">
                        {card.thrownBy || "Dealer"}
                      </div>

                      {/* GLASS ACTION OVERLAY: Muncuk ketika kartu diketuk! */}
                      {isSelected && (
                        <div className={`absolute inset-0 z-40 rounded-lg flex flex-col items-center justify-center backdrop-blur-[1.5px] border border-white/20 animate-fade-in transition-all duration-300 ${
                          isDiscardSelectionValid && isMyTurn && !hasDrawnThisTurn
                            ? "bg-emerald-950/90 shadow-[0_0_15px_rgba(16,185,129,0.35)]"
                            : "bg-red-950/90 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                        }`}>
                          {isDiscardSelectionValid && isMyTurn && !hasDrawnThisTurn ? (
                            <>
                              <span className="text-[8px] font-black text-emerald-400 tracking-widest animate-pulse">
                                AMBIL
                              </span>
                              <svg className="w-3.5 h-3.5 text-emerald-400 animate-bounce mt-0.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                              </svg>
                              <span className="text-[5.5px] font-mono font-bold text-emerald-300/70">
                                ({circularDiscards.length - index} Kartu)
                              </span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5 text-red-400/90 animate-pulse" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              <span className="text-[5.5px] font-mono font-black text-red-400/80 mt-0.5 uppercase tracking-wider">
                                Terkunci
                              </span>
                            </>
                          )}
                        </div>
                      )}
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
      )}

      <DroppableDiscardArea isMyTurn={isMyTurn} hasDrawnThisTurn={hasDrawnThisTurn} />

      {/* 5.3 Main Compact Quick Actions (Horizontal, Clean SVG Icons) */}
      <div className="px-6 py-2 w-full max-w-md mx-auto min-h-[60px] flex items-center justify-center gap-3">
        {/* BUTTON TURUNKAN (MELD) - ONLY ICON */}
        {selectedCardIds.length >= 3 && (
          <button
            onClick={async (e) => {
              e.stopPropagation(); // Mencegah deselect dari root onClick
              const success = await meldSelectedCards(selectedCardIds);
              if (success) {
                setSelectedCardIds([]); // Auto reset on success
              }
            }}
            className="w-14 h-14 rounded-2xl bg-emerald-950/45 text-emerald-400 border border-emerald-800/60 hover:bg-emerald-900/30 shadow-[0_0_25px_rgba(16,185,129,0.15)] transition-all flex items-center justify-center cursor-pointer active:scale-90 animate-fade-in"
            title={`Turunkan ${selectedCardIds.length} Kartu`}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M19 12l-7 7-7-7"/>
            </svg>
          </button>
        )}

        {/* ACTION BUTTONS (DISCARD / CLOSE) - ONLY 1 CARD SELECTED */}
        {selectedCardIds.length === 1 && (
          (() => {
            const selectedCard = playerHand.find(c => c.id === selectedCardIds[0]);
            const isClosingCondition = playerHand.length === 1;
            const canShowDiscard = (isMyTurn && hasDrawnThisTurn) || isClosingCondition;

            if (!canShowDiscard || !selectedCard) return null;

            return (
              <div className="flex gap-4 animate-fade-in">
                {/* TRASH ICON (BUANG) - DIRECT ACTION */}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const cardId = selectedCard.id;
                    setSelectedCardIds([]); // Reset selection
                    await discardSelected(cardId);
                  }}
                  className="w-14 h-14 rounded-2xl bg-zinc-900/60 border border-zinc-800 hover:border-emerald-500/50 hover:bg-zinc-800/80 flex items-center justify-center transition-all cursor-pointer shadow-lg active:scale-90"
                  title="Buang Kartu"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>
                  </svg>
                </button>

                {/* TROPHY ICON (TUTUP) - DIRECT ACTION */}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isClosingCondition) {
                      const cardId = selectedCard.id;
                      setSelectedCardIds([]); // Reset selection
                      await discardSelected(cardId);
                    }
                  }}
                  className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all shadow-lg ${
                    isClosingCondition 
                      ? "bg-amber-950/40 border-amber-500/50 hover:bg-amber-900/60 cursor-pointer active:scale-90 shadow-amber-500/10" 
                      : "bg-zinc-950/40 border-zinc-900 cursor-not-allowed opacity-20 grayscale"
                  }`}
                  title={isClosingCondition ? "Tutup Permainan" : "Sisa Kartu > 1"}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isClosingCondition ? "#f59e0b" : "#444"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17M14 14.66V17M18 2h-12v11a6 6 0 0 0 12 0V2zM12 17v5"/>
                  </svg>
                </button>
              </div>
            );
          })()
        )}
      </div>

      {/* Minimal Action Guidance */}
      <div className="text-center text-[8px] font-mono tracking-widest uppercase py-1.5 px-4 min-h-[24px] flex items-center justify-center">
        {!hasDrawnThisTurn ? (
          selectedDiscardIndex !== null && !isDiscardSelectionValid ? (
            <span className="text-red-900/90 tracking-[0.15em]">
              Kartu wajib membentuk seri/kembar
            </span>
          ) : null
        ) : selectedCardIds.length >= 3 ? (
          <span className="text-emerald-500/80 tracking-[0.15em] font-bold animate-pulse">
            ✦ Ketuk TURUNKAN untuk gelar kartu ✦
          </span>
        ) : selectedCardIds.length === 1 ? (
          <span className="text-zinc-400 tracking-[0.12em]">
            Ketuk BUANG untuk akhiri giliran
          </span>
        ) : (
          <span className="text-zinc-600 tracking-wider">
            Pilih 1 kartu untuk BUANG, atau 3+ untuk TURUN
          </span>
        )}
      </div>

      {/* 5.3.5 ZONA AMAN: KARTU DITUMPUK (SAFE ZONE MELDS VISUALIZATION) */}
      {melds && melds.length > 0 && (
        <div className="px-6 pt-1.5 pb-1 animate-fade-in select-none w-full max-w-xl mx-auto">
          {/* Label Zona Aman */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-[8px] font-black font-mono text-emerald-400 uppercase tracking-[0.2em]">
              Zona Aman (Kartu Ditumpuk)
            </span>
          </div>

          {/* Melds Grid Wrapper - Horizontal Stack */}
          <div className="flex gap-3 overflow-x-auto pb-2 pt-1 no-scrollbar scrollbar-thin snap-x">
            {melds.map((meldGroup, gIdx) => (
              <div 
                key={gIdx} 
                className="flex-shrink-0 flex gap-0.5 bg-emerald-950/25 border border-emerald-900/40 rounded-xl p-1.5 min-w-[90px] justify-center snap-start shadow-inner shadow-black/30 backdrop-blur-[1px]"
              >
                {meldGroup.map((c, cIdx) => (
                  <div 
                    key={c.id} 
                    className="w-7 h-10 rounded-md bg-zinc-100 border border-zinc-300 shadow-md flex flex-col items-center justify-center relative -ml-1.5 first:ml-0 active:scale-110 hover:-translate-y-1 transition-all duration-200"
                    style={{ zIndex: cIdx }}
                  >
                    <span className={`text-[9px] leading-none font-black ${
                      c.suit === "hearts" || c.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
                    }`}>
                      {c.value}
                    </span>
                    <span className={`text-[6.5px] leading-none mt-0.5 ${
                      c.suit === "hearts" || c.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
                    }`}>
                      {c.suit === "hearts" ? "♥" : c.suit === "diamonds" ? "♦" : c.suit === "clubs" ? "♣" : c.suit === "spades" ? "♠" : (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5.4 Clean Grid Hand Area (Fluid Drag & Drop Sortable) */}
      <div 
        className="w-full flex-1 min-h-[220px] px-6 pb-6 overflow-y-auto select-none flex flex-col justify-center"
      >
        <SortableContext
          items={playerHand.map((c) => c.id)}
          strategy={rectSortingStrategy}
        >
          <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-4 max-w-xl mx-auto py-2">
            {playerHand.map((card) => (
              // stopPropagation di sini agar klik pada kartu tidak naik ke root dan membatalkan seleksi
              <div key={card.id} onClick={(e) => e.stopPropagation()}>
                <SortableCardWrapper
                  id={card.id}
                  suit={card.suit}
                  value={card.value}
                  isSelected={selectedCardIds.includes(card.id)}
                  hasDrawnThisTurn={hasDrawnThisTurn}
                  onClick={() => {
                    // Tap kartu sekarang HANYA untuk pilih/deselect (glow)
                    // Agar tidak bentrok dengan modal buang saat ingin menurunkan kartu
                    if (selectedCardIds.includes(card.id)) {
                      setSelectedCardIds((prev) => prev.filter((id) => id !== card.id));
                    } else {
                      setSelectedCardIds((prev) => [...prev, card.id]);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </div>

      {/* ELEGANT MICRO CONFIRMATION MODAL OVERLAY */}
      {confirmState && (
        <div 
          onClick={(e) => e.stopPropagation()} 
          className="fixed inset-0 z-[9999] flex items-center justify-center px-6 animate-fade-in"
        >
          {/* Deep Glass Backdrop */}
          <div 
            className="absolute inset-0 bg-black/85 backdrop-blur-md" 
            onClick={() => setConfirmState(null)} 
          />

          {/* Card Visual MicroModal Container */}
          <div className="relative w-full max-w-[280px] bg-[#051712]/95 border border-zinc-800/80 rounded-3xl p-6 shadow-2xl shadow-black scale-up select-none text-center">
            
            {/* Header Category */}
            <h4 className={`text-[9px] font-mono tracking-[0.2em] font-semibold uppercase mb-4 leading-none ${
              confirmState.type === "draw" ? "text-emerald-500" : "text-red-500"
            }`}>
              {confirmState.type === "draw" ? "✦ Konfirmasi Ambil" : "✦ Konfirmasi Buang"}
            </h4>

            {/* High-Fidelity Card Visual Preview */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-24 rounded-xl bg-zinc-100 border border-zinc-300 shadow-[0_8px_24px_rgba(0,0,0,0.4)] flex flex-col items-center justify-center scale-105 transition-transform">
                <span className={`text-2xl leading-none font-bold ${
                  confirmState.card.suit === "hearts" || confirmState.card.suit === "diamonds"
                    ? "text-red-600" : "text-zinc-950"
                }`}>
                  {confirmState.card.value}
                </span>
                <span className={`text-lg leading-none mt-1 ${
                  confirmState.card.suit === "hearts" || confirmState.card.suit === "diamonds"
                    ? "text-red-600" : "text-zinc-950"
                }`}>
                  {confirmState.card.suit === "hearts" ? "♥" : 
                   confirmState.card.suit === "diamonds" ? "♦" : 
                   confirmState.card.suit === "clubs" ? "♣" : 
                   confirmState.card.suit === "spades" ? "♠" : (
                     <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
                       <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                     </svg>
                   )}
                </span>
              </div>
            </div>

            {/* Core Message */}
            <p className="text-[11px] text-zinc-300 font-mono tracking-wide leading-relaxed px-1 mb-5">
              {confirmState.message}
            </p>

            {/* Quick Actions */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmState(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-800 bg-black/20 hover:bg-black/40 text-[9px] font-mono font-medium uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={confirmState.onConfirm}
                className={`flex-1 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase tracking-widest cursor-pointer transition-all border shadow-sm ${
                  confirmState.type === "draw"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400 hover:bg-emerald-950/50"
                    : "bg-red-950/30 border-red-900/50 text-red-400 hover:bg-red-950/50"
                }`}
              >
                Yakin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* CARD-SHAPED ACTION OVERLAY — Glassmorphism Style        */}
      {/* ════════════════════════════════════════════════════════ */}
      {discardOverlayCard && (() => {
        const canClose = playerHand.length === 1;
        const suitSymbol = discardOverlayCard.suit === "hearts" ? "♥" :
                           discardOverlayCard.suit === "diamonds" ? "♦" :
                           discardOverlayCard.suit === "clubs" ? "♣" : 
                           discardOverlayCard.suit === "spades" ? "♠" : (
                             <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500 inline-block mb-0.5">
                               <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                             </svg>
                           );
        const isRed = discardOverlayCard.suit === "hearts" || discardOverlayCard.suit === "diamonds";

        const handleAction = (e: React.MouseEvent) => {
          e.stopPropagation();
          const cardId = discardOverlayCard.id;
          setDiscardOverlayCard(null);
          discardSelected(cardId).then(() => setSelectedCardIds([]));
        };

        return (
          <div
            onClick={() => setDiscardOverlayCard(null)}
            className="fixed inset-0 z-[99998] flex items-center justify-center animate-fade-in"
          >
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes dualCardPop {
                0%   { transform: scale(0.5) translateY(40px); opacity: 0; filter: blur(8px); }
                65%  { transform: scale(1.05) translateY(-5px); opacity: 1; filter: blur(0); }
                100% { transform: scale(1) translateY(0); opacity: 1; }
              }
              @keyframes dualCardPopRight {
                0%   { transform: scale(0.5) translateY(40px) rotate(4deg); opacity: 0; filter: blur(8px); }
                65%  { transform: scale(1.05) translateY(-5px) rotate(-1deg); opacity: 1; filter: blur(0); }
                100% { transform: scale(1) translateY(0) rotate(0deg); opacity: 1; }
              }
              @keyframes glowGreen {
                0%,100% { box-shadow: 0 0 20px rgba(16,185,129,0.25), inset 0 0 20px rgba(16,185,129,0.06); }
                50%     { box-shadow: 0 0 40px rgba(16,185,129,0.5), inset 0 0 40px rgba(16,185,129,0.12); }
              }
              @keyframes glowGold {
                0%,100% { box-shadow: 0 0 20px rgba(212,175,55,0.3), inset 0 0 20px rgba(212,175,55,0.08); }
                50%     { box-shadow: 0 0 50px rgba(212,175,55,0.65), inset 0 0 50px rgba(212,175,55,0.18); }
              }
              .anim-left  { animation: dualCardPop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards; opacity: 0; }
            `}} />

            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/65 backdrop-blur-md" />

            {/* Layout: card preview atas, dua pilihan bawah */}
            <div className="relative z-10 flex flex-col items-center gap-5">

              {/* Preview kartu yang dipilih */}
              <div
                className="anim-left"
                style={{ width: 56, height: 84 }}
              >
                <div className={`w-full h-full rounded-xl bg-white border-2 flex flex-col justify-between p-1.5 shadow-2xl ${isRed ? "border-red-300" : "border-zinc-300"}`}>
                  <div className={`flex flex-col items-center leading-none ${isRed ? "text-red-500" : "text-zinc-900"}`}>
                    <span className="text-[11px] font-bold">{discardOverlayCard.value}</span>
                    <span className="text-[9px] -mt-0.5">{suitSymbol}</span>
                  </div>
                  <div className={`self-end flex flex-col items-center leading-none rotate-180 ${isRed ? "text-red-500" : "text-zinc-900"}`}>
                    <span className="text-[11px] font-bold">{discardOverlayCard.value}</span>
                    <span className="text-[9px] -mt-0.5">{suitSymbol}</span>
                  </div>
                </div>
              </div>

              {/* Dua kartu aksi berdampingan */}
              <div className="flex gap-4 items-center">

                {/* ── BUANG (kiri, selalu aktif) ── */}
                <div
                  onClick={handleAction}
                  className="relative flex flex-col items-center justify-center gap-3 select-none active:scale-95 transition-transform cursor-pointer"
                  style={{
                    width: 130,
                    height: 180,
                    // Gabungkan pop + glow dalam satu property animation
                    animation: "dualCardPop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards, glowGreen 1.8s ease-in-out 0.4s infinite",
                    opacity: 0,
                    background: "rgba(3, 18, 10, 0.88)",
                    border: "1.5px solid rgba(16,185,129,0.4)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                    borderRadius: 22,
                  }}
                >
                  <div className="absolute top-0 left-5 right-5 h-[1.5px] rounded-full" style={{ background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.7), transparent)" }} />
                  <span className="text-base font-black font-mono tracking-[0.2em] uppercase" style={{ color: "#10b981" }}>BUANG</span>
                  <span style={{ color: "#10b981" }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M19 12l-7 7-7-7"/>
                    </svg>
                  </span>
                  <span className="text-[10px] font-mono text-center px-2" style={{ color: "rgba(16,185,129,0.6)" }}>
                    {discardOverlayCard.value} {suitSymbol}
                  </span>
                  <div className="absolute bottom-0 left-5 right-5 h-[1.5px] rounded-full" style={{ background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.4), transparent)" }} />
                </div>

                {/* ── TUTUP (kanan, hanya aktif jika sisa 1 kartu) ── */}
                <div
                  onClick={canClose ? handleAction : (e) => e.stopPropagation()}
                  className={`relative flex flex-col items-center justify-center gap-3 select-none transition-transform ${canClose ? "active:scale-95 cursor-pointer" : "cursor-not-allowed opacity-40"}`}
                  style={{
                    width: 130,
                    height: 180,
                    // Gabungkan pop + glow dalam satu property animation (glow hanya jika canClose)
                    animation: canClose
                      ? "dualCardPopRight 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.07s forwards, glowGold 1.6s ease-in-out 0.47s infinite"
                      : "dualCardPopRight 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.07s forwards",
                    opacity: 0,
                    background: canClose ? "rgba(20, 12, 0, 0.88)" : "rgba(10,10,10,0.7)",
                    border: canClose ? "1.5px solid rgba(212,175,55,0.5)" : "1.5px solid rgba(80,60,0,0.3)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                    borderRadius: 22,
                  }}
                >
                  <div className="absolute top-0 left-5 right-5 h-[1.5px] rounded-full" style={{ background: canClose ? "linear-gradient(90deg, transparent, rgba(212,175,55,0.7), transparent)" : "none" }} />
                  <span className="text-base font-black font-mono tracking-[0.2em] uppercase" style={{ color: canClose ? "#d4af37" : "#4a3800" }}>TUTUP</span>
                  <span style={{ lineHeight: 1 }}>
                    {canClose ? (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17M14 14.66V17M18 2h-12v11a6 6 0 0 0 12 0V2zM12 17v5"/>
                      </svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4a3800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-center px-2 leading-tight" style={{ color: canClose ? "rgba(212,175,55,0.65)" : "rgba(80,60,0,0.6)" }}>
                    {canClose ? "Tutup\nPermainan" : "Sisa > 1\nKartu"}
                  </span>
                  <div className="absolute bottom-0 left-5 right-5 h-[1.5px] rounded-full" style={{ background: canClose ? "linear-gradient(90deg, transparent, rgba(212,175,55,0.4), transparent)" : "none" }} />
                </div>

              </div>

              {/* Hint */}
              <span className="text-[10px] font-mono text-zinc-600 tracking-widest uppercase">
                Ketuk di luar untuk batal
              </span>
            </div>
          </div>
        );
      })()}



      {/* HIGH-FIDELITY FULLSCREEN CARD REVEAL OVERLAY */}


      {revealCard && (
        <div 
          onClick={(e) => {
            e.stopPropagation();
            setRevealCard(null);
          }}
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md select-none animate-fade-in cursor-pointer"
        >
          {/* Custom Keyframe Animation Injection */}
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes zoom-reveal {
              0% { transform: scale(0.4) rotate(-8deg); opacity: 0; filter: blur(8px); }
              60% { transform: scale(1.15) rotate(3deg); filter: blur(0); }
              100% { transform: scale(1.05) rotate(0deg); opacity: 1; }
            }
            .anim-zoom-reveal {
              animation: zoom-reveal 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }
          `}} />

          {/* Glowing Backdrop Accent */}
          <div className="absolute w-72 h-72 rounded-full bg-emerald-500/10 blur-[100px] animate-pulse pointer-events-none" />
          
          {/* Subdued Category Header */}
          <span className="text-[10px] font-mono tracking-[0.3em] font-black text-zinc-500 uppercase mb-8 animate-pulse">
            ✦ KARTU DIDAPAT ✦
          </span>

          {/* THE MAJESTIC FLOATING CARD */}
          <div className="relative anim-zoom-reveal">
            <div className="w-32 h-48 rounded-2xl bg-zinc-50 border border-white shadow-[0_30px_70px_-10px_rgba(0,0,0,0.95)] flex flex-col items-center justify-center select-none">
              <span className={`text-5xl font-black tracking-tighter leading-none ${
                revealCard.suit === "hearts" || revealCard.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
              }`}>
                {revealCard.value}
              </span>
              <span className={`text-4xl leading-none mt-4 ${
                revealCard.suit === "hearts" || revealCard.suit === "diamonds" ? "text-red-600" : "text-zinc-950"
              }`}>
                    {revealCard.suit === "hearts" ? "♥" : 
                     revealCard.suit === "diamonds" ? "♦" : 
                     revealCard.suit === "clubs" ? "♣" : 
                     revealCard.suit === "spades" ? "♠" : (
                       <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
                         <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                       </svg>
                     )}
              </span>
            </div>
          </div>

          {/* Mini Skip Helper */}
          <span className="text-[9px] font-mono font-bold text-zinc-600 tracking-[0.2em] uppercase mt-12 opacity-80 animate-bounce-subtle">
            Sentuh layar untuk menutup
          </span>
        </div>
      )}

      {/* ELIMINATED REDUNDANT INTRO MODAL TO PREVENT UI FLICKERING */}
      </DndContext>
    </div>
  );
};

export default PlayerGameBoardView;

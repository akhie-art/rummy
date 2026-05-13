import React, { useState } from "react";
import SortableCardWrapper from "../SortableCardWrapper";
import { Card } from "../../utils/gameLogic";
import { ViewState } from "../../types/game";

// Drag and drop sorting imports
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const activeIndex = playerHand.findIndex((c) => c.id === active.id);
      const overIndex = playerHand.findIndex((c) => c.id === over.id);
      const nextHand = arrayMove(playerHand, activeIndex, overIndex);
      syncHandSort(nextHand);
    }
  };

  return (
    <div 
      onClick={() => setSelectedDiscardIndex(null)}
      className="fixed inset-0 bg-[#041410] z-50 flex flex-col justify-between select-none animate-fade-in"
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
              <span className="text-[9px] font-mono text-zinc-600 mt-0.5 block uppercase tracking-wider">
                {isMyTurn
                  ? hasDrawnThisTurn
                    ? "Buang 1 kartu"
                    : "Ambil 1 kartu"
                  : "Menunggu Giliran Lawan"}
              </span>
            </div>
          </div>

          {/* SUBDUED EMERGENCY EXIT PILL */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Apakah Anda yakin ingin menyerah & keluar dari ruangan?")) {
                setView("landing"); // Triggers handleExitGame("landing") in parent!
              }
            }}
            className="ml-1.5 px-2 py-1 border border-red-950 bg-red-950/20 text-red-500/70 hover:text-red-400 hover:border-red-800/60 rounded-md text-[8px] font-black font-mono tracking-widest uppercase transition-all active:scale-90 hover:shadow-[0_0_10px_rgba(220,38,38,0.15)] cursor-pointer flex items-center"
          >
            Keluar
          </button>
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
              <span className="text-[8px] animate-pulse group-hover:scale-110 transition-transform">
                🔥
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
                        #{circularDiscards.length - index}
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

      {hasDrawnThisTurn && <div className="flex-1" />}

      {/* 5.3 Main Compact Quick Actions (Horizontal, Clean SVG Icons) */}
      <div className="px-6 py-2 w-full max-w-md mx-auto min-h-[60px] flex items-center justify-center">
        {selectedCardIds.length >= 3 ? (
          /* MELD KARTU BUTTON (GLOWING EMERALD!) - MAGNIFICENT FULL WIDTH */
          <button
            onClick={async () => {
              if (!isMyTurn) {
                setToastMsg("Harap tunggu GILIRAN Anda untuk menurunkan kartu! ⚠️");
                setTimeout(() => setToastMsg(null), 2500);
                return;
              }

              const success = await meldSelectedCards(selectedCardIds);
              if (success) {
                setSelectedCardIds([]); // Auto reset on success
              }
            }}
            className="w-full py-3 rounded-xl font-black text-[11px] uppercase tracking-[0.2em] bg-emerald-950/45 text-emerald-400 border border-emerald-800/60 hover:bg-emerald-900/30 shadow-[0_0_25px_rgba(16,185,129,0.15)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.97] animate-fade-in"
          >
            <span className="animate-pulse text-[12px]">✦</span>
            <span>Turunkan ({selectedCardIds.length})</span>
            <span className="animate-pulse text-[12px]">✦</span>
          </button>
        ) : hasDrawnThisTurn ? (
          /* DISCARD SELECTION (WARNING RED) - ONLY VISIBLE POST-DRAW, MAJESTIC FULL WIDTH */
          <button
            disabled={selectedCardIds.length !== 1}
            onClick={() => {
              if (selectedCardIds.length === 1) {
                const targetId = selectedCardIds[0];
                const card = playerHand.find(c => c.id === targetId);
                if (card) {
                  setConfirmState({
                    type: "discard",
                    card,
                    message: "Yakin ingin membuang kartu ini? Tindakan ini akan langsung mengakhiri giliran Anda.",
                    onConfirm: () => {
                      discardSelected(targetId);
                      setConfirmState(null);
                      setSelectedCardIds([]); // Reset selection
                    }
                  });
                }
              }
            }}
            className={`w-full py-3 rounded-xl font-bold text-[11px] uppercase tracking-[0.2em] transition-all border flex items-center justify-center gap-2 animate-fade-in ${
              selectedCardIds.length === 1
                ? "bg-red-950/35 text-red-400 border-red-900/60 hover:bg-red-950/50 cursor-pointer active:scale-[0.97]"
                : "bg-zinc-950/40 border-zinc-900/40 text-zinc-600 cursor-not-allowed shadow-none opacity-50"
            }`}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            </svg>
            <span>Buang</span>
          </button>
        ) : null}
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
                      {c.suit === "hearts" ? "♥" : c.suit === "diamonds" ? "♦" : c.suit === "clubs" ? "♣" : "♠"}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5.4 Clean Grid Hand Area (Fluid Drag & Drop Sortable) */}
      <div className="w-full flex-1 min-h-[220px] px-6 pb-6 overflow-y-auto select-none flex flex-col justify-center">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={playerHand.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
            <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-4 max-w-xl mx-auto py-2">
              {playerHand.map((card) => (
                <SortableCardWrapper
                  key={card.id}
                  id={card.id}
                  suit={card.suit}
                  value={card.value}
                  isSelected={selectedCardIds.includes(card.id)}
                  hasDrawnThisTurn={hasDrawnThisTurn}
                  onClick={() => {
                    setSelectedCardIds((prev) =>
                      prev.includes(card.id)
                        ? prev.filter((id) => id !== card.id)
                        : [...prev, card.id]
                    );
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
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
                   confirmState.card.suit === "spades" ? "♠" : "🃏"}
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
                 revealCard.suit === "spades" ? "♠" : "🃏"}
              </span>
            </div>
          </div>

          {/* Mini Skip Helper */}
          <span className="text-[9px] font-mono font-bold text-zinc-600 tracking-[0.2em] uppercase mt-12 opacity-80 animate-bounce-subtle">
            Sentuh layar untuk menutup
          </span>
        </div>
      )}
    </div>
  );
};

export default PlayerGameBoardView;

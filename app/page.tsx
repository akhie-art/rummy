"use client";

import React, { useState, useEffect } from "react";
import PlayingCard from "./components/PlayingCard";
import SortableCardWrapper from "./components/SortableCardWrapper";
import { Card, createDeck, shuffleDeck, sortHand, canDrawDiscardCard, getCardPoints } from "./utils/gameLogic";

// Drag and drop sorting imports
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy
} from "@dnd-kit/sortable";

type ViewState = "landing" | "host_lobby" | "host_game" | "player_lobby" | "player_game";

export default function Home() {
  const [view, setView] = useState<ViewState>("landing");
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [fireTaunt, setFireTaunt] = useState<{ active: boolean, sender: string | null }>({ active: false, sender: null });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  
  // --- GAME STATE ---
  const [deck, setDeck] = useState<Card[]>([]);
  const [discardPile, setDiscardPile] = useState<Card[]>([]); // Index 0 is the LATEST discard
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [hasDrawnThisTurn, setHasDrawnThisTurn] = useState(false);
  
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedDiscardIndex, setSelectedDiscardIndex] = useState<number | null>(null);

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
      setPlayerHand(arrayMove(playerHand, activeIndex, overIndex));
    }
  };

  // Mock Bot Players Data
  const [bots] = useState([
    { name: "Siti", cardCount: 7 },
    { name: "Andi", cardCount: 7 },
    { name: "Dewi", cardCount: 7 },
  ]);

  // Initialize and Start Game
  const initGame = () => {
    const rawDeck = createDeck();
    const shuffled = shuffleDeck(rawDeck);
    const dealtHand = shuffled.splice(0, 7);
    const initialDiscard = shuffled.splice(0, 3);
    
    setDeck(shuffled);
    setPlayerHand(dealtHand);
    setDiscardPile(initialDiscard);
    setHasDrawnThisTurn(false);
    setSelectedCardId(null);
    setSelectedDiscardIndex(null);

    // Generate Room Code if missing
    if (!roomCode) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let newCode = "";
      for (let i = 0; i < 4; i++) {
        newCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      setRoomCode(newCode);
    }
  };

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn(`Fullscreen error: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    initGame();
    
    // Deep link QR auto join detection
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get("room");
      if (urlRoom && urlRoom.length === 4) {
        setRoomCode(urlRoom.toUpperCase());
        setView("player_lobby");
      }

      // Track native browser fullscreen events
      const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", handleFs);
      document.addEventListener("webkitfullscreenchange", handleFs); // Safari compatibility
      
      return () => {
        document.removeEventListener("fullscreenchange", handleFs);
        document.removeEventListener("webkitfullscreenchange", handleFs);
      };
    }
  }, []);

  // Actions
  const drawFromStock = () => {
    if (hasDrawnThisTurn) return;
    if (deck.length === 0) return;
    const newDeck = [...deck];
    const drawnCard = newDeck.shift()!;
    setDeck(newDeck);
    setPlayerHand([...playerHand, drawnCard]);
    setHasDrawnThisTurn(true);
    setSelectedDiscardIndex(null);
  };

  const drawFromDiscardAtIndex = (index: number) => {
    if (hasDrawnThisTurn) return;
    if (index >= discardPile.length || index >= 7) return;
    
    const newDiscard = [...discardPile];
    // LOGIC UPDATE: Taking a card now takes THAT card AND all older cards beneath it 
    // (from current index up to the rest of the available 7 circular cards).
    const availableToTake = Math.min(newDiscard.length, 7);
    const countToTake = availableToTake - index;
    
    // Splice starts at selected 'index' and takes 'countToTake' elements downwards
    const takenCards = newDiscard.splice(index, countToTake); 
    
    setDiscardPile(newDiscard);
    setPlayerHand([...playerHand, ...takenCards]);
    setHasDrawnThisTurn(true);
    setSelectedDiscardIndex(null);
  };

  const discardSelected = () => {
    if (!selectedCardId) return;
    if (!hasDrawnThisTurn) return;
    const cardToDiscard = playerHand.find(c => c.id === selectedCardId);
    if (!cardToDiscard) return;
    setPlayerHand(playerHand.filter(c => c.id !== selectedCardId));
    setDiscardPile([cardToDiscard, ...discardPile]);
    setSelectedCardId(null);
    setHasDrawnThisTurn(false);
  };

  // Funny Interactive Taunt with Bot Retaliation
  const sendFireTaunt = (targetName: string) => {
    setToastMsg(`Anda membakar layar ${targetName}! 🔥`);
    setTimeout(() => setToastMsg(null), 2000);

    // Randomized Retaliation Timer (3-5 seconds later)
    const delay = 3000 + Math.floor(Math.random() * 2000);
    setTimeout(() => {
      // Play the fiery retaliation overlay
      setFireTaunt({ active: true, sender: targetName });
      
      // Auto clean-up when CSS animation finishes (2.2s)
      setTimeout(() => {
        setFireTaunt({ active: false, sender: null });
      }, 2200);
    }, delay);
  };

  const sortMyHand = () => {
    setPlayerHand(sortHand(playerHand));
  };

  const circularDiscards = discardPile.slice(0, 7);
  
  const selectedDiscardCard = selectedDiscardIndex !== null ? circularDiscards[selectedDiscardIndex] : null;
  const isDiscardSelectionValid = selectedDiscardCard ? canDrawDiscardCard(selectedDiscardCard, playerHand) : false;
  
  const totalHandPoints = playerHand.reduce((sum, card) => sum + getCardPoints(card), 0);

  // Dynamically construct the deep link for scanning
  const getJoinLink = () => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}?room=${roomCode || ""}`;
    }
    return `http://localhost:3000?room=${roomCode || ""}`;
  };

  // Create the thematic custom QR Code image URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&color=e4e4e7&bgcolor=09251d&qzone=2&data=${encodeURIComponent(getJoinLink())}`;

  return (
    <main className="min-h-screen text-zinc-200 relative flex flex-col items-center justify-center p-4 overflow-hidden bg-[#041611]">
      
      {/* Ambient Background */}
      <div className="absolute inset-0 pointer-events-none bg-radial from-[#08251d] to-[#041410] opacity-80" />

      {/* Global Minimalist Fullscreen Toggle Button */}
      <button 
        onClick={toggleFullscreen}
        className="fixed top-4 right-4 z-[9999] p-2 rounded-lg border border-zinc-800/60 bg-[#041611]/40 hover:bg-zinc-900/60 backdrop-blur-md text-zinc-500 hover:text-zinc-300 cursor-pointer transition-all flex items-center justify-center group"
        title={isFullscreen ? "Keluar Layar Penuh" : "Layar Penuh"}
      >
        {isFullscreen ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        )}
      </button>

      {/* Global Minimalist Rules Modal Button */}
      <button 
        onClick={() => setShowRules(true)}
        className="fixed top-4 right-14 z-[9999] p-2 rounded-lg border border-zinc-800/60 bg-[#041611]/40 hover:bg-zinc-900/60 backdrop-blur-md text-zinc-500 hover:text-zinc-300 cursor-pointer transition-all flex items-center justify-center group"
        title="Aturan Game"
      >
        <svg className="w-3.5 h-3.5 transition-all group-hover:text-amber-400 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-7 7c0 2.3 1 4.4 2.6 5.9C8.5 15.8 9 16.9 9 18h6c0-1.1.5-2.2 1.4-3.1A7 7 0 0 0 12 2z" />
        </svg>
      </button>

      {/* ========================================= */}
      {/* GLOBAL RULES OVERLAY (MINIMALIST & LUXE) */}
      {/* ========================================= */}
      {showRules && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 animate-fade-in">
          {/* Backdrop Click Area */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowRules(false)} />
          
          {/* Modal Body */}
          <div className="relative w-full max-w-sm bg-[#051a15] border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/90 p-6 select-none max-h-[80vh] overflow-y-auto no-scrollbar border-t border-t-emerald-900/30">
            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.3 1 4.4 2.6 5.9C8.5 15.8 9 16.9 9 18h6c0-1.1.5-2.2 1.4-3.1A7 7 0 0 0 12 2z" />
                </svg>
                <h2 className="text-[10px] font-medium tracking-[0.2em] text-zinc-200 uppercase">Aturan Game</h2>
              </div>
              <button onClick={() => setShowRules(false)} className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300 uppercase tracking-widest cursor-pointer transition-colors">Tutup</button>
            </div>

            <div className="space-y-5 text-[10px] font-mono leading-relaxed tracking-wide text-zinc-400">
              {/* Rule 1 */}
              <div>
                <h4 className="text-[9px] font-bold tracking-widest text-zinc-200 uppercase mb-1.5 border-b border-zinc-900/80 pb-0.5">1. Susunan Seri (Run)</h4>
                <p className="mb-1">✓ <span className="text-zinc-300">Seri Angka</span>: Berurutan di antara angka <b>2 s.d 10</b>.</p>
                <p className="mb-1">✓ <span className="text-zinc-300">Seri Gambar</span>: Khusus urutan <b>J - Q - K</b>.</p>
                <p className="text-red-900 font-medium mt-1">✗ Dilarang Menyeberang: Kombinasi 9-10-J atau 10-J-Q ilegal.</p>
              </div>

              {/* Rule 2 */}
              <div>
                <h4 className="text-[9px] font-bold tracking-widest text-zinc-200 uppercase mb-1.5 border-b border-zinc-900/80 pb-0.5">2. Kasta Kartu As (Ace)</h4>
                <p className="mb-1">✓ As dibebaskan dari kasta urutan angka/seri.</p>
                <p className="mb-1 text-red-900 font-medium">✗ Dilarang dibuat Seri (Batal: As-2-3 atau Q-K-As).</p>
                <p>✓ Kartu As hanya hidup lewat <span className="text-zinc-300">Kartu Kembar (Set)</span>.</p>
              </div>

              {/* Rule 3 */}
              <div>
                <h4 className="text-[9px] font-bold tracking-widest text-zinc-200 uppercase mb-1.5 border-b border-zinc-900/80 pb-0.5">3. Larangan Kartu Tengah</h4>
                <p className="mb-1">✓ Memungut buangan hanya boleh untuk mengisi <span className="text-zinc-300">Ujung</span> seri.</p>
                <p className="text-red-900 font-medium mt-1">✗ Jika pegang 4 & 6, dilarang memungut angka 5.</p>
              </div>

              {/* Rule 4 */}
              <div>
                <h4 className="text-[9px] font-bold tracking-widest text-zinc-200 uppercase mb-1.5 border-b border-zinc-900/80 pb-0.5">4. Kartu Joker (Emas)</h4>
                <p>✓ Kartu sakti serbaguna (Wildcard). Berhak menyamar menggantikan kartu apa pun dalam kombinasi.</p>
              </div>

              {/* Rule 5 */}
              <div className="pt-1">
                <h4 className="text-[9px] font-bold tracking-widest text-zinc-200 uppercase mb-2">5. Tabel Poin Skor</h4>
                <div className="grid grid-cols-2 gap-y-1.5 border border-zinc-900/80 rounded-lg p-2.5 bg-black/40 text-zinc-500 text-[9px]">
                  <span>Kartu 2 - 10:</span> <span className="text-zinc-300 font-medium">5 Poin</span>
                  <span>Kartu J, Q, K:</span> <span className="text-zinc-300 font-medium">10 Poin</span>
                  <span>Kartu As:</span> <span className="text-zinc-300 font-medium">15 Poin</span>
                  <span>Kartu Joker:</span> <span className="text-amber-600 font-bold">20 Poin</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* INTERACTIVE GAME TAUNTS OVERLAYS        */}
      {/* ========================================= */}
      
      {/* 1. Fullscreen Burning Fire Effect (Inner Ring) */}
      {fireTaunt.active && (
        <div className="fixed inset-0 pointer-events-none z-[99999] fiery-screen flex items-center justify-center">
          {/* Glowing Retaliation Alert Center */}
          <div className="bg-zinc-950/90 border border-red-800/50 backdrop-blur-md px-6 py-4 rounded-2xl flex flex-col items-center justify-center shadow-2xl shadow-red-950/60 select-none animate-pulse scale-90">
            <span className="text-2xl mb-2 leading-none animate-bounce">🔥</span>
            <span className="text-[8px] font-mono font-black text-red-600 uppercase tracking-[0.25em] block">SERANGAN API!</span>
            <span className="text-[10px] font-medium tracking-widest text-zinc-200 uppercase mt-1.5">
              {fireTaunt.sender} Membakar Layar Anda!
            </span>
          </div>
        </div>
      )}

      {/* 2. Action Confirmation Toast Alert */}
      {toastMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[99999] bg-zinc-950 border border-zinc-800/80 backdrop-blur-md rounded-full px-4 py-2 shadow-2xl shadow-black/60 text-[10px] font-mono tracking-widest text-zinc-200 uppercase flex items-center gap-2 select-none animate-fade-in pointer-events-none border-t-zinc-700/40">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ========================================= */}
      {/* 1. LANDING VIEW (MINIMALIST)              */}
      {/* ========================================= */}
      {view === "landing" && (
        <div className="max-w-xs w-full bg-black/20 backdrop-blur-md rounded-2xl p-6 text-center relative z-10 border border-zinc-800/60 animate-fade-in">
          <div className="mb-8 flex flex-col items-center">
            <h1 className="text-3xl font-light tracking-[0.25em] text-zinc-100 uppercase">
              Rummy
            </h1>
            <div className="h-[1px] w-12 bg-zinc-700 mt-3 opacity-50" />
          </div>

          <div className="space-y-4">
            <button 
              onClick={() => { initGame(); setView("host_lobby"); }}
              className="w-full py-2.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium tracking-widest transition-all uppercase cursor-pointer"
            >
              Buat Meja
            </button>
            
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-zinc-800/50"></div>
              <span className="flex-shrink mx-3 text-[9px] text-zinc-600 tracking-widest font-mono">ATAU</span>
              <div className="flex-grow border-t border-zinc-800/50"></div>
            </div>

            <div className="space-y-2.5">
              <input 
                type="text" 
                placeholder="NAMA KAMU" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-center text-zinc-200 text-xs font-light tracking-widest placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors uppercase"
              />
              <input 
                type="text" 
                placeholder="KODE ROOM" 
                maxLength={4}
                className="w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-center text-zinc-200 text-xs font-medium tracking-[0.2em] placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors uppercase"
              />
              <button 
                onClick={() => { initGame(); setView("player_lobby"); }}
                className="w-full py-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium tracking-widest transition-all uppercase cursor-pointer"
              >
                Gabung Game
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 2. HOST LOBBY VIEW (MINIMALIST)          */}
      {/* ========================================= */}
      {view === "host_lobby" && (
        <div className="max-w-md w-full bg-black/20 backdrop-blur-md rounded-2xl p-6 relative z-10 border border-zinc-800/60">
          <button onClick={() => setView("landing")} className="text-zinc-500 hover:text-zinc-300 mb-6 text-[10px] tracking-widest font-mono uppercase flex items-center gap-1 transition-colors">
            Kembali
          </button>
          
          <div className="text-center mb-6 flex flex-col items-center">
            <span className="text-zinc-500 text-[9px] tracking-[0.2em] uppercase">Kode Room</span>
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
            
            <span className="text-[8px] font-mono text-zinc-500 tracking-widest uppercase leading-none block mb-2">Pindai QR untuk Gabung</span>
            <span className="text-[9px] text-emerald-600 font-mono tracking-[0.15em] uppercase animate-pulse leading-none block">Menunggu Pemain</span>
          </div>

          <div className="grid grid-cols-1 gap-2 mb-6">
            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs text-zinc-300 font-light tracking-wider">{playerName || "Budi"} (Anda)</span>
              <span className="text-emerald-600 text-[9px] font-mono">SIAP</span>
            </div>
            {bots.map((bot, idx) => (
              <div key={idx} className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-zinc-500 font-light tracking-wider">{bot.name}</span>
                <span className="text-emerald-700/60 text-[9px] font-mono">SIAP</span>
              </div>
            ))}
          </div>

          <button 
            onClick={() => setView("host_game")}
            className="w-full py-2.5 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-xs font-medium tracking-widest transition-all uppercase cursor-pointer bg-zinc-900/80"
          >
            Mulai Game
          </button>
        </div>
      )}

      {/* ========================================= */}
      {/* 3. HOST GAME VIEW (CLEAN CIRCULAR TABLE)  */}
      {/* ========================================= */}
      {view === "host_game" && (
        <div className="w-full max-w-5xl h-[90vh] relative z-10 flex flex-col justify-between animate-fade-in">
          
          {/* Minimal Top Bar */}
          <div className="flex justify-between items-center rounded-xl px-4 py-2.5 mx-auto w-full max-w-xl border border-zinc-800/50 bg-black/20 backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600"></span>
              <span className="font-mono text-[10px] text-zinc-500 tracking-wider uppercase">Room: <b className="text-zinc-300 font-normal">{roomCode}</b></span>
            </div>
            <h3 className="text-[10px] font-medium tracking-[0.25em] text-zinc-400 uppercase">Meja Utama</h3>
            <button onClick={() => { initGame(); setView("landing"); }} className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 tracking-widest uppercase transition-colors">Ulangi</button>
          </div>

          {/* Table layout */}
          <div className="flex-1 flex relative items-center justify-center">
            
            {/* Player 2 (Top) */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-center z-20">
              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{bots[0].name}</div>
              <div className="flex gap-0.5 mt-1 justify-center opacity-40 scale-75">
                {[...Array(bots[0].cardCount)].map((_, i) => (
                  <div key={i} className="w-3 h-5 rounded-sm bg-zinc-700 border border-zinc-800 shadow-sm" />
                ))}
              </div>
            </div>

            {/* Player 3 (Left) */}
            <div className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-20">
              <div className="text-[10px] font-mono text-zinc-600 -rotate-90 mb-2 uppercase tracking-wider">{bots[1].name}</div>
              <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono">{bots[1].cardCount}</div>
            </div>

            {/* Player 4 (Right) */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-20">
              <div className="text-[10px] font-mono text-zinc-600 rotate-90 mb-2 uppercase tracking-wider">{bots[2].name}</div>
              <div className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full w-6 h-6 flex items-center justify-center font-mono">{bots[2].cardCount}</div>
            </div>

            {/* CLEAN CIRCULAR TABLE CONTAINER */}
            <div className="w-[70vh] max-w-[480px] aspect-square rounded-full relative flex items-center justify-center border border-zinc-800/40 bg-black/10">
              
              {/* Subdued Orbit Ring */}
              <div className="absolute inset-16 border border-zinc-900/50 border-dashed rounded-full pointer-events-none" />

              {/* STOCK PILE IN THE DEAD CENTER */}
              <div className="relative z-30 p-1.5 rounded-xl border border-zinc-800 bg-black/20 transition-transform">
                <div className="relative w-16 h-24 md:w-20 md:h-28">
                  <PlayingCard suit="hearts" value="A" faceUp={false} className="w-full h-full relative z-10 border-zinc-800 pointer-events-none bg-zinc-900" />
                  
                  <div className="absolute -bottom-2 -right-2 z-20 bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-[9px] border border-zinc-700 font-mono font-normal">
                    {deck.length}
                  </div>
                </div>
              </div>

              {/* DISCARD PILE CIRCULAR */}
              {circularDiscards.map((card, index) => {
                const angleStep = 360 / 7;
                const angle = index * angleStep - 90; 
                const radius = 135; // Smaller elegant orbit
                
                const style = {
                  transform: `rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`,
                  transition: "all 0.4s ease",
                  zIndex: 20 - index,
                  opacity: 1 - (index * 0.12),
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
                      className={`border ${index === 0 ? 'border-zinc-400 shadow-lg' : 'border-zinc-700/50'}`} 
                    />
                    
                    <div className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-mono border ${index === 0 ? 'bg-zinc-200 text-zinc-900 border-zinc-300' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                      {index + 1}
                    </div>
                  </div>
                );
              })}

              {discardPile.length === 0 && (
                <div className="absolute text-[9px] font-mono text-zinc-700 uppercase tracking-wider">
                  Buangan Kosong
                </div>
              )}

            </div>

            {/* Player 1 (Bottom) */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 border border-zinc-800 bg-zinc-900/30 px-5 py-2 rounded-xl flex flex-col items-center z-20">
              <div className="text-[9px] text-zinc-400 font-mono tracking-[0.2em] uppercase font-normal flex items-center gap-1">
                <span className="w-1 h-1 bg-emerald-700 rounded-full" />
                Aktif: {playerName || "BUDI"}
              </div>
              <div className="flex gap-0.5 mt-1 justify-center scale-75 opacity-70">
                {[...Array(playerHand.length)].map((_, i) => (
                  <div key={i} className="w-4 h-6 rounded-sm bg-zinc-700 border border-zinc-800" />
                ))}
              </div>
            </div>

          </div>

          {/* Minimal Switcher */}
          <div className="text-center text-zinc-700 text-[9px] font-mono mb-4 flex justify-center gap-3 uppercase tracking-wider">
            <span>Tampilan Host</span>
            <button onClick={() => setView("player_game")} className="text-zinc-400 border-b border-zinc-700 hover:text-zinc-200 transition-colors cursor-pointer">Simulasikan Layar HP</button>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 4. PLAYER LOBBY VIEW (MINIMALIST)        */}
      {/* ========================================= */}
      {view === "player_lobby" && (
        <div className="max-w-xs w-full bg-black/20 backdrop-blur-md rounded-2xl p-6 text-center border border-zinc-800/60">
          <div className="mb-6 flex flex-col items-center">
            <h2 className="text-lg font-light tracking-widest uppercase text-zinc-200">Sudah Gabung</h2>
            <span className="text-zinc-500 text-[9px] font-mono mt-1 tracking-widest uppercase">Pemain: {playerName || "Budi"}</span>
          </div>

          <div className="border border-zinc-800/50 bg-zinc-900/30 py-4 rounded-lg mb-6">
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest block mb-1">Status</span>
            <span className="text-emerald-700 font-medium text-xs tracking-widest uppercase">Siap</span>
          </div>

          <button 
            onClick={() => setView("player_game")}
            className="w-full py-2.5 rounded-lg bg-zinc-200 hover:bg-zinc-100 text-zinc-900 text-xs font-medium tracking-widest uppercase cursor-pointer transition-colors"
          >
            Masuk Game
          </button>
        </div>
      )}

      {/* ========================================= */}
      {/* 5. PLAYER GAME VIEW (IMMERSIVE & MINIMAL) */}
      {/* ========================================= */}
      {view === "player_game" && (
        <div className="fixed inset-0 bg-[#041410] z-50 flex flex-col justify-between select-none animate-fade-in">
          
          {/* 5.1 Clean Top Status Bar */}
          <div className="px-6 py-3 flex justify-between items-center border-b border-zinc-900/80">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${!hasDrawnThisTurn ? "bg-emerald-600" : "bg-zinc-600"}`} />
              <div>
                <span className="text-[10px] font-medium text-zinc-300 uppercase tracking-[0.2em] block leading-none">
                  {hasDrawnThisTurn ? "Pilih & Buang" : "Giliran Anda"}
                </span>
                <span className="text-[9px] font-mono text-zinc-500 mt-0.5 block uppercase tracking-wider">
                  {hasDrawnThisTurn ? "Buang 1 kartu" : "Ambil 1 kartu"}
                </span>
              </div>
            </div>

            {/* Live Hand Point Counter Badge */}
            <div className="text-center">
              <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.2em] block leading-none mb-0.5">TOTAL POIN</span>
              <span className="text-xs font-medium font-mono text-zinc-300 tracking-wide block leading-none">{totalHandPoints}</span>
            </div>
            
            <button 
              onClick={() => setView("host_game")} 
              className="px-2.5 py-1 rounded border border-zinc-800 hover:border-zinc-700 text-[9px] tracking-widest font-mono text-zinc-500 hover:text-zinc-300 transition-all uppercase cursor-pointer flex items-center gap-1"
            >
              Meja Host
            </button>
          </div>

          {/* 5.1.5 Interactive Opponent Taunting Row */}
          <div className="px-6 py-2 border-b border-zinc-900/50 bg-black/10 flex items-center gap-4 overflow-x-auto no-scrollbar flex-shrink-0 select-none">
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.2em] flex-shrink-0">Bakar Lawan</span>
            <div className="flex items-center gap-2 flex-1">
              {bots.map((bot, idx) => (
                <button
                  key={idx}
                  onClick={() => sendFireTaunt(bot.name)}
                  className="px-2.5 py-1 rounded-lg border border-zinc-800/60 hover:border-red-900/60 bg-black/20 hover:bg-red-950/15 text-[9px] font-mono text-zinc-500 hover:text-red-500 flex items-center gap-1.5 cursor-pointer transition-all uppercase active:scale-95 group"
                  title={`Bakar layar ${bot.name}`}
                >
                  <span className="text-[8px] animate-pulse group-hover:scale-110 transition-transform">🔥</span>
                  <span className="font-medium tracking-wide">{bot.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 5.2 Scrollable Discard Drawer (Cleaned) */}
          {!hasDrawnThisTurn && (
            <div className="px-6 pt-4 animate-fade-in">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[9px] font-normal font-mono text-zinc-500 uppercase tracking-widest">
                  Kartu Buangan
                </span>
                <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
                  Geser Kanan →
                </span>
              </div>
              
              <div className="flex gap-2.5 overflow-x-auto pb-3 pt-1 px-1 snap-x scrollbar-thin">
                {circularDiscards.map((card, index) => {
                  const isSelected = selectedDiscardIndex === index;
                  return (
                    <div 
                      key={card.id} 
                      onClick={() => setSelectedDiscardIndex(isSelected ? null : index)}
                      className={`flex-shrink-0 relative transition-all duration-300 cursor-pointer snap-start ${
                        isSelected ? '-translate-y-1.5' : ''
                      }`}
                    >
                      <div className={`w-16 h-24 rounded-lg border relative flex flex-col items-center justify-center bg-zinc-100 select-none transition-all ${
                        isSelected ? 'border-zinc-300 shadow-md bg-white scale-105' : 'border-zinc-300/80 bg-zinc-200/90'
                      }`}>
                        <span className={`text-lg leading-none font-semibold ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-950'}`}>
                          {card.value}
                        </span>
                        <span className={`text-sm leading-none mt-0.5 ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-600' : 'text-zinc-950'}`}>
                          {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                        </span>
                        
                        <div className="absolute top-1 right-1.5 text-[9px] font-mono font-medium text-zinc-400/60">
                          {index + 1}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-600 rounded-full w-4 h-4 flex items-center justify-center text-[8px] text-white font-bold shadow-sm">
                          ✓
                        </div>
                      )}
                    </div>
                  );
                })}
                {discardPile.length === 0 && (
                  <div className="h-24 w-full border border-dashed border-zinc-800/60 rounded-xl flex items-center justify-center text-[9px] font-mono text-zinc-600">KOSONG</div>
                )}
              </div>
            </div>
          )}

          {hasDrawnThisTurn && <div className="flex-1" />}

          {/* 5.3 Main Compact Quick Actions (Horizontal, Clean SVG Icons) */}
          <div className="px-6 py-2 w-full max-w-md mx-auto">
            {!hasDrawnThisTurn ? (
              <div className="flex gap-2">
                {/* Action to take selected discard */}
                <button 
                  disabled={!isDiscardSelectionValid}
                  onClick={() => { if (selectedDiscardIndex !== null && isDiscardSelectionValid) drawFromDiscardAtIndex(selectedDiscardIndex); }}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 border ${
                    isDiscardSelectionValid 
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 cursor-pointer shadow-sm shadow-zinc-900' 
                      : 'bg-zinc-900/40 text-zinc-600 border-zinc-900/60 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3H7c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                    <polyline points="15 13 12 16 9 13" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                  </svg>
                  <span>
                    {selectedDiscardIndex !== null 
                      ? `Ambil (${circularDiscards.length - selectedDiscardIndex})` 
                      : "Ambil"}
                  </span>
                </button>

                {/* Direct Draw from stock */}
                <button 
                  onClick={drawFromStock}
                  className="flex-1 py-2.5 rounded-lg border border-zinc-800 bg-transparent hover:bg-zinc-900/50 text-zinc-400 text-[10px] font-medium uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M7 8h10" />
                    <path d="M7 12h10" />
                  </svg>
                  <span>Dek</span>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {/* Sort Hand */}
                <button 
                  onClick={sortMyHand}
                  className="flex-1 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 font-medium text-[10px] uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="14" y2="12" />
                    <line x1="4" y1="18" x2="8" y2="18" />
                  </svg>
                  <span>Susun</span>
                </button>

                {/* Discard Selection */}
                <button 
                  disabled={!selectedCardId}
                  onClick={discardSelected}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-[10px] uppercase tracking-widest transition-all border flex items-center justify-center gap-2 ${
                    selectedCardId
                      ? "bg-red-950/30 text-red-400 border-red-900/80 hover:bg-red-900/20 cursor-pointer" 
                      : "bg-zinc-900/50 border-zinc-900/80 text-zinc-600 cursor-not-allowed"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  </svg>
                  <span>Buang</span>
                </button>
              </div>
            )}
          </div>

          {/* Minimal Action Guidance */}
          <div className="text-center text-[8px] font-mono tracking-widest uppercase py-1.5 px-4 min-h-[24px] flex items-center justify-center">
            {!hasDrawnThisTurn 
              ? selectedDiscardIndex !== null && !isDiscardSelectionValid
                ? <span className="text-red-900/90 tracking-[0.15em]">Kartu wajib membentuk seri/kembar</span>
                : <span className="text-zinc-600">Pilih kartu buang atau ketuk dek</span> 
              : selectedCardId 
                ? <span className="text-zinc-500">Ketuk tombol buang untuk konfirmasi</span> 
                : <span className="text-zinc-600">Pilih kartu tangan untuk dibuang</span>}
          </div>

          {/* 5.4 Clean Grid Hand Area (Fluid Drag & Drop Sortable) */}
          <div className="w-full flex-1 min-h-[220px] px-6 pb-6 overflow-y-auto select-none flex flex-col justify-center">
            
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={playerHand.map(c => c.id)}
                strategy={rectSortingStrategy}
              >
                <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-4 max-w-xl mx-auto py-2">
                  {playerHand.map((card) => (
                    <SortableCardWrapper
                      key={card.id}
                      id={card.id}
                      suit={card.suit}
                      value={card.value}
                      isSelected={selectedCardId === card.id}
                      hasDrawnThisTurn={hasDrawnThisTurn}
                      onClick={() => {
                        if (hasDrawnThisTurn) {
                          setSelectedCardId(selectedCardId === card.id ? null : card.id);
                        }
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

        </div>
      )}
    </main>
  );
}



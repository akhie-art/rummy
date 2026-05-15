"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, createDeck, shuffleDeck, sortHand, canDrawDiscardCard, getCardPoints, getMeldPoints, isSet, isRun } from "./utils/gameLogic";
import { supabase } from "./utils/supabaseClient";
import { audio } from "./utils/audioEngine";

// Import View Komponen Modular Baru
import LandingView from "./components/views/LandingView";
import HostLobbyView from "./components/views/HostLobbyView";
import PlayerLobbyView from "./components/views/PlayerLobbyView";
import HostGameBoardView from "./components/views/HostGameBoardView";
import PlayerGameBoardView from "./components/views/PlayerGameBoardView";

// Import Modals
import LeaderboardModal from "./components/modals/LeaderboardModal";
import FloatingSocialDeck from "./components/modals/FloatingSocialDeck";
import Confetti from "./components/VFX/Confetti";
import FloatingEmojis from "./components/VFX/FloatingEmojis";

// Import Shared Game Types
import { RemotePlayer, RemoteGameState, ViewState, ChatMessage } from "./types/game";

// Utility Cerdas: Merekonsiliasi kartu tangan lokal pemain dengan data dari server.
// Ini MENCEGAH kartu teracak kembali otomatis ketika ada sinkronisasi websocket/polling,
// dengan cara menghormati URUTAN array yang dibuat secara lokal oleh fitur Drag-and-Drop.
const reconcilePlayerHand = (currentLocal: Card[], incomingServer: Card[]): Card[] => {
  if (!incomingServer || incomingServer.length === 0) return [];
  if (!currentLocal || currentLocal.length === 0) return incomingServer;
  
  const serverIdMap = new Map(incomingServer.map(c => [c.id, c]));
  
  // 1. Pertahankan kartu lokal yang masih ada di server (Menjaga URUTAN Drag-and-Drop)
  const preservedLocalOrdered = currentLocal.filter(c => serverIdMap.has(c.id));
  
  // 2. Cari kartu baru di server yang belum tercatat di lokal kita (Misal baru Ambil/Draw)
  const localIdSet = new Set(currentLocal.map(c => c.id));
  const newCards = incomingServer.filter(c => !localIdSet.has(c.id));
  
  // 3. Gabungkan: Urutan lokal + Kartu baru ditaruh paling kanan/akhir
  const reconciled = [...preservedLocalOrdered, ...newCards];
  
  // Jaring pengaman integritas data
  if (reconciled.length !== incomingServer.length) {
    return incomingServer;
  }

  // OPTIMIZATION: Jika urutan ID sama persis, kembalikan array asli agar React tidak re-render
  if (currentLocal.length === reconciled.length) {
    const isSameOrder = currentLocal.every((c, i) => c.id === reconciled[i].id);
    if (isSameOrder) return currentLocal;
  }

  return reconciled;
};

export default function Home() {
  const [view, setView] = useState<ViewState>("landing");
  // ... state vars ...

  const applyRemoteState = (newState: RemoteGameState, myName: string) => {
    if (!newState) return;

    // 1. Players (Atomic check to avoid re-render loops)
    setRemotePlayers((prev: RemotePlayer[]) => {
      if (prev.length !== newState.players.length) return newState.players;
      const hasChanges = prev.some((p, i) => {
        const sP = newState.players[i];
        return p.name !== sP.name || p.hand.length !== sP.hand.length || p.score !== sP.score || p.hasDrawn !== sP.hasDrawn;
      });
      return hasChanges ? newState.players : prev;
    });

    // 2. Game Status
    setGameStatus((prev: string) => prev !== newState.status ? newState.status : prev);

    // 3. Active Turn
    setActiveTurnIndex((prev: number) => prev !== newState.turn_index ? newState.turn_index : prev);

    // 4. Deck & Discard
    setDeck((prev: Card[]) => prev.length !== newState.deck.length ? newState.deck : prev);
    setDiscardPile((prev: Card[]) => {
      if (prev.length !== newState.discard_pile.length) return newState.discard_pile;
      if (prev.length > 0 && prev[0].id !== newState.discard_pile[0].id) return newState.discard_pile;
      return prev;
    });

    // 5. Chat
    setChatMessages((prev: ChatMessage[]) => {
      const incoming = newState.chat_messages || [];
      if (prev.length !== incoming.length) return incoming;
      return prev;
    });

    // 5.5 Card Back Color
    if (newState.card_back_color) setCardBackColor(newState.card_back_color);
    if (newState.table_theme) setTableTheme(newState.table_theme);

    // 5.6 Reactions
    if (newState.reactions) {
      setReactions(newState.reactions.map(r => ({ id: r.id, emoji: r.emoji, timestamp: r.timestamp })));
    }

    // 6. View Routing
    setView((currView: ViewState) => {
      // Jika status 'playing' tapi kita baru saja mulai (sedang animasi bagi kartu), 
      // JANGAN pindah view dulu agar animasi muncul di atas lobby sebagai transisi.
      if (newState.status === "playing") {
        // Jika sedang dealing, tetap di lobby sebentar
        if (isDealingCards) return currView;

        if (currView === "player_lobby") return "player_game";
        if (currView === "host_lobby") return "host_game";
      } else if (newState.status === "waiting") {
        if (currView === "player_game") return "player_lobby";
        if (currView === "host_game") return "host_lobby";
      }
      return currView;
    });

    // 7. Local Hand Reconcile
    const serverMe = newState.players.find(p => p.name.toUpperCase() === myName.toUpperCase());
    if (serverMe) {
      setPlayerHand((current: Card[]) => reconcilePlayerHand(current, serverMe.hand));
      setHasDrawnThisTurn((prev: boolean) => prev !== serverMe.hasDrawn ? serverMe.hasDrawn : prev);
    }
  };
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showGlobalMenu, setShowGlobalMenu] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [fireTaunt, setFireTaunt] = useState<{ active: boolean, sender: string | null, target: string | null }>({ active: false, sender: null, target: null });
  const [hostFireTaunt, setHostFireTaunt] = useState<{ sender: string; target: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  
  // --- REMOTE MULTIPLAYER STATE ---
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "showdown" | "finished">("waiting");
  const [globalGameOverData, setGlobalGameOverData] = useState<{
    standings: {
      name: string;
      roundPoints: number;
      prevScore: number;
      totalScore: number;
      melds?: import('./utils/gameLogic').Card[][];
      closingCard?: import('./utils/gameLogic').Card;
    }[];
    updatedPlayers: RemotePlayer[];
  } | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(0);
  const [isHostRole, setIsHostRole] = useState<boolean>(false);

  // --- LOBBY INTERACTIVE TAUNTS ---
  const [activeTauntOverlay, setActiveTauntOverlay] = useState<{ sender: string; emoji: string } | null>(null);
  const lastSeenTauntTime = useRef<number>(0);
  const lastSeenFireTauntTime = useRef<number>(0);
  const channelRef = useRef<any>(null);
  const prevGameStatus = useRef<string>("waiting");

  const [isDealingCards, setIsDealingCards] = useState(false);
  const [showWhoStartsModal, setShowWhoStartsModal] = useState<{ name: string; isMe: boolean } | null>(null);
  const [showMyTurnModal, setShowMyTurnModal] = useState(false);
  const lastTurnNotifyRef = useRef<number>(-1);

  // --- GAME STATE ---
  const [deck, setDeck] = useState<Card[]>([]);
  const [discardPile, setDiscardPile] = useState<Card[]>([]); // Index 0 is the LATEST discard
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [hasDrawnThisTurn, setHasDrawnThisTurn] = useState(false);
  
  const [selectedDiscardIndex, setSelectedDiscardIndex] = useState<number | null>(null);
  
  // --- INTEGRATED SOCIAL DECK CHAT STATE ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [cardBackColor, setCardBackColor] = useState<string>("emerald");
  const [tableTheme, setTableTheme] = useState<string>("emerald");
  const [voiceTaunt, setVoiceTaunt] = useState<string | undefined>(undefined);
  const [reactions, setReactions] = useState<{ id: string, emoji: string, timestamp: number }[]>([]);

  const cardThemes: any = {
    emerald: { bg: "bg-emerald-900", border: "border-emerald-400", light: "bg-emerald-100/50", accent: "border-emerald-200" },
    rose: { bg: "bg-rose-900", border: "border-rose-400", light: "bg-rose-100/50", accent: "border-rose-200" },
    indigo: { bg: "bg-indigo-900", border: "border-indigo-400", light: "bg-indigo-100/50", accent: "border-indigo-200" },
    amber: { bg: "bg-amber-900", border: "border-amber-400", light: "bg-amber-100/50", accent: "border-amber-200" },
    zinc: { bg: "bg-zinc-800", border: "border-zinc-400", light: "bg-zinc-100/50", accent: "border-zinc-200" },
  };
  const theme = cardThemes[cardBackColor] || cardThemes.emerald;

  const tableThemes: any = {
    emerald: "bg-[#041410]",
    midnight: "bg-[#020617]",
    wood: "bg-[#1c0d02]",
    casino: "bg-[#062010]",
  };
  const activeTableTheme = tableThemes[tableTheme] || tableThemes.emerald;



  // Derived backward-compatible opponents state from active Remote Players!
  const bots = remotePlayers
    .filter(p => !p.isHost && p.name.toUpperCase() !== (playerName || "").toUpperCase())
    .map(p => ({
      name: p.name,
      cardCount: p.hand.length
    }));

  // ==========================================
  // SUPABASE REALTIME MULTIPLAYER ENGINE
  // ==========================================

  // Auto-detect finished game to display Global Game Over Modal
  useEffect(() => {
    if (gameStatus === "finished" && !globalGameOverData && (view === "host_game" || view === "player_game")) {
      const activePlayers = remotePlayers.filter(p => !p.isHost);
      const rawStandings = activePlayers.map((player) => {
        const isWinner = player.hand.length === 0;
        let roundPoints = (player.melds || []).reduce((sum: number, group: Card[]) => sum + getMeldPoints(group), 0);
        
        // Bonus tutup untuk pemenang
        if (isWinner) {
          const topCard = discardPile.length > 0 ? discardPile[0] : null;
          // Hanya beri bonus 10x jika kartu teratas buangan dibuang oleh si pemenang (Tutup Kartu)
          const isTutupWin = topCard && topCard.thrownBy === player.name;
          const closingBonus = isTutupWin ? getCardPoints(topCard as Card) * 10 : 0;
          roundPoints += closingBonus;
        }

        const totalScore = player.score;
        const prevScore = totalScore - roundPoints;
        return {
          name: player.name,
          roundPoints,
          prevScore,
          totalScore,
          melds: (player.melds || []) as Card[][],
          closingCard: isWinner && discardPile.length > 0 && discardPile[0].thrownBy === player.name ? discardPile[0] : undefined,
        };
      });
      // Highest score wins (Indonesian Style)
      rawStandings.sort((a, b) => b.totalScore - a.totalScore);
      setGlobalGameOverData({ standings: rawStandings, updatedPlayers: remotePlayers });
      
      const isMeWinner = rawStandings.some(s => s.name.toUpperCase() === (playerName || "").toUpperCase() && s.roundPoints > 0);
      if (isMeWinner) audio.playWin();
    } else if (gameStatus !== "finished" && globalGameOverData) {
      setGlobalGameOverData(null);
    }
  }, [gameStatus, remotePlayers, view, globalGameOverData, playerName]);

  // Dealing Cards Audio Effect
  useEffect(() => {
    if (isDealingCards) {
      for (let i = 0; i < 7; i++) {
        setTimeout(() => audio.playCardDeal(), i * 150);
      }
    }
  }, [isDealingCards]);

  // Turn Start Ping Effect
  useEffect(() => {
    if (gameStatus === "playing" && view === "player_game") {
      const playingPlayers = remotePlayers.filter(p => !p.isHost);
      const myIdx = playingPlayers.findIndex(p => p.name.toUpperCase() === (playerName || "").toUpperCase());
      if (myIdx !== -1 && myIdx === activeTurnIndex) {
        audio.playTurnStart();
      }
    }
  }, [activeTurnIndex, gameStatus, view, remotePlayers, playerName]);

  const subscribeToRoom = async (code: string, myName: string) => {
    // 1. Bersihkan channel lama secara aman (AWAIT agar tidak bentrok dengan channel baru!)
    try {
      await supabase.removeAllChannels();
    } catch (err) {
      console.warn("Supabase cleanup failed silently:", err);
    }

    // 2. Coba bangun langganan WebSocket (Bungkus try-catch untuk jaring pengaman total)
    try {
      const channel = supabase
        .channel(`channel_${code.toUpperCase()}`, {
          config: {
            broadcast: { self: true }, // Sangat membantu untuk verifikasi lokal!
          }
        })
        .on(
          "postgres_changes",
          {
            event: "*", // Listen to all actions for maximum robustness
            schema: "public",
            table: "rooms",
          },
          (payload) => {
            console.log("🔥 REALTIME EVENT RECEIVED:", payload);
            
            // Bulletproof Application-Level Filtering!
            // Ensures real-time updates bypass strict Postgres WAL replica requirements
            const incomingRoom = payload.new as { room_code: string; game_state: RemoteGameState };
            
            if (incomingRoom && incomingRoom.room_code === code.toUpperCase()) {
              console.log("🎯 MATCHING ROOM FOUND! Applying State...");
              const newState = incomingRoom.game_state;
              if (newState) {
                applyRemoteState(newState, myName);

                // Detect and trigger active interactive lobby taunts!
                if (newState.taunt && newState.taunt.timestamp > lastSeenTauntTime.current) {
                  lastSeenTauntTime.current = newState.taunt.timestamp;
                  setActiveTauntOverlay({ sender: newState.taunt.sender, emoji: newState.taunt.emoji });
                  // Clean up animation overlay after 2.5s
                  setTimeout(() => setActiveTauntOverlay(null), 2500);
                }

                // Detect and trigger FIRE TAUNT (Bakar Layar)
                if (newState.fireTaunt && newState.fireTaunt.timestamp > lastSeenFireTauntTime.current) {
                  lastSeenFireTauntTime.current = newState.fireTaunt.timestamp;
                  
                  // ONLY trigger if I am the target!
                  if (newState.fireTaunt.target.toUpperCase() === myName.toUpperCase()) {
                    setFireTaunt({ active: true, sender: newState.fireTaunt.sender, target: newState.fireTaunt.target });
                    // Auto clean-up after 2.2s
                    setTimeout(() => setFireTaunt({ active: false, sender: null, target: null }), 2200);
                  }
                  // Always update host view with the full taunt event
                  setHostFireTaunt({ sender: newState.fireTaunt.sender, target: newState.fireTaunt.target });
                  setTimeout(() => setHostFireTaunt(null), 2500);
                }

                // Detect Game Start for Animation
                if (prevGameStatus.current === "waiting" && newState.status === "playing") {
                  setIsDealingCards(true);
                  // Start Dealing Animation Sequence
                  setTimeout(() => {
                    setIsDealingCards(false);
                    // FORCE ROUTING AFTER ANIMATION (Since applyRemoteState might be waiting)
                    setView(v => v === "player_lobby" ? "player_game" : v);

                    const playingPlayers = newState.players.filter(p => !p.isHost);
                    const startingPlayer = playingPlayers[newState.turn_index];
                    if (startingPlayer) {
                      setShowWhoStartsModal({ 
                        name: startingPlayer.name, 
                        isMe: startingPlayer.name.toUpperCase() === myName.toUpperCase() 
                      });
                      // Auto-close modal after 3.5s
                      setTimeout(() => setShowWhoStartsModal(null), 3500);
                    }
                  }, 3000); // Animation duration
                }
                prevGameStatus.current = newState.status;

                // Smart auto-routing view states handled by applyRemoteState logic
                console.log("Routing logic checked via applyRemoteState");
                
                // Hand reconciliation handled by applyRemoteState
                console.log("Hand sync finished via applyRemoteState");
              }
            }
          }
        )
        .on(
          "broadcast",
          { event: "fire-taunt" },
          ({ payload }) => {
            console.log("🔥 [BROADCAST] FIRE RECEIVED for target:", payload.target, "by sender:", payload.sender);
            
            // Trigger overlay if target matches OR if it's from ME (self-broadcast test)
            if (payload.target.toUpperCase() === myName.toUpperCase() || payload.sender.toUpperCase() === myName.toUpperCase()) {
              console.log("🎯 [BROADCAST] Target/Sender match! Burning...");
              setFireTaunt({ active: true, sender: payload.sender, target: payload.target });
              setTimeout(() => setFireTaunt({ active: false, sender: null, target: null }), 2200);
            }

            // ALWAYS trigger hostFireTaunt if we are currently in host game view!
            setHostFireTaunt({ sender: payload.sender, target: payload.target });
            setTimeout(() => setHostFireTaunt(null), 2500);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channelRef.current = channel;
          }
        });

      return channel;
    } catch (err) {
      console.warn("💡 JALUR WEBSOCKET TERBLOKIR! Otomatis beralih ke HTTPS Polling Highway...");
      return null;
    }
  };

  const updateRemoteRoom = async (newGameState: RemoteGameState) => {
    await supabase
      .from("rooms")
      .update({ game_state: newGameState })
      .eq("room_code", roomCode.toUpperCase());
  };

  // 1. Host Action: Generate code & create table row in Supabase
  const handleCreateRoom = async () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let newCode = "";
    for (let i = 0; i < 4; i++) {
      newCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    setRoomCode(newCode);
    setIsHostRole(true);
    setPlayerName("Host");
    
    const initialState: RemoteGameState = {
      status: "waiting",
      deck: [],
      discard_pile: [],
      players: [{ name: "Host", hand: [], melds: [], isHost: true, hasDrawn: false, score: 0 }],
      turn_index: 0,
      card_back_color: cardBackColor,
      table_theme: tableTheme
    };

    const { error } = await supabase
      .from("rooms")
      .insert([{ room_code: newCode, game_state: initialState }]);
      
    if (!error) {
      setRemotePlayers(initialState.players);
      
      // Persist session tokens to guard against unexpected page refreshes!
      localStorage.setItem("rummy_room_code", newCode);
      localStorage.setItem("rummy_player_name", "Host");
      localStorage.setItem("rummy_is_host", "true");

      await subscribeToRoom(newCode, "Host");
      setView("host_lobby");
    } else {
      setToastMsg("Gagal Membuat Meja!");
      setTimeout(() => setToastMsg(null), 2000);
    }
  };

  // 2. Player Action: Verify code, append array, and subscribe
  const handleJoinRoom = async (inputCode: string, inputName: string) => {
    if (!inputCode || !inputName) {
      setToastMsg("Lengkapi Nama & Kode!");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const targetCode = inputCode.toUpperCase().trim();
    const targetName = inputName.trim();

    const { data, error } = await supabase
      .from("rooms")
      .select("game_state")
      .eq("room_code", targetCode)
      .maybeSingle();
      
    if (error || !data) {
      setToastMsg("Meja Tidak Ditemukan!");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const liveState = data.game_state as RemoteGameState;
    
    if (liveState.players.some(p => p.name.toUpperCase() === targetName.toUpperCase())) {
      setToastMsg("Nama Sudah Terpakai!");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const updatedPlayersList = [
      ...liveState.players,
      { name: targetName, hand: [], melds: [], isHost: false, hasDrawn: false, score: 0 }
    ];

    const nextState: RemoteGameState = {
      ...liveState,
      players: updatedPlayersList
    };

    const { error: putError } = await supabase
      .from("rooms")
      .update({ game_state: nextState })
      .eq("room_code", targetCode);
      
    if (!putError) {
      setRoomCode(targetCode);
      setPlayerName(targetName);
      setRemotePlayers(updatedPlayersList);
      
      // Persist session tokens to guard against unexpected page refreshes!
      localStorage.setItem("rummy_room_code", targetCode);
      localStorage.setItem("rummy_player_name", targetName);
      localStorage.setItem("rummy_is_host", "false");

      await subscribeToRoom(targetCode, targetName);
      setView("player_lobby");
    } else {
      setToastMsg("Gagal Bergabung!");
      setTimeout(() => setToastMsg(null), 2000);
    }
  };

  // 3. Host Action: Deal cards globally and update state to active playing
  const handleStartGame = async () => {
    const freshDeck = shuffleDeck(createDeck());
    
    // 1. Kumpulkan semua pemain non-host
    const nonHostPlayers = remotePlayers.filter(p => !p.isHost);
    if (nonHostPlayers.length === 0) {
      setToastMsg("Belum ada pemain bergabung!");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    // 2. Pilih 1 pemain secara acak sebagai starter untuk membuang kartu pertama
    const randomStarterIndex = Math.floor(Math.random() * nonHostPlayers.length);
    const starterPlayerName = nonHostPlayers[randomStarterIndex].name;

    // 3. Bagikan kartu: Pemain pertama (starter) mendapat 8 kartu, yang lain 7 kartu
    const updatedRemotePlayers = remotePlayers.map((p) => {
      if (p.isHost) return { ...p, hand: [], melds: [], hasDrawn: false };
      
      const isStarter = p.name.toUpperCase() === starterPlayerName.toUpperCase();
      return {
        ...p,
        hand: freshDeck.splice(0, isStarter ? 8 : 7),
        melds: [],
        // Penanda otomatis: starter sudah memegang 8 kartu, artinya ia langsung di fase BUANG
        hasDrawn: isStarter
      };
    });

    // 4. Temukan index pemain ini di dalam susunan non-host agar turn_index sinkron
    const playingOnlyPlayers = updatedRemotePlayers.filter(p => !p.isHost);
    const initialPlayingTurnIndex = playingOnlyPlayers.findIndex(
      p => p.name.toUpperCase() === starterPlayerName.toUpperCase()
    );

    const finalReadyState: RemoteGameState = {
      status: "playing",
      deck: freshDeck,
      discard_pile: [], // MEMULAI DARI KOSONG! Bukan dealer yang buang lagi!
      players: updatedRemotePlayers,
      turn_index: initialPlayingTurnIndex !== -1 ? initialPlayingTurnIndex : 0
    };

    // Write state update to Supabase - will auto sync via postgres channels!
    await updateRemoteRoom(finalReadyState);

    // Melompati jeda polling agar Host seketika masuk ke layar meja game!
    setRemotePlayers(finalReadyState.players);
    setGameStatus(finalReadyState.status);
    setActiveTurnIndex(finalReadyState.turn_index);
    setDeck(finalReadyState.deck);
    setDiscardPile(finalReadyState.discard_pile);

    // TRIGGER DEALING ANIMATION FOR HOST TOO!
    setIsDealingCards(true);
    setTimeout(() => {
      setIsDealingCards(false);
      setView("host_game");
      
      const playingPlayers = finalReadyState.players.filter(p => !p.isHost);
      const startingPlayer = playingPlayers[finalReadyState.turn_index];
      if (startingPlayer) {
        setShowWhoStartsModal({ 
          name: startingPlayer.name, 
          isMe: startingPlayer.name.toUpperCase() === playerName.toUpperCase() 
        });
        setTimeout(() => setShowWhoStartsModal(null), 3500);
      }
    }, 3000);
  };

  // 3.4 Host Action: Trigger Global End Game (Calculates points and shows modal for everyone)
  const handleTriggerGlobalEndGame = async (updatedPlayers: RemotePlayer[]) => {
    if (!roomCode) return;
    
    // Hitung poin sebelum mengirim status "finished"
    const activePlayers = updatedPlayers.filter(p => !p.isHost);
    const rawStandings = activePlayers.map((player) => {
      const isWinner = player.hand.length === 0;
      let roundPoints = (player.melds || []).reduce((sum, group) => sum + getMeldPoints(group), 0);
      
      if (isWinner) {
        const topCard = discardPile.length > 0 ? discardPile[0] : null;
        const isTutupWin = topCard && topCard.thrownBy === player.name;
        const closingBonus = isTutupWin ? getCardPoints(topCard as Card) * 10 : 0;
        roundPoints += closingBonus;
      }

      const prevScore = player.score || 0;
      const totalScore = prevScore + roundPoints;
      return { name: player.name, totalScore };
    });

    const finalPlayers = updatedPlayers.map((p) => {
      if (p.isHost) return p;
      const match = rawStandings.find((s) => s.name === p.name);
      return {
        ...p,
        score: match ? match.totalScore : p.score,
      };
    });
    
    const updatedState: RemoteGameState = {
      status: "finished",
      deck,
      discard_pile: discardPile,
      players: finalPlayers,
      turn_index: activeTurnIndex
    };

    await updateRemoteRoom(updatedState);
  };

  // 3.5 Host Action: End current game round, commit final scores and send players back to lobby
  const handleFinishGame = async (updatedPlayers: RemotePlayer[]) => {
    if (!roomCode) return;

    const { data, error } = await supabase
      .from("rooms")
      .select("game_state")
      .eq("room_code", roomCode.toUpperCase())
      .maybeSingle();

    if (!error && data) {
      const activeState = data.game_state as RemoteGameState;
      
      const updatedState: RemoteGameState = {
        ...activeState,
        status: "waiting", // Reset state back to lobby!
        deck: [],
        discard_pile: [],
        players: updatedPlayers.map((p) => ({
          ...p,
          hand: [],
          melds: [],
          hasDrawn: false,
          // Cumulative score is updated and preserved!
        })),
        turn_index: 0
      };

      await updateRemoteRoom(updatedState);

      // Optimistic Sync for rapid host responsiveness
      setRemotePlayers(updatedState.players);
      setGameStatus(updatedState.status);
      setDeck([]);
      setDiscardPile([]);
      setView("host_lobby");
    }
  };

  // Initialize and Start Game
  const initGame = () => {
    const rawDeck = createDeck();
    const shuffled = shuffleDeck(rawDeck);
    const dealtHand = shuffled.splice(0, 7);
    const initialDiscard = shuffled.splice(0, 3).map(c => ({ ...c, thrownBy: "Dealer" }));
    
    setDeck(shuffled);
    setPlayerHand(dealtHand);
    setDiscardPile(initialDiscard);
    setHasDrawnThisTurn(false);
    setSelectedDiscardIndex(null);


  };

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    const docEl = document.documentElement as any;
    const doc = document as any;

    // Deteksi status fullscreen native di lintas browser/platform
    const isNativeFullscreen = !!(
      doc.fullscreenElement || 
      doc.webkitFullscreenElement || 
      doc.mozFullScreenElement || 
      doc.msFullscreenElement
    );

    if (!isNativeFullscreen) {
      try {
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen().catch(() => {});
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          docEl.msRequestFullscreen();
        } else {
          // FALLBACK KHUSUS SAFARI IPHONE 📱💡
          // iOS Safari di iPhone memblokir fullscreen API pada elemen HTML biasa.
          // Kita tampilkan panduan ramah agar pengguna memanfaatkan fitur rotasi Safari!
          setToastMsg("Rotasi ke Landscape (Miring) untuk Layar Penuh di iPhone! 📱🔄");
          setTimeout(() => setToastMsg(null), 4000);
        }
      } catch (err: any) {
        console.warn("Fullscreen polyfill error:", err?.message);
      }
    } else {
      try {
        if (doc.exitFullscreen) {
          doc.exitFullscreen().catch(() => {});
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          doc.msExitFullscreen();
        }
      } catch (err: any) {
        console.warn("Exit fullscreen polyfill error:", err?.message);
      }
    }
  };

  // --- HYDRATED RESILIENT SESSION RESTORER ---
  const restoreSessionFromLocalStorage = async () => {
    if (typeof window === "undefined") return;
    
    const savedRoom = localStorage.getItem("rummy_room_code");
    const savedName = localStorage.getItem("rummy_player_name");
    const savedRoleIsHost = localStorage.getItem("rummy_is_host") === "true";

    if (!savedRoom || !savedName) return;

    console.log("♻️ [SESSION RESTORE] Checking persistence tokens:", savedRoom, "for", savedName);
    
    // Double-check the Supabase engine to ensure room STILL exists!
    const { data, error } = await supabase
      .from("rooms")
      .select("game_state")
      .eq("room_code", savedRoom.toUpperCase())
      .maybeSingle();

    if (error || !data) {
      console.warn("⚠️ [RESTORE ABORT]: Dead session tokens detected. Pruning localStorage.");
      localStorage.removeItem("rummy_room_code");
      localStorage.removeItem("rummy_player_name");
      localStorage.removeItem("rummy_is_host");
      return;
    }

    const liveState = data.game_state as RemoteGameState;
    
    // Hydrate essential operational states
    setRoomCode(savedRoom.toUpperCase());
    setPlayerName(savedName);
    setIsHostRole(savedRoleIsHost);
    
    // Hydrate baseline arrays immediately to prevent visual flashing
    setRemotePlayers(liveState.players);
    setGameStatus(liveState.status);
    setDeck(liveState.deck);
    setDiscardPile(liveState.discard_pile);
    setChatMessages(liveState.chat_messages || []);
    setActiveTurnIndex(liveState.turn_index);

    // For players, pre-hydrate initial hand
    const serverMe = liveState.players.find(p => p.name.toUpperCase() === savedName.toUpperCase());
    if (serverMe) {
      setPlayerHand(serverMe.hand);
      setHasDrawnThisTurn(serverMe.hasDrawn);
    }

    // Step 4: Set appropriate Routing View 
    if (liveState.status === "playing") {
      setView(savedRoleIsHost ? "host_game" : "player_game");
    } else {
      setView(savedRoleIsHost ? "host_lobby" : "player_lobby");
    }

    // Step 5: Re-subscribe dynamic real-time websocket stream
    await subscribeToRoom(savedRoom.toUpperCase(), savedName);
    
    setToastMsg("Kembali terhubung ke meja permainan! ⚡🏆");
    setTimeout(() => setToastMsg(null), 3000);
  };

  // --- MANUALLY TRIGGERED CLEAN EXIT & REMOTE DE-REGISTRATION ---
  const handleExitGame = async (nextView: ViewState = "landing") => {
    console.log("🧹 [CLEAN EXIT]: Clearing persistence tokens and updating remote registry.");
    
    const leavingPlayer = playerName;
    const currentRoom = roomCode;

    // 1. Clean Local persistence caches
    localStorage.removeItem("rummy_room_code");
    localStorage.removeItem("rummy_player_name");
    localStorage.removeItem("rummy_is_host");
    
    try {
      supabase.removeAllChannels();
    } catch (err) {
      console.warn("WS channel cleanup bypass:", err);
    }

    // 2. Optimistic Local state wipe & redirection!
    setView(nextView);

    // 3. DB Atomic Eviction Trigger (Only when non-host exits to landing!)
    if (currentRoom && leavingPlayer && nextView === "landing") {
      try {
        const { data, error } = await supabase
          .from("rooms")
          .select("game_state")
          .eq("room_code", currentRoom.toUpperCase())
          .maybeSingle();

        if (!error && data) {
          const currentState = data.game_state as RemoteGameState;
          if (currentState && Array.isArray(currentState.players)) {
            // Construct the next player pool by filtering out leaving user
            const nextPlayers = currentState.players.filter(
              (p) => p.name.toUpperCase() !== leavingPlayer.toUpperCase()
            );

            const updatedState: RemoteGameState = {
              ...currentState,
              players: nextPlayers
            };

            await supabase
              .from("rooms")
              .update({ game_state: updatedState })
              .eq("room_code", currentRoom.toUpperCase());

            console.log(`📤 [DB EVACUATED] Ejected player '${leavingPlayer}' successfully.`);
          }
        }
      } catch (err) {
        console.error("Player atomic eject error:", err);
      }
    }
  };


  useEffect(() => {
    initGame();
    
    // Attempt to restore session if active persistent tokens exist in cache!
    restoreSessionFromLocalStorage();
    
    // Deep link QR auto join detection
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get("room");
      if (urlRoom && urlRoom.length === 4) {
        setRoomCode(urlRoom.toUpperCase());
        setToastMsg("Kode Terdeteksi! Silakan Isi Nama ✍️");
        setTimeout(() => setToastMsg(null), 3000);
      }

      // Track native browser fullscreen events across all rendering engines
      const handleFs = () => {
        const doc = document as any;
        setIsFullscreen(!!(
          doc.fullscreenElement || 
          doc.webkitFullscreenElement || 
          doc.mozFullScreenElement || 
          doc.msFullscreenElement
        ));
      };
      
      document.addEventListener("fullscreenchange", handleFs);
      document.addEventListener("webkitfullscreenchange", handleFs); // Webkit (Safari, iOS Chrome)
      document.addEventListener("mozfullscreenchange", handleFs);    // Firefox
      document.addEventListener("MSFullscreenChange", handleFs);     // IE/Edge
      
      return () => {
        document.removeEventListener("fullscreenchange", handleFs);
        document.removeEventListener("webkitfullscreenchange", handleFs);
        document.removeEventListener("mozfullscreenchange", handleFs);
        document.removeEventListener("MSFullscreenChange", handleFs);
      };
    }
  }, []);

  // ==========================================
  // RESILIENT FALLBACK POLLING ENGINE
  // ==========================================
  // Bertindak sebagai jembatan data cadangan yang tangguh jika koneksi WebSocket
  // terblokir oleh pemeliharaan infrastruktur Supabase (Singapore) malam ini!
  useEffect(() => {
    if (!roomCode || !playerName) return;

    const fallbackPoll = setInterval(async () => {
      // Hanya lakukan polling jika kita sedang aktif di dalam room/game
      if (view !== "landing") {
        console.log(`🔍 [POLLER] Mengecek data untuk Room: ${roomCode.toUpperCase()}...`);
        
        const { data, error } = await supabase
          .from("rooms")
          .select("game_state")
          .eq("room_code", roomCode.toUpperCase())
          .maybeSingle();

        if (error) {
          console.error("❌ [POLLER ERROR]:", error.message);
          return;
        }

        if (data && data.game_state) {
          const serverState = data.game_state as RemoteGameState;
          console.log(`✅ [POLLER SUCCESS] Menemukan data! Jumlah Pemain di Server: ${serverState.players.length}`);
          
          // Sinkronisasi paksa data state server ke state lokal secara periodik
          applyRemoteState(serverState, playerName);
        } else {
          console.warn("⚠️ [POLLER]: Data tidak ditemukan di server untuk room ini.");
        }
      }
    }, 2500); // Cek setiap 2.5 detik sekali

    return () => clearInterval(fallbackPoll);
  }, [roomCode, view, playerName]);

  // Action Handlers (Multiplayer Synced)
  const drawFromStock = async (): Promise<Card | null> => {
    if (hasDrawnThisTurn) return null;
    if (deck.length === 0) return null;
    
    // Validate active turn
    const playingPlayers = remotePlayers.filter(p => !p.isHost);
    const myIdx = playingPlayers.findIndex(p => p.name.toUpperCase() === playerName.toUpperCase());
    
    if (myIdx !== activeTurnIndex) {
      audio.playError();
      setToastMsg("Tunggu! Bukan Giliran Anda ⏰");
      setTimeout(() => setToastMsg(null), 2000);
      return null;
    }

    const updatedDeck = [...deck];
    const drawnCard = updatedDeck.shift()!;
    const updatedHand = [...playerHand, drawnCard];

    const nextPlayers = remotePlayers.map((p) => {
      if (p.name.toUpperCase() === playerName.toUpperCase()) {
        return { ...p, hand: updatedHand, hasDrawn: true };
      }
      return p;
    });

    let finalStatus: RemoteGameState["status"] = "playing";
    let finalPlayers = nextPlayers;

    // DETEKSI KONDISI DECK HABIS SAAT MENGAMBIL KARTU
    if (updatedDeck.length === 0) {
      finalStatus = "finished";
      
      const rawStandings = playingPlayers.map((player) => {
        const roundPoints = (player.melds || []).reduce((sum, group) => sum + getMeldPoints(group), 0);
        const prevScore = player.score || 0;
        const totalScore = prevScore + roundPoints;
        return { name: player.name, totalScore };
      });

      finalPlayers = remotePlayers.map((p) => {
        if (p.isHost) return p;
        const match = rawStandings.find((s) => s.name === p.name);
        return {
          ...p,
          hand: p.name.toUpperCase() === playerName.toUpperCase() ? updatedHand : p.hand,
          score: match ? match.totalScore : p.score,
          hasDrawn: false
        };
      });
    }

    const updatedState: RemoteGameState = {
      status: finalStatus,
      deck: updatedDeck,
      discard_pile: discardPile,
      players: finalPlayers,
      turn_index: activeTurnIndex
    };

    await updateRemoteRoom(updatedState);
    
    // OPTIMISTIC LOCAL UPDATE:
    // Memberikan sensasi mengambil kartu instan tanpa jeda jaringan!
    setDeck(updatedDeck);
    setPlayerHand(updatedHand);
    setHasDrawnThisTurn(true);
    setRemotePlayers(finalPlayers);
    
    audio.playCardDraw();
    setSelectedDiscardIndex(null);
    return drawnCard;
  };

  const drawFromDiscardAtIndex = async (index: number) => {
    if (hasDrawnThisTurn) return;
    if (index >= discardPile.length || index >= 7) return;
    
    // Validate turn
    const playingPlayers = remotePlayers.filter(p => !p.isHost);
    const myIdx = playingPlayers.findIndex(p => p.name.toUpperCase() === playerName.toUpperCase());
    
    if (myIdx !== activeTurnIndex) {
      audio.playError();
      setToastMsg("Tunggu! Bukan Giliran Anda ⏰");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const nextDiscard = [...discardPile];
    // Rule: Cannot take more than 7 cards from discard pile
    const countToTake = index + 1;
    if (countToTake > 7) {
      audio.playError();
      setToastMsg("Maksimal ambil 7 kartu dari buangan! 🚫");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const takenCards = nextDiscard.splice(0, countToTake);
    const updatedHand = [...playerHand, ...takenCards];

    const nextPlayers = remotePlayers.map((p) => {
      if (p.name.toUpperCase() === playerName.toUpperCase()) {
        return { ...p, hand: updatedHand, hasDrawn: true };
      }
      return p;
    });

    const updatedState: RemoteGameState = {
      status: "playing",
      deck: deck,
      discard_pile: nextDiscard,
      players: nextPlayers,
      turn_index: activeTurnIndex
    };

    await updateRemoteRoom(updatedState);
    
    // OPTIMISTIC LOCAL UPDATE
    setDiscardPile(nextDiscard);
    setPlayerHand(updatedHand);
    setHasDrawnThisTurn(true);
    setRemotePlayers(nextPlayers);
    
    audio.playCardDraw();
    setSelectedDiscardIndex(null);
  };

  const discardSelected = async (cardId: string) => {
    if (!cardId) return;
    // Izinkan TUTUP kartu kapanpun jika sisa 1 kartu (bisa menang meski belum ambil kartu)
    if (!hasDrawnThisTurn && playerHand.length > 1) {
      audio.playError();
      setToastMsg("Ambil kartu dulu sebelum membuang! 🃏");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const targetCard = playerHand.find(c => c.id === cardId);
    if (!targetCard) return;

    // Rule: Joker (JKR) strictly cannot be discarded unless it's the last card used to close!
    if (targetCard.value === "JKR" || targetCard.suit === "joker") {
      if (playerHand.length > 1) {
        setToastMsg("❌ KARTU JOKER TIDAK BOLEH DIBUANG KECUALI UNTUK MENUTUP!");
        setTimeout(() => setToastMsg(null), 2500);
        return;
      }
    }

    const cardWithAttribution = { ...targetCard, thrownBy: playerName || "Pemain" };
    const updatedHand = playerHand.filter(c => c.id !== cardId);
    const updatedDiscard = [cardWithAttribution, ...discardPile];

    // Cycle to the next active player's turn index (skipping spectator Host)
    const playingPlayers = remotePlayers.filter(p => !p.isHost);
    const nextTurnIdx = (activeTurnIndex + 1) % (playingPlayers.length || 1);

    const nextPlayers = remotePlayers.map((p) => {
      if (p.name.toUpperCase() === playerName.toUpperCase()) {
        return { ...p, hand: updatedHand, hasDrawn: false };
      }
      return p;
    });

    let finalStatus: RemoteGameState["status"] = "playing";
    let finalPlayers = nextPlayers;

    // DETEKSI KONDISI MENANG (KARTU HABIS) ATAU DECK HABIS
    if (updatedHand.length === 0 || deck.length === 0) {
      finalStatus = "showdown";
      
      finalPlayers = remotePlayers.map((p) => {
        if (p.name.toUpperCase() === playerName.toUpperCase()) {
          return { ...p, hand: updatedHand, hasDrawn: false, isDoneShowdown: true };
        }
        return { ...p, isDoneShowdown: p.isHost }; // Host is always done
      });
    }

    const updatedState: RemoteGameState = {
      status: finalStatus,
      deck: deck,
      discard_pile: updatedDiscard,
      players: finalPlayers,
      turn_index: nextTurnIdx
    };

    await updateRemoteRoom(updatedState);
    
    // OPTIMISTIC LOCAL UPDATE:
    setPlayerHand(updatedHand);
    setDiscardPile(updatedDiscard);
    setRemotePlayers(finalPlayers);
    setActiveTurnIndex(nextTurnIdx);
    setHasDrawnThisTurn(false);
    setGameStatus(finalStatus);
    
    audio.playCardDrop();

    if (finalStatus === "showdown") {
      setToastMsg("🏆 TUTUP KARTU! BABAK TURUN KARTU DIMULAI.");
    }
    setTimeout(() => setToastMsg(null), 2500);
  };

  const meldSelectedCards = async (cardIds: string[]): Promise<boolean> => {
    if (cardIds.length < 3) {
      audio.playError();
      setToastMsg("Kombinasi minimal 3 kartu! 🚫");
      setTimeout(() => setToastMsg(null), 2000);
      return false;
    }
    
    const selectedCards = playerHand.filter(c => cardIds.includes(c.id));
    const isValidCombination = isSet(selectedCards) || isRun(selectedCards);
    
    if (!isValidCombination) {
      audio.playError();
      setToastMsg("Kombinasi kartu tidak sah! ⚠️");
      setTimeout(() => setToastMsg(null), 2500);
      return false;
    }

    // Aturan Indonesia Remi: Harus ada Seri di meja (melds) sebelum boleh menurunkan Set (Kembar)!
    const myRemote = remotePlayers.find(p => p.name.toUpperCase() === playerName.toUpperCase());
    const myExistingMelds = myRemote?.melds || [];
    const hasAnyExistingRunInMelds = myExistingMelds.some(m => isRun(m));
    const attemptIsRun = isRun(selectedCards);

    if (!hasAnyExistingRunInMelds && !attemptIsRun) {
      setToastMsg("Wajib menurunkan SERI/URUTAN pertama kali! 🇮🇩");
      setTimeout(() => setToastMsg(null), 3000);
      return false;
    }

    const updatedHand = playerHand.filter(c => !cardIds.includes(c.id));
    const updatedMelds = [...myExistingMelds, selectedCards];

    const nextPlayers = remotePlayers.map((p) => {
      if (p.name.toUpperCase() === playerName.toUpperCase()) {
        return { ...p, hand: updatedHand, melds: updatedMelds };
      }
      return p;
    });

    let finalStatus: RemoteGameState["status"] = "playing";
    let finalPlayers = nextPlayers;

    // JIKA KARTU HABIS SETELAH TURUN (MELD): PEMAIN MENANG!
    if (updatedHand.length === 0) {
      finalStatus = "showdown";
      finalPlayers = nextPlayers.map((p) => {
        if (p.name.toUpperCase() === playerName.toUpperCase()) {
          return { ...p, hand: updatedHand, isDoneShowdown: true };
        }
        return { ...p, isDoneShowdown: p.isHost };
      });
    }

    const updatedState: RemoteGameState = {
      status: finalStatus,
      deck: deck,
      discard_pile: discardPile,
      players: finalPlayers,
      turn_index: activeTurnIndex
    };

    await updateRemoteRoom(updatedState);

    // Optimistic Local Update
    setPlayerHand(updatedHand);
    setRemotePlayers(finalPlayers);
    setGameStatus(finalStatus);
    
    audio.playCardDrop();

    if (finalStatus === "showdown") {
      setToastMsg("🏆 KARTU HABIS! BABAK TURUN KARTU DIMULAI.");
    } else {
      setToastMsg("🎉 Sukses Menurunkan Kartu!");
    }
    setTimeout(() => setToastMsg(null), 2500);
    
    return true;
  };

  // ==========================================
  // LOBBY INTERACTION ENGINE
  // ==========================================
  const sendLobbyEmoji = async (emoji: string) => {
    const { data, error } = await supabase
      .from("rooms")
      .select("game_state")
      .eq("room_code", roomCode.toUpperCase())
      .maybeSingle();

    if (!error && data && data.game_state) {
      const activeState = data.game_state as RemoteGameState;
      
      const updatedState: RemoteGameState = {
        ...activeState,
        taunt: {
          sender: playerName,
          emoji: emoji,
          timestamp: Date.now()
        }
      };

      await updateRemoteRoom(updatedState);

      // Local Optimistic Trigger: Tampilkan emoji instan di layar sendiri!
      setActiveTauntOverlay({ sender: playerName, emoji });
      setTimeout(() => setActiveTauntOverlay(null), 2500);
    }
  };

  // --- CHAT & PHOTO REALTIME TRANSMITTER ---
  const sendChatMessage = async (text?: string, photoBase64?: string, recipient?: string) => {
    if (!roomCode || !playerName) return;
    if (!text && !photoBase64) return;

    const { data, error } = await supabase
      .from("rooms")
      .select("game_state")
      .eq("room_code", roomCode.toUpperCase())
      .maybeSingle();

    if (!error && data) {
      const activeState = data.game_state as RemoteGameState;
      const currentHistory = activeState.chat_messages || [];
      
      const newMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        sender: playerName,
        recipient: recipient || "All",
        text: text?.trim(),
        photoBase64: photoBase64,
        timestamp: Date.now()
      };

      // Circular Buffer: Jaga payload tetap ringan, simpan hanya 15 pesan terakhir
      const updatedHistory = [...currentHistory, newMessage].slice(-15);

      const updatedState: RemoteGameState = {
        ...activeState,
        chat_messages: updatedHistory
      };

      await updateRemoteRoom(updatedState);
      
      // Local Optimistic Sync
      setChatMessages(updatedHistory);
    }
  };

  const sendReaction = async (emoji: string) => {
    if (!roomCode) return;
    const { data: currentRoom } = await supabase.from("rooms").select("state").eq("code", roomCode.toUpperCase()).single();
    if (currentRoom) {
      const state = currentRoom.state as RemoteGameState;
      const now = Date.now();
      const newReaction = {
        id: `${playerName}_${now}_${Math.random().toString(36).substr(2, 5)}`,
        sender: playerName,
        emoji,
        timestamp: now
      };
      
      // Keep only recent reactions (last 10) to avoid state bloat
      const updatedReactions = [newReaction, ...(state.reactions || [])].slice(0, 10);
      
      const nextState = { ...state, reactions: updatedReactions };
      await supabase.from("rooms").update({ state: nextState }).eq("code", roomCode.toUpperCase());
    }
  };

  const handleUpdateVoiceTaunt = async (base64: string) => {
    setVoiceTaunt(base64);
    if (!roomCode) return;

    const { data } = await supabase.from("rooms").select("state").eq("code", roomCode.toUpperCase()).single();
    if (data?.state) {
      const newState = { ...data.state };
      const myIdx = newState.players.findIndex((p: any) => p.name.toUpperCase() === playerName.toUpperCase());
      if (myIdx !== -1) {
        newState.players[myIdx].voice_taunt = base64;
        await supabase.from("rooms").update({ state: newState }).eq("code", roomCode.toUpperCase());
      }
    }
  };

  const sendVoiceTaunt = async () => {
    if (!roomCode || !voiceTaunt) return;

    const { data } = await supabase.from("rooms").select("state").eq("code", roomCode.toUpperCase()).single();
    if (data?.state) {
      const newState = { ...data.state };
      const myIdx = newState.players.findIndex((p: any) => p.name.toUpperCase() === playerName.toUpperCase());
      if (myIdx !== -1) {
        newState.players[myIdx].last_voice_taunt_at = Date.now();
        // Also ensure voice_taunt is attached in case it was lost
        newState.players[myIdx].voice_taunt = voiceTaunt;
        
        console.log(`📡 [SEND TAUNT] Updating state for ${playerName}`);
        const { error } = await supabase.from("rooms").update({ state: newState }).eq("code", roomCode.toUpperCase());
        if (error) console.error("❌ [TAUNT ERROR]:", error);
      }
    }
  };

  const finishShowdown = async () => {
    if (gameStatus !== "showdown") return;

    const nextPlayers = remotePlayers.map(p => {
      if (p.name.toUpperCase() === playerName.toUpperCase()) {
        return { ...p, isDoneShowdown: true };
      }
      return p;
    });

    const allPlayingPlayers = nextPlayers.filter(p => !p.isHost);
    const everyoneDone = allPlayingPlayers.every(p => p.isDoneShowdown);

    let finalStatus: RemoteGameState["status"] = "showdown";
    let finalPlayers = nextPlayers;

    if (everyoneDone) {
      finalStatus = "finished";
      
      const rawStandings = allPlayingPlayers.map((player) => {
        const isWinner = player.hand.length === 0;
        let roundPoints = (player.melds || []).reduce((sum, group) => sum + getMeldPoints(group), 0);
        
        if (isWinner) {
          const topCard = discardPile.length > 0 ? discardPile[0] : null;
          const isTutupWin = topCard && topCard.thrownBy === player.name;
          const closingBonus = isTutupWin ? getCardPoints(topCard as Card) * 10 : 0;
          roundPoints += closingBonus;
        }

        const prevScore = player.score || 0;
        const totalScore = prevScore + roundPoints;
        return { name: player.name, totalScore };
      });

      finalPlayers = nextPlayers.map((p) => {
        if (p.isHost) return p;
        const match = rawStandings.find((s) => s.name === p.name);
        return {
          ...p,
          score: match ? match.totalScore : p.score,
        };
      });
    }

    const updatedState: RemoteGameState = {
      status: finalStatus,
      deck: deck,
      discard_pile: discardPile,
      players: finalPlayers,
      turn_index: activeTurnIndex
    };

    await updateRemoteRoom(updatedState);
    setRemotePlayers(finalPlayers);
    setGameStatus(finalStatus);
    
    if (finalStatus === "finished") {
      setToastMsg("🏆 SEMUA SELESAI! SKOR DIHITUNG.");
    } else {
      setToastMsg("✅ Anda Siap! Menunggu pemain lain...");
    }
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Funny Interactive Taunt with REAL-TIME BROADCAST Sync
  const sendFireTaunt = async (targetName: string) => {
    console.log(`🚀 [TAUNT] Attempting to burn ${targetName}...`);
    setToastMsg(`Membakar layar ${targetName}... 🔥`);
    setTimeout(() => setToastMsg(null), 1500);

    const payload = {
      target: targetName,
      sender: playerName || "Pemain"
    };

    if (channelRef.current) {
      console.log("📡 [TAUNT] Sending broadcast via existing channel...");
      channelRef.current.send({
        type: "broadcast",
        event: "fire-taunt",
        payload
      });
    } else {
      console.warn("⚠️ [TAUNT] Channel not ready! Attempting emergency sync...");
      // Re-subscribe if channel is lost
      const chan = await subscribeToRoom(roomCode, playerName || "Guest");
      if (chan) {
        setTimeout(() => {
          chan.send({
            type: "broadcast",
            event: "fire-taunt",
            payload
          });
        }, 500);
      }
    }
  };

  const syncHandSort = async (newSortedHand: Card[]) => {
    // Update lokal instan (Optimistik)
    setPlayerHand(newSortedHand);
    
    const nextPlayers = remotePlayers.map((p) => {
      if (p.name.toUpperCase() === playerName.toUpperCase()) {
        return { ...p, hand: newSortedHand };
      }
      return p;
    });

    const updatedState: RemoteGameState = {
      status: gameStatus,
      deck: deck,
      discard_pile: discardPile,
      players: nextPlayers,
      turn_index: activeTurnIndex
    };

    // Kirim ke database Supabase
    updateRemoteRoom(updatedState).catch((e) => console.error("⚠️ [SORT SYNC ERROR]:", e.message));
    
    setRemotePlayers(nextPlayers);
  };

  const sortMyHand = () => {
    const sorted = sortHand(playerHand);
    syncHandSort(sorted);
  };

  // Derived Turn Tracking Variables
  const activePlayingPlayers = remotePlayers.filter(p => !p.isHost);
  const currentMyIdx = activePlayingPlayers.findIndex(p => p.name.toUpperCase() === playerName.toUpperCase());
  const isMyTurn = (gameStatus === "showdown") ? true : (currentMyIdx === activeTurnIndex);
  
  // --- AUTO-TURN NOTIFICATION MODAL ---
  useEffect(() => {
    // Only show if it's currently MY turn and it's a NEW turn cycle for me
    // (And specifically only in 'playing' status, showdown handles itself)
    if (gameStatus === "playing" && isMyTurn) {
      if (activeTurnIndex !== lastTurnNotifyRef.current) {
        setShowMyTurnModal(true);
        lastTurnNotifyRef.current = activeTurnIndex;
      }
    } else {
      setShowMyTurnModal(false);
      // Reset tracker when it's NOT my turn, so it triggers again next time
      // This is critical for 2-player games where activeTurnIndex might be the same.
      if (!isMyTurn) {
        lastTurnNotifyRef.current = -1;
      }
    }
  }, [isMyTurn, activeTurnIndex, gameStatus]);

  const activePlayerName = activePlayingPlayers[activeTurnIndex]?.name || "...";

  const circularDiscards = discardPile;
  
  const selectedDiscardCard = selectedDiscardIndex !== null ? circularDiscards[selectedDiscardIndex] : null;
  const myExistingMelds = remotePlayers.find((p) => p.name.toUpperCase() === playerName.toUpperCase())?.melds || [];
  const isDiscardSelectionValid = selectedDiscardCard ? canDrawDiscardCard(selectedDiscardCard, playerHand, myExistingMelds) : false;
  


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
    <main className="min-h-[100dvh] h-[100dvh] text-zinc-200 relative flex flex-col items-center justify-center p-4 overflow-hidden bg-[#041611] select-none">
      
      {/* ========================================= */}
      {/* GLOBAL REAL-TIME LOBBY TAUNT OVERLAY      */}
      {/* ========================================= */}
      {activeTauntOverlay && (
        <div className="fixed inset-0 z-[99999] pointer-events-none flex items-center justify-center overflow-hidden select-none bg-[#041611]/10">
          <div className="flex flex-col items-center justify-center animate-bounce duration-500">
            {/* Giant Glowing Emoticon */}
            <div className="text-[140px] sm:text-[180px] filter drop-shadow-[0_0_60px_rgba(16,185,129,0.4)] transition-all scale-110 select-none animate-pulse">
              {activeTauntOverlay.emoji}
            </div>
            {/* Glowy Label Tag */}
            <div className="mt-6 bg-[#09251d]/95 border border-emerald-700/50 shadow-[0_0_20px_rgba(6,78,59,0.4)] backdrop-blur-md px-5 py-2 rounded-full animate-fade-in">
              <span className="text-[11px] font-mono tracking-[0.2em] text-emerald-400 uppercase font-semibold">
                Reaksi {activeTauntOverlay.sender}: <b className="text-zinc-100 font-extrabold">SIAP TEMPUR!</b> 🎮
              </span>
            </div>
          </div>
          {/* Screen Flash effect */}
          <div className="absolute inset-0 bg-emerald-500/5 animate-pulse mix-blend-overlay" />
        </div>
      )}
      
      {/* Ambient Background */}
      <div className="absolute inset-0 pointer-events-none bg-radial from-[#08251d] to-[#041410] opacity-80" />



      {/* ========================================================== */}
      {/* GLOBAL ACTION CONTROLS SUITE (INTELLIGENT RESPONSIVE MENU) */}
      {/* ========================================================== */}

      {/* 1. DESKTOP & TABLET BAR (Always visible on large screens) */}
      <div className="hidden sm:flex fixed top-4 right-4 z-[9999] items-center gap-2">
        {/* Global Exit Button (Visible ONLY in Player view) */}
        {view === "player_game" && (
          <button 
            onClick={() => setShowExitConfirm(true)}
            className="p-2 rounded-lg border border-red-950 bg-red-950/25 hover:bg-red-900/40 backdrop-blur-md border-red-900/40 text-red-400 hover:text-red-300 cursor-pointer transition-all flex items-center justify-center group shadow-[0_0_10px_rgba(220,38,38,0.1)] active:scale-95 mr-1"
            title="Keluar Game"
          >
            <svg className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        )}

        {/* Global Leaderboard Action Button (👑 Crown) */}
        <button 
          onClick={() => setShowLeaderboard(true)}
          className="p-2 rounded-lg border border-zinc-800/60 bg-[#041611]/40 hover:bg-[#062118]/60 backdrop-blur-md hover:border-emerald-800/40 text-zinc-500 hover:text-emerald-400 cursor-pointer transition-all flex items-center justify-center group"
          title="Klasemen Poin"
        >
          <span className="text-xs leading-none transition-transform group-hover:scale-110">👑</span>
        </button>

        {/* Global Minimalist Rules Modal Button */}
        <button 
          onClick={() => setShowRules(true)}
          className="p-2 rounded-lg border border-zinc-800/60 bg-[#041611]/40 hover:bg-zinc-900/60 backdrop-blur-md text-zinc-500 hover:text-zinc-300 cursor-pointer transition-all flex items-center justify-center group"
          title="Aturan Game"
        >
          <svg className="w-3.5 h-3.5 transition-all group-hover:text-amber-400 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-7 7c0 2.3 1 4.4 2.6 5.9C8.5 15.8 9 16.9 9 18h6c0-1.1.5-2.2 1.4-3.1A7 7 0 0 0 12 2z" />
          </svg>
        </button>

        {/* Global Minimalist Fullscreen Toggle Button */}
        <button 
          onClick={toggleFullscreen}
          className="p-2 rounded-lg border border-zinc-800/60 bg-[#041611]/40 hover:bg-zinc-900/60 backdrop-blur-md text-zinc-500 hover:text-zinc-300 cursor-pointer transition-all flex items-center justify-center group"
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
      </div>

      {/* 2. MOBILE COMPACT DROPDOWN (Visible exclusively on small screens) */}
      <div className="block sm:hidden fixed top-4 right-4 z-[9999]">
        {/* Dropdown Trigger (⋮ Vertical Dots) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowGlobalMenu(!showGlobalMenu);
          }}
          className={`p-2 rounded-lg border transition-all backdrop-blur-md flex items-center justify-center shadow-lg cursor-pointer active:scale-90 ${
            showGlobalMenu
              ? "bg-[#06251c] border-emerald-700 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
              : "bg-[#041611]/60 border-zinc-800/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <svg className={`w-4 h-4 transition-transform duration-300 ${showGlobalMenu ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>

        {/* Dropdown Panel */}
        {showGlobalMenu && (
          <>
            {/* Transparent click-outside overlay to close menu */}
            <div className="fixed inset-0 z-[-1]" onClick={() => setShowGlobalMenu(false)} />
            
            <div 
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 mt-2 w-36 bg-[#041713]/95 border border-emerald-950/80 backdrop-blur-md p-1 rounded-xl shadow-[0_15px_35px_rgba(0,0,0,0.85)] flex flex-col gap-0.5 animate-scale-up origin-top-right border-t-emerald-800/30"
            >
              {/* Leaderboard Item */}
              <button
                onClick={() => {
                  setShowLeaderboard(true);
                  setShowGlobalMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-emerald-950/30 text-left transition-colors text-zinc-400 hover:text-zinc-200 group"
              >
                <span className="text-xs group-hover:scale-110 transition-transform">👑</span>
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider">Klasemen</span>
              </button>

              {/* Rules Item */}
              <button
                onClick={() => {
                  setShowRules(true);
                  setShowGlobalMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-emerald-950/30 text-left transition-colors text-zinc-400 hover:text-zinc-200 group"
              >
                <svg className="w-3.5 h-3.5 text-zinc-500 group-hover:text-amber-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                  <path d="M12 2a7 7 0 0 0-7 7c0 2.3 1 4.4 2.6 5.9C8.5 15.8 9 16.9 9 18h6c0-1.1.5-2.2 1.4-3.1A7 7 0 0 0 12 2z" />
                </svg>
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider">Aturan</span>
              </button>

              {/* Fullscreen Item */}
              <button
                onClick={() => {
                  toggleFullscreen();
                  setShowGlobalMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-emerald-950/30 text-left transition-colors text-zinc-400 hover:text-zinc-200 group border-t border-zinc-900/40 mt-0.5 pt-2"
              >
                {isFullscreen ? (
                  <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                )}
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider">
                  {isFullscreen ? "Normal" : "Layar Penuh"}
                </span>
              </button>

              {/* Exit Item (Exclusively for active players!) */}
              {view === "player_game" && (
                <button
                  onClick={() => {
                    setShowExitConfirm(true);
                    setShowGlobalMenu(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-red-950/20 hover:bg-red-950/45 text-left transition-colors text-red-400 hover:text-red-300 group border-t border-red-950/40 mt-1 pt-2.5"
                >
                  <svg className="w-3.5 h-3.5 text-red-500 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span className="text-[9px] font-mono font-black uppercase tracking-wider">Keluar</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Global Leaderboard Modal Layer */}
      <LeaderboardModal 
        isOpen={showLeaderboard}
        onClose={() => setShowLeaderboard(false)}
        remotePlayers={remotePlayers}
      />

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

      {/* ======================================================= */}
      {/* GLOBAL GAME ABANDONMENT CONFIRMATION OVERLAY            */}
      {/* ======================================================= */}
      {showExitConfirm && (
        <div 
          onClick={() => setShowExitConfirm(false)}
          className="fixed inset-0 z-[999999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-5 animate-fade-in select-none"
        >
          {/* Modal Body Container */}
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[290px] bg-[#041411]/95 border border-red-950/60 rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] p-6 flex flex-col items-center text-center relative overflow-hidden animate-scale-up"
          >
            {/* Subdued Crimson Glow background */}
            <div className="absolute -top-16 -left-16 w-40 h-40 bg-red-600/5 rounded-full blur-3xl pointer-events-none" />
            
            {/* Warning Icon Wrapper */}
            <div className="w-14 h-14 rounded-full bg-red-950/30 border border-red-900/40 flex items-center justify-center shadow-inner mb-4 relative">
              <span className="text-2xl animate-pulse">🚪</span>
              <span className="absolute bottom-2 right-2 text-xs">🏃</span>
            </div>

            {/* Content Typography */}
            <span className="text-[8px] font-mono font-black text-red-500 uppercase tracking-[0.3em] leading-none mb-2">
              Konfirmasi Menyerah
            </span>
            
            <h3 className="text-xs font-bold tracking-[0.12em] uppercase text-zinc-100 leading-snug mb-2.5">
              Apakah Anda yakin ingin menyerah & keluar?
            </h3>
            
            <p className="text-[9px] font-mono text-zinc-500 leading-relaxed uppercase tracking-wide mb-6">
              Skor kartu di tangan Anda saat ini akan tetap dihitung pada klasemen akhir Host.
            </p>

            {/* Split Action Grid */}
            <div className="w-full flex flex-col gap-2.5">
              <button
                onClick={() => {
                  setShowExitConfirm(false);
                  handleExitGame("landing"); // Executes dynamic purge and view reset!
                }}
                className="w-full py-2.5 bg-red-950 border border-red-800/60 hover:bg-red-900/50 hover:border-red-700/80 text-red-400 rounded-xl text-[9px] font-black font-mono tracking-widest uppercase transition-all shadow-[0_4px_15px_rgba(220,38,38,0.1)] active:scale-95 cursor-pointer"
              >
                Ya, Saya Menyerah
              </button>
              
              <button
                onClick={() => setShowExitConfirm(false)}
                className="w-full py-2.5 bg-transparent border border-zinc-900 hover:bg-zinc-900/40 text-zinc-500 hover:text-zinc-300 rounded-xl text-[9px] font-bold font-mono tracking-widest uppercase transition-all active:scale-95 cursor-pointer"
              >
                Tidak, Kembali Main
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* GLOBAL MODALS & ANIMATIONS              */}
      {/* ========================================= */}

      {/* 1. DEALING CARDS ANIMATION */}
      {isDealingCards && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden pointer-events-none">
          <div className="relative w-full h-full">
            {/* Center Deck Source */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              {[...Array(4)].map((_, i) => (
                <div 
                  key={i} 
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-28 ${theme.bg} rounded-xl border-2 ${theme.border} shadow-xl flex items-center justify-center`}
                  style={{ transform: `translate(calc(-50% - ${i * 2}px), calc(-50% - ${i * 2}px))` }}
                >
                  <div className="w-16 h-24 border border-white/10 rounded-lg flex items-center justify-center">
                    <div className={`w-10 h-14 ${theme.light} rounded flex items-center justify-center`}>
                      <div className={`w-6 h-8 border ${theme.accent} rounded-sm`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Flying Cards Simulation */}
            {[...Array(28)].map((_, i) => {
              const playerIndex = i % 4; // 0: Bottom, 1: Top, 2: Left, 3: Right
              const stackIndex = Math.floor(i / 4); // 0 to 6 (7 cards per player)
              
              let tx = 0, ty = 0, rot = 0;
              
              // Target players positioned at 4 sides of the table
              if (playerIndex === 0) { ty = 350; tx = stackIndex * 8 - 24; rot = stackIndex * 4 - 12; }
              else if (playerIndex === 1) { ty = -350; tx = stackIndex * 8 - 24; rot = stackIndex * 4 - 12; }
              else if (playerIndex === 2) { tx = -350; ty = stackIndex * 8 - 24; rot = -90 + (stackIndex * 4 - 12); }
              else if (playerIndex === 3) { tx = 350; ty = stackIndex * 8 - 24; rot = 90 + (stackIndex * 4 - 12); }

              return (
                <div
                  key={i}
                  className={`absolute top-1/2 left-1/2 w-16 h-24 ${theme.bg} rounded-lg border-2 ${theme.border} shadow-[0_10px_20px_rgba(0,0,0,0.5)] animate-deal-card flex items-center justify-center`}
                  style={{
                    animationDelay: `${i * 0.08}s`,
                    "--target-x": `${tx}%`,
                    "--target-y": `${ty}%`,
                    "--target-rotate": `${rot}deg`
                  } as React.CSSProperties}
                >
                  <div className={`w-10 h-14 ${theme.light} rounded flex items-center justify-center`}>
                    <div className={`w-6 h-8 border ${theme.accent} rounded-sm`} />
                  </div>
                </div>
              );
            })}

            <div className="absolute top-[62%] left-1/2 -translate-x-1/2 text-white font-black italic tracking-[0.4em] text-xl drop-shadow-2xl animate-pulse text-center">
              MEMBAGI KARTU...
            </div>
          </div>
        </div>
      )}

      {/* 2. WHO STARTS FIRST MODAL */}
      {showWhoStartsModal && (
        <div className="fixed inset-0 z-[100001] flex items-center justify-center px-6 animate-fade-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
          <div className="relative w-full max-w-[300px] bg-zinc-950/90 border border-zinc-800 rounded-[2.5rem] p-10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] text-center animate-scale-up">
            <div className="mb-8 flex justify-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center relative">
                <div className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping opacity-20" />
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M12 12h.01" />
                  <path d="M17 12h.01" />
                  <path d="M7 12h.01" />
                </svg>
              </div>
            </div>
            
            <span className="text-emerald-400 font-mono text-[9px] tracking-[0.4em] uppercase mb-2 font-black block opacity-80">
              GILIRAN PERTAMA
            </span>
            
            <h2 className="text-[28px] font-black text-white mb-8 tracking-tight leading-none uppercase">
              {showWhoStartsModal.isMe ? "ANDA" : showWhoStartsModal.name.toUpperCase()}
            </h2>

            <div className="py-3 px-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-400 font-mono text-[10px] tracking-widest uppercase font-bold">
                {showWhoStartsModal.isMe ? "Mulai Buang Kartu" : "Mohon Tunggu..."}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 3. YOUR TURN ALERT MODAL (CRITICAL UX FOR REMINDING PLAYERS) */}
      {showMyTurnModal && (
        <div className="fixed inset-0 z-[100005] flex items-center justify-center px-6 animate-fade-in pointer-events-none">
          {/* Subtle Immersive Backdrop Blur */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[6px]" />
          
          <div className="relative w-full max-w-[300px] bg-zinc-950/90 border border-zinc-800 rounded-[2.5rem] p-10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] text-center animate-scale-up pointer-events-auto overflow-hidden">
            {/* Subtle Gradient Accent */}
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />

            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center relative">
                {/* Pulse ring */}
                <div className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping opacity-20" />
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M12 12h.01" />
                  <path d="M17 12h.01" />
                  <path d="M7 12h.01" />
                </svg>
              </div>
            </div>
            
            <span className="text-emerald-400 font-mono text-[9px] tracking-[0.4em] uppercase mb-2 font-black block opacity-80">
              GILIRAN ANDA
            </span>
            <h2 className="text-[26px] font-black text-white mb-8 tracking-tight leading-[1.1] px-2">
              Saatnya Ambil<br/><span className="text-emerald-500">Kartu Baru</span>
            </h2>
            
            <button
              onClick={() => setShowMyTurnModal(false)}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-black rounded-2xl text-[11px] font-black font-mono tracking-widest uppercase transition-all active:scale-[0.98] shadow-[0_10px_30px_rgba(16,185,129,0.25)] cursor-pointer group flex items-center justify-center gap-2"
            >
              Mulai Bermain
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-1 transition-transform">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* INTERACTIVE GAME TAUNTS OVERLAYS        */}
      {/* ========================================= */}
      
      {/* 1. Fullscreen Burning Fire Effect — FLYING FIREBALLS */}
      {fireTaunt.active && fireTaunt.target && fireTaunt.sender?.toUpperCase() !== playerName.toUpperCase() && (
        <div className={`fixed inset-0 pointer-events-none z-[99999] overflow-hidden ${fireTaunt.target.toUpperCase() === playerName.toUpperCase() ? "screen-shake" : ""}`}>
          {/* CSS Fireball Animations */}
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes fly-fireball-1 {
              0%   { transform: translate(-120px, 60vh) scale(0.4) rotate(0deg); opacity: 0; }
              10%  { opacity: 1; }
              80%  { transform: translate(55vw, 40vh) scale(2) rotate(720deg); opacity: 1; }
              100% { transform: translate(52vw, 42vh) scale(1.5) rotate(750deg); opacity: 0; }
            }
            @keyframes fly-fireball-2 {
              0%   { transform: translate(110vw, 20vh) scale(0.3) rotate(0deg); opacity: 0; }
              15%  { opacity: 1; }
              80%  { transform: translate(40vw, 52vh) scale(2.5) rotate(-540deg); opacity: 1; }
              100% { transform: translate(42vw, 50vh) scale(1.8) rotate(-570deg); opacity: 0; }
            }
            @keyframes fly-fireball-3 {
              0%   { transform: translate(30vw, -80px) scale(0.5) rotate(0deg); opacity: 0; }
              10%  { opacity: 1; }
              75%  { transform: translate(48vw, 48vh) scale(2) rotate(480deg); opacity: 1; }
              100% { transform: translate(48vw, 50vh) scale(1.5) rotate(510deg); opacity: 0; }
            }
            @keyframes impact-shake {
              0%, 100% { transform: translate(0,0) rotate(0deg); }
              10% { transform: translate(-12px, -6px) rotate(-3deg); }
              20% { transform: translate(12px, 6px) rotate(3deg); }
              30% { transform: translate(-8px, 4px) rotate(-2deg); }
              40% { transform: translate(8px, -4px) rotate(2deg); }
              50% { transform: translate(-4px, 4px) rotate(-1deg); }
            }
            @keyframes burn-flicker {
              0%, 100% { opacity: 0.4; }
              50% { opacity: 0.8; }
            }
            @keyframes ember-float {
              0% { transform: translateY(0) rotate(0deg); opacity: 0; }
              20% { opacity: 1; }
              100% { transform: translateY(-100vh) rotate(360deg); opacity: 0; }
            }
            .fireball { position: absolute; filter: drop-shadow(0 0 15px #f97316); }
            .fireball-1 { animation: fly-fireball-1 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
            .fireball-2 { animation: fly-fireball-2 1.0s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards; }
            .fireball-3 { animation: fly-fireball-3 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.05s forwards; }
            .screen-shake { animation: impact-shake 0.6s ease 0.8s; }
            .ember {
              position: absolute; width: 4px; height: 4px; background: #fb923c; border-radius: 50%;
              box-shadow: 0 0 10px #f97316; animation: ember-float 2s linear infinite;
            }
          `}} />

          {/* Immersive Fire Vignette (Only if target) */}
          {fireTaunt.target.toUpperCase() === playerName.toUpperCase() && (
            <div className="absolute inset-0 z-0">
              <div className="absolute inset-0 bg-red-600/10 mix-blend-overlay animate-[burn-flicker_0.1s_infinite]" />
              <div className="absolute inset-0 shadow-[inset_0_0_150px_rgba(185,28,28,0.6)]" />
              {/* Floating Embers */}
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="ember"
                  style={{
                    left: `${Math.random() * 100}%`,
                    bottom: "-20px",
                    animationDelay: `${Math.random() * 2}s`,
                    opacity: Math.random()
                  }}
                />
              ))}
            </div>
          )}

          {/* Premium SVG Fireballs */}
          {[1, 2, 3].map((n) => (
            <div key={n} className={`fireball fireball-${n} top-0 left-0`}>
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <defs>
                  <radialGradient id={`fire-grad-${n}`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fff" />
                    <stop offset="30%" stopColor="#fbbf24" />
                    <stop offset="60%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="transparent" />
                  </radialGradient>
                </defs>
                <path
                  d="M12 2c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.1.9-2 2-2s2 .9 2 2zm1 14c0 3.3-2.7 6-6 6s-6-2.7-6-6c0-1.7.7-3.2 1.8-4.2C3.1 10.7 4 8.7 4 6.5 4 4 5 2 7 1c-.7 1.3-1 2.8-1 4.5 0 3.9 3.1 7 7 7 .6 0 1.1-.1 1.6-.2-.4 1.1-.6 2.3-.6 3.7z"
                  fill={`url(#fire-grad-${n})`}
                >
                  <animate attributeName="d" dur="0.2s" repeatCount="indefinite" values="M12 2c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.1.9-2 2-2s2 .9 2 2zm1 14c0 3.3-2.7 6-6 6s-6-2.7-6-6c0-1.7.7-3.2 1.8-4.2C3.1 10.7 4 8.7 4 6.5 4 4 5 2 7 1c-.7 1.3-1 2.8-1 4.5 0 3.9 3.1 7 7 7 .6 0 1.1-.1 1.6-.2-.4 1.1-.6 2.3-.6 3.7z;M12 3c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.1.9-2 2-2s2 .9 2 2zm1 13c0 3.3-2.7 6-6 6s-6-2.7-6-6c0-1.7.7-3.2 1.8-4.2C3.1 9.7 4 7.7 4 5.5 4 3 5 1 7 0c-.7 1.3-1 2.8-1 4.5 0 3.9 3.1 7 7 7 .6 0 1.1-.1 1.6-.2-.4 1.1-.6 2.3-.6 3.7z;M12 2c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.1.9-2 2-2s2 .9 2 2zm1 14c0 3.3-2.7 6-6 6s-6-2.7-6-6c0-1.7.7-3.2 1.8-4.2C3.1 10.7 4 8.7 4 6.5 4 4 5 2 7 1c-.7 1.3-1 2.8-1 4.5 0 3.9 3.1 7 7 7 .6 0 1.1-.1 1.6-.2-.4 1.1-.6 2.3-.6 3.7z" />
                </path>
              </svg>
            </div>
          ))}

          {/* Impact alert (Shows ONLY if you are the victim) */}
          {fireTaunt.target.toUpperCase() === playerName.toUpperCase() && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-zinc-950/95 border border-red-700/70 backdrop-blur-md px-10 py-6 rounded-3xl flex flex-col items-center gap-2 shadow-[0_0_80px_rgba(239,68,68,0.5)] select-none animate-scale-up">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mb-1">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                    <path d="M12 2c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.1.9-2 2-2s2 .9 2 2z" />
                    <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3-4-4-6.5c-.66 1.9-2 4.5-1 7 0 2-3 3-3 6a6 6 0 0 0 4 6z" />
                  </svg>
                </div>
                <span className="text-[10px] font-mono font-black text-red-500 uppercase tracking-[0.4em] block">
                  WASPADA!
                </span>
                <span className="text-[13px] font-bold tracking-tight text-zinc-100 uppercase">
                  {fireTaunt.sender} Membakar Anda!
                </span>
              </div>
            </div>
          )}
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

      {/* IMMERSIVE GLOBAL GAME OVER & SCOREBOARD STANDINGS OVERLAY */}
      {globalGameOverData && (
        <>
          {globalGameOverData.standings[0]?.name.toUpperCase() === playerName.toUpperCase() && <Confetti />}
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          {/* Glassmorphic Modal Container */}
          <div className="w-full max-w-md bg-[#03100c]/90 border border-emerald-900/30 rounded-3xl shadow-[0_25px_70px_rgba(0,0,0,0.9)] p-6 relative overflow-hidden animate-scale-up">
            {/* Emerald glow orb in background */}
            <div className="absolute -top-24 -left-24 w-64 h-64 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
            
            {/* Top Trophy & Title Header */}
            <div className="flex flex-col items-center text-center mb-6 relative z-10">
              <div className="w-16 h-16 rounded-full bg-emerald-950 border border-emerald-700/40 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.2)] mb-3 animate-bounce">
                <span className="text-3xl">🏆</span>
              </div>
              <span className="text-[9px] font-mono font-black text-emerald-500 uppercase tracking-[0.3em] leading-none mb-2">
                Permainan Selesai
              </span>
              <h2 className="text-lg font-medium text-zinc-100 tracking-widest uppercase">
                KLASEMEN PEMENANG
              </h2>
            </div>

            {/* Standings List Table */}
            <div className="space-y-2.5 mb-7 relative z-10">
              {globalGameOverData.standings.map((entry, idx) => {
                const isWinner = idx === 0;
                const suitOf = (s: string) => s === "hearts" ? "♥" : s === "diamonds" ? "♦" : s === "clubs" ? "♣" : "♠";
                const isRedSuit = (s: string) => s === "hearts" || s === "diamonds";
                return (
                  <div
                    key={entry.name}
                    className={`flex flex-col px-4 py-3.5 rounded-xl border transition-all duration-300 ${
                      isWinner
                        ? "bg-emerald-950/30 border-emerald-700/40 shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]"
                        : "bg-zinc-950/50 border-zinc-900/80 hover:border-zinc-800"
                    }`}
                  >
                    {/* Top row: rank + name + score */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        {/* Position Badge */}
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] border ${
                          idx === 0
                            ? "bg-amber-500/20 border-amber-500/60 text-amber-400"
                            : idx === 1
                            ? "bg-zinc-400/20 border-zinc-400/60 text-zinc-300"
                            : idx === 2
                            ? "bg-amber-800/20 border-amber-800/60 text-amber-600"
                            : "bg-zinc-900 border-zinc-800 text-zinc-600"
                        }`}>
                          {idx + 1}
                        </div>

                        {/* Player Identity */}
                        <div className="flex flex-col">
                          <span className={`text-xs font-bold tracking-wide uppercase ${isWinner ? "text-emerald-400" : "text-zinc-200"}`}>
                            {entry.name}
                          </span>
                          <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">
                            {entry.roundPoints > 0 ? (
                              <>Skor Babak: <span className="text-emerald-400 font-bold">+{entry.roundPoints}</span></>
                            ) : (
                              <>Skor Babak: <span className="text-zinc-400 font-bold">0</span></>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Cumulative Score Badge */}
                      <div className="flex flex-col items-end">
                        <span className={`text-[14px] font-black font-mono ${isWinner ? "text-emerald-400" : entry.totalScore < 0 ? "text-red-400" : "text-zinc-100"}`}>
                          {entry.totalScore > 0 ? `+${entry.totalScore}` : entry.totalScore}
                        </span>
                        <span className="text-[7px] font-mono text-zinc-600 uppercase tracking-widest leading-none mt-0.5">
                          Total Poin
                        </span>
                      </div>
                    </div>

                    {/* ── Winner Detail: Kartu Diturunkan + Kartu Penutup ── */}
                    {isWinner && (entry.melds?.length || entry.closingCard) && (
                      <div className="mt-3 pt-3 border-t border-emerald-900/30 flex flex-col gap-2.5">

                        {/* Kartu yang diturunkan (melds) */}
                        {entry.melds && entry.melds.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[7px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
                              Kartu Diturunkan ({entry.melds.flat().length} kartu)
                            </span>
                            <div className="flex flex-col gap-1">
                              {entry.melds.map((group, gIdx) => (
                                <div key={gIdx} className="flex items-center gap-1 flex-wrap">
                                  <span className="text-[7px] font-mono text-zinc-600 mr-1">#{gIdx + 1}</span>
                                  {group.map((card, cIdx) => (
                                    <span
                                      key={cIdx}
                                      className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono border ${
                                        isRedSuit(card.suit)
                                          ? "bg-red-950/40 border-red-800/40 text-red-400"
                                          : "bg-zinc-900/60 border-zinc-700/40 text-zinc-300"
                                      }`}
                                    >
                                      {card.value}{suitOf(card.suit)}
                                    </span>
                                  ))}
                                  <span className="text-[7px] font-mono text-zinc-600 ml-auto">
                                    +{getMeldPoints(group)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Kartu penutup */}
                        {entry.closingCard && (
                          <div className="flex items-center gap-2">
                            <span className="text-[7px] font-mono text-zinc-500 uppercase tracking-[0.2em] flex-shrink-0">
                              Kartu Tutup
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono border ${
                                isRedSuit(entry.closingCard.suit)
                                  ? "bg-red-950/40 border-red-800/40 text-red-400"
                                  : "bg-zinc-900/60 border-zinc-700/40 text-zinc-300"
                              }`}
                            >
                              {entry.closingCard.value}{suitOf(entry.closingCard.suit)}
                            </span>
                            <span className="text-[7px] font-mono text-amber-500/80 ml-auto">
                              ×10 = +{getCardPoints(entry.closingCard) * 10}
                            </span>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer Actions Grid */}
            <div className="flex gap-3 relative z-10">
              {isHostRole ? (
                <button
                  onClick={() => handleFinishGame(globalGameOverData.updatedPlayers)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-black py-2.5 rounded-xl text-[10px] font-black font-mono tracking-widest uppercase transition-all cursor-pointer shadow-[0_0_25px_rgba(16,185,129,0.3)] active:scale-95 hover:shadow-[0_0_35px_rgba(16,185,129,0.4)]"
                >
                  Lanjut ke Lobby
                </button>
              ) : (
                <div className="w-full text-center py-2.5 bg-zinc-900/50 rounded-xl border border-zinc-800 text-zinc-500 text-[10px] font-mono font-bold tracking-widest uppercase animate-pulse">
                  Menunggu Host...
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )}

      {/* ========================================= */}
      {/* ========================================= */}
      {/* RENDER MODULAR GAME VIEWS                 */}
      {/* ========================================= */}
      {view === "landing" && (
        <LandingView
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          playerName={playerName}
          setPlayerName={setPlayerName}
          handleCreateRoom={handleCreateRoom}
          handleJoinRoom={handleJoinRoom}
        />
      )}

      {view === "host_lobby" && (
        <HostLobbyView
          roomCode={roomCode}
          qrCodeUrl={qrCodeUrl}
          remotePlayers={remotePlayers}
          handleStartGame={handleStartGame}
          setView={handleExitGame}
          cardBackColor={cardBackColor}
          setCardBackColor={setCardBackColor}
          tableTheme={tableTheme}
          setTableTheme={setTableTheme}
          voiceTaunt={voiceTaunt}
          onUpdateVoiceTaunt={handleUpdateVoiceTaunt}
        />
      )}

      {view === "host_game" && (
        <HostGameBoardView
          roomCode={roomCode}
          remotePlayers={remotePlayers}
          deck={deck}
          discardPile={discardPile}
          turnIndex={activeTurnIndex}
          initGame={initGame}
          setView={handleExitGame}
          chatMessages={chatMessages}
          fireTauntEvent={hostFireTaunt}
          finishGame={handleFinishGame}
          triggerGlobalEndGame={handleTriggerGlobalEndGame}
          tableThemeClass={activeTableTheme}
        />
      )}

      {view === "player_lobby" && (
        <PlayerLobbyView
          roomCode={roomCode}
          playerName={playerName}
          remotePlayers={remotePlayers}
          sendLobbyEmoji={sendLobbyEmoji}
          voiceTaunt={voiceTaunt}
          onUpdateVoiceTaunt={handleUpdateVoiceTaunt}
        />
      )}

      {view === "player_game" && (
        <PlayerGameBoardView
          isMyTurn={isMyTurn}
          hasDrawnThisTurn={hasDrawnThisTurn}
          activePlayerName={activePlayerName}
          playerName={playerName}
          remotePlayers={remotePlayers}
          turnIndex={activeTurnIndex}
          bots={bots}
          discardPile={discardPile}
          deckCount={deck.length}
          selectedDiscardIndex={selectedDiscardIndex}
          setSelectedDiscardIndex={setSelectedDiscardIndex}
          isDiscardSelectionValid={isDiscardSelectionValid}
          playerHand={playerHand}
          setPlayerHand={setPlayerHand}
          setView={handleExitGame}
          sendFireTaunt={sendFireTaunt}
          sendChatMessage={sendChatMessage}
          drawFromDiscardAtIndex={drawFromDiscardAtIndex}
          drawFromStock={drawFromStock}
          sortMyHand={sortMyHand}
          discardSelected={discardSelected}
          meldSelectedCards={meldSelectedCards}
          finishShowdown={finishShowdown}
          gameStatus={gameStatus}
          syncHandSort={syncHandSort}
          setToastMsg={setToastMsg}
          onShowLeaderboard={() => setShowLeaderboard(true)}
          sendReaction={sendReaction}
          sendVoiceTaunt={sendVoiceTaunt}
          myVoiceTaunt={voiceTaunt}
          tableThemeClass={activeTableTheme}
          melds={remotePlayers.find((p) => p.name.toUpperCase() === playerName.toUpperCase())?.melds || []}
          isDoneShowdown={remotePlayers.find((p) => p.name.toUpperCase() === playerName.toUpperCase())?.isDoneShowdown || false}
        />
      )}

      {/* UNIVERSAL FLOATING SOCIAL CHAT DRAWER (For non-hosts in lobbies & games!) */}
      {view !== "landing" && !isHostRole && (
        <FloatingSocialDeck
          chatMessages={chatMessages}
          playerName={playerName}
          sendChatMessage={sendChatMessage}
          remotePlayers={remotePlayers}
        />
      )}
      {/* Social Reactions Layer */}
      <FloatingEmojis reactions={reactions} />
    </main>
  );
}



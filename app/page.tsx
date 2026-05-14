"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, createDeck, shuffleDeck, sortHand, canDrawDiscardCard, getCardPoints, isSet, isRun } from "./utils/gameLogic";
import { supabase } from "./utils/supabaseClient";

// Import View Komponen Modular Baru
import LandingView from "./components/views/LandingView";
import HostLobbyView from "./components/views/HostLobbyView";
import PlayerLobbyView from "./components/views/PlayerLobbyView";
import HostGameBoardView from "./components/views/HostGameBoardView";
import PlayerGameBoardView from "./components/views/PlayerGameBoardView";

// Import Modals
import LeaderboardModal from "./components/modals/LeaderboardModal";
import FloatingSocialDeck from "./components/modals/FloatingSocialDeck";

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
  return reconciled;
};

export default function Home() {
  const [view, setView] = useState<ViewState>("landing");
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showGlobalMenu, setShowGlobalMenu] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [fireTaunt, setFireTaunt] = useState<{ active: boolean, sender: string | null }>({ active: false, sender: null });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  
  // --- REMOTE MULTIPLAYER STATE ---
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "finished">("waiting");
  const [globalGameOverData, setGlobalGameOverData] = useState<{
    standings: { name: string; roundPoints: number; prevScore: number; totalScore: number }[];
    updatedPlayers: RemotePlayer[];
  } | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(0);
  const [isHostRole, setIsHostRole] = useState<boolean>(false);

  // --- LOBBY INTERACTIVE TAUNTS ---
  const [activeTauntOverlay, setActiveTauntOverlay] = useState<{ sender: string; emoji: string } | null>(null);
  const lastSeenTauntTime = useRef<number>(0);

  // --- GAME STATE ---
  const [deck, setDeck] = useState<Card[]>([]);
  const [discardPile, setDiscardPile] = useState<Card[]>([]); // Index 0 is the LATEST discard
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [hasDrawnThisTurn, setHasDrawnThisTurn] = useState(false);
  
  const [selectedDiscardIndex, setSelectedDiscardIndex] = useState<number | null>(null);
  
  // --- INTEGRATED SOCIAL DECK CHAT STATE ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);



  // Derived backward-compatible opponents state from active Remote Players!
  const bots = remotePlayers
    .filter(p => p.name !== (playerName || "Host"))
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
        const roundPoints = player.hand.reduce((sum, card) => sum + getCardPoints(card), 0);
        const totalScore = player.score; // Already updated in DB by the winner
        const prevScore = totalScore - roundPoints; // Derive prev score
        return { name: player.name, roundPoints, prevScore, totalScore };
      });
      // Lowest score wins
      rawStandings.sort((a, b) => a.totalScore - b.totalScore);
      setGlobalGameOverData({ standings: rawStandings, updatedPlayers: remotePlayers });
    } else if (gameStatus !== "finished" && globalGameOverData) {
      setGlobalGameOverData(null);
    }
  }, [gameStatus, remotePlayers, view, globalGameOverData]);

  const subscribeToRoom = (code: string, myName: string) => {
    // 1. Bersihkan channel lama secara aman (Jangan biarkan error mematikan aplikasi)
    try {
      supabase.removeAllChannels().catch((e) => {
        console.warn("WebSocket disconnect skipped:", e.message);
      });
    } catch (err) {
      console.warn("Supabase cleanup failed silently:", err);
    }

    // 2. Coba bangun langganan WebSocket (Bungkus try-catch untuk jaring pengaman total)
    try {
      const channel = supabase
        .channel(`channel_${code}`)
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
                setRemotePlayers(newState.players);
                setGameStatus(newState.status);
                setActiveTurnIndex(newState.turn_index);
                setDeck(newState.deck);
                setDiscardPile(newState.discard_pile);
                setChatMessages(newState.chat_messages || []);

                // Detect and trigger active interactive lobby taunts!
                if (newState.taunt && newState.taunt.timestamp > lastSeenTauntTime.current) {
                  lastSeenTauntTime.current = newState.taunt.timestamp;
                  setActiveTauntOverlay({ sender: newState.taunt.sender, emoji: newState.taunt.emoji });
                  // Clean up animation overlay after 2.5s
                  setTimeout(() => setActiveTauntOverlay(null), 2500);
                }

                // Smart auto-routing view states based on database updates
                setView((currView) => {
                  if (newState.status === "playing") {
                    if (currView === "player_lobby") return "player_game";
                    if (currView === "host_lobby") return "host_game";
                  } else if (newState.status === "waiting") {
                    if (currView === "player_game") return "player_lobby";
                    if (currView === "host_game") return "host_lobby";
                  }
                  return currView;
                });
                
                // Find local player's real-time server reference to update their hand
                const serverMe = newState.players.find(p => p.name.toUpperCase() === myName.toUpperCase());
                if (serverMe) {
                  setPlayerHand((current) => reconcilePlayerHand(current, serverMe.hand));
                  setHasDrawnThisTurn(serverMe.hasDrawn);
                }
              }
            } else {
              console.log("⚠️ Ignored Event (Non-Matching Room Code)");
            }
          }
        )
        .subscribe();

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
      turn_index: 0
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

      subscribeToRoom(newCode, "Host");
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

      subscribeToRoom(targetCode, targetName);
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

    // ==========================================
    // OPTIMISTIC LOCAL UI UPDATE
    // ==========================================
    // Melompati jeda polling agar Host seketika masuk ke layar meja game!
    setRemotePlayers(finalReadyState.players);
    setGameStatus(finalReadyState.status);
    setActiveTurnIndex(finalReadyState.turn_index);
    setDeck(finalReadyState.deck);
    setDiscardPile(finalReadyState.discard_pile);
    setView("host_game");
  };

  // 3.4 Host Action: Trigger Global End Game (Calculates points and shows modal for everyone)
  const handleTriggerGlobalEndGame = async (updatedPlayers: RemotePlayer[]) => {
    if (!roomCode) return;
    
    const updatedState: RemoteGameState = {
      status: "finished",
      deck,
      discard_pile: discardPile,
      players: updatedPlayers,
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
    subscribeToRoom(savedRoom.toUpperCase(), savedName);
    
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
          setRemotePlayers(serverState.players);
          setGameStatus(serverState.status);
          setActiveTurnIndex(serverState.turn_index);
          setDeck(serverState.deck);
          setDiscardPile(serverState.discard_pile);
          setChatMessages(serverState.chat_messages || []);

          // Sinkronisasi interaktif taunt lobby via polling cadangan!
          if (serverState.taunt && serverState.taunt.timestamp > lastSeenTauntTime.current) {
            lastSeenTauntTime.current = serverState.taunt.timestamp;
            setActiveTauntOverlay({ sender: serverState.taunt.sender, emoji: serverState.taunt.emoji });
            setTimeout(() => setActiveTauntOverlay(null), 2500);
          }

          // Auto-routing view jika status game berubah menjadi bermain
          setView((currView) => {
            if (serverState.status === "playing") {
              if (currView === "player_lobby") return "player_game";
              if (currView === "host_lobby") return "host_game";
            } else if (serverState.status === "waiting") {
              if (currView === "player_game") return "player_lobby";
              if (currView === "host_game") return "host_lobby";
            }
            return currView;
          });

          // Sinkronisasi kartu tangan milik pemain aktif
          const serverMe = serverState.players.find(p => p.name.toUpperCase() === playerName.toUpperCase());
          if (serverMe) {
            setPlayerHand((current) => reconcilePlayerHand(current, serverMe.hand));
            setHasDrawnThisTurn(serverMe.hasDrawn);
          }
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
        const pHand = player.name.toUpperCase() === playerName.toUpperCase() ? updatedHand : player.hand;
        const roundPoints = pHand.reduce((sum, card) => sum + getCardPoints(card), 0);
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
    setRemotePlayers(nextPlayers);
    
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
      setToastMsg("Tunggu! Bukan Giliran Anda ⏰");
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const nextDiscard = [...discardPile];
    const availableToTake = Math.min(nextDiscard.length, 7);
    const countToTake = availableToTake - index;
    const takenCards = nextDiscard.splice(index, countToTake);
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
    
    // OPTIMISTIC LOCAL UPDATE:
    // Mengambil kartu buangan instan tanpa lag jaringan!
    setDiscardPile(nextDiscard);
    setPlayerHand(updatedHand);
    setHasDrawnThisTurn(true);
    setRemotePlayers(nextPlayers);
    
    setSelectedDiscardIndex(null);
  };

  const discardSelected = async (cardId: string) => {
    if (!cardId) return;
    if (!hasDrawnThisTurn) return;

    const targetCard = playerHand.find(c => c.id === cardId);
    if (!targetCard) return;

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
      finalStatus = "finished";
      
      const rawStandings = playingPlayers.map((player) => {
        const pHand = player.name.toUpperCase() === playerName.toUpperCase() ? updatedHand : player.hand;
        const roundPoints = pHand.reduce((sum, card) => sum + getCardPoints(card), 0);
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
      deck: deck,
      discard_pile: updatedDiscard,
      players: finalPlayers,
      turn_index: nextTurnIdx
    };

    await updateRemoteRoom(updatedState);
    
    // OPTIMISTIC LOCAL UPDATE:
    // Membuang kartu instan dan langsung mengalihkan giliran tanpa lag!
    setPlayerHand(updatedHand);
    setDiscardPile(updatedDiscard);
    setRemotePlayers(nextPlayers);
    setActiveTurnIndex(nextTurnIdx);
    setHasDrawnThisTurn(false);
  };

  const meldSelectedCards = async (cardIds: string[]): Promise<boolean> => {
    if (cardIds.length < 3) return false;
    
    const selectedCards = playerHand.filter(c => cardIds.includes(c.id));
    const isValidCombination = isSet(selectedCards) || isRun(selectedCards);
    
    if (!isValidCombination) {
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

    const updatedState: RemoteGameState = {
      status: "playing",
      deck: deck,
      discard_pile: discardPile,
      players: nextPlayers,
      turn_index: activeTurnIndex
    };

    await updateRemoteRoom(updatedState);

    // Optimistic Local Update
    setPlayerHand(updatedHand);
    setRemotePlayers(nextPlayers);
    setToastMsg("🎉 Sukses Menurunkan Kartu!");
    setTimeout(() => setToastMsg(null), 2000);
    
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
  const isMyTurn = currentMyIdx === activeTurnIndex;
  const activePlayerName = activePlayingPlayers[activeTurnIndex]?.name || "...";

  const circularDiscards = discardPile;
  
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

      {/* IMMERSIVE GLOBAL GAME OVER & SCOREBOARD STANDINGS OVERLAY */}
      {globalGameOverData && (
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
                return (
                  <div 
                    key={entry.name}
                    className={`flex justify-between items-center px-4 py-3.5 rounded-xl border transition-all duration-300 ${
                      isWinner
                        ? "bg-emerald-950/30 border-emerald-700/40 shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]"
                        : "bg-zinc-950/50 border-zinc-900/80 hover:border-zinc-800"
                    }`}
                  >
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
                          Sisa Kartu: <span className={entry.roundPoints > 0 ? "text-red-500/80" : "text-emerald-500/80"}>+{entry.roundPoints}</span>
                        </span>
                      </div>
                    </div>

                    {/* Cumulative Score Badge */}
                    <div className="flex flex-col items-end">
                      <span className={`text-[14px] font-black font-mono ${isWinner ? "text-emerald-400" : "text-zinc-100"}`}>
                        {entry.totalScore}
                      </span>
                      <span className="text-[7px] font-mono text-zinc-600 uppercase tracking-widest leading-none mt-0.5">
                        Total Poin
                      </span>
                    </div>
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
          finishGame={handleFinishGame}
          triggerGlobalEndGame={handleTriggerGlobalEndGame}
        />
      )}

      {view === "player_lobby" && (
        <PlayerLobbyView
          roomCode={roomCode}
          playerName={playerName}
          remotePlayers={remotePlayers}
          sendLobbyEmoji={sendLobbyEmoji}
        />
      )}

      {view === "player_game" && (
        <PlayerGameBoardView
          isMyTurn={isMyTurn}
          hasDrawnThisTurn={hasDrawnThisTurn}
          activePlayerName={activePlayerName}
          totalHandPoints={totalHandPoints}
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
          drawFromDiscardAtIndex={drawFromDiscardAtIndex}
          drawFromStock={drawFromStock}
          sortMyHand={sortMyHand}
          discardSelected={discardSelected}
          meldSelectedCards={meldSelectedCards}
          syncHandSort={syncHandSort}
          setToastMsg={setToastMsg}
          melds={remotePlayers.find((p) => p.name.toUpperCase() === playerName.toUpperCase())?.melds || []}
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
    </main>
  );
}



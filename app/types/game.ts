import { Card } from "../utils/gameLogic";

export interface RemotePlayer {
  name: string;
  hand: Card[];
  melds?: Card[][]; // Dynamic support for laid-down card combinations
  isHost: boolean;
  hasDrawn: boolean;
  score: number;
  isDoneShowdown?: boolean;
  voice_taunt?: string; // Base64 audio string
  last_voice_taunt_at?: number; // Timestamp to trigger playback
}

export interface ChatMessage {
  id: string;
  sender: string;
  recipient?: string; // Optional: "All" or specific playerName
  text?: string;
  photoBase64?: string;
  timestamp: number;
}

export interface RemoteGameState {
  status: "waiting" | "playing" | "showdown" | "finished";
  deck: Card[];
  discard_pile: Card[];
  players: RemotePlayer[];
  turn_index: number;
  taunt?: {
    sender: string;
    emoji: string;
    timestamp: number;
  };
  fireTaunt?: {
    target: string;
    sender: string;
    timestamp: number;
  };
  chat_messages?: ChatMessage[];
  card_back_color?: string;
  reactions?: {
    id: string;
    sender: string;
    emoji: string;
    timestamp: number;
  }[];
  table_theme?: string;
}

export type ViewState = "landing" | "host_lobby" | "host_game" | "player_lobby" | "player_game";

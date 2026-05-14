import { Card } from "../utils/gameLogic";

export interface RemotePlayer {
  name: string;
  hand: Card[];
  melds?: Card[][]; // Dynamic support for laid-down card combinations
  isHost: boolean;
  hasDrawn: boolean;
  score: number;
  isDoneShowdown?: boolean;
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
}

export type ViewState = "landing" | "host_lobby" | "host_game" | "player_lobby" | "player_game";

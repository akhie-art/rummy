"use client";

import React from "react";

export type Suit = "hearts" | "diamonds" | "clubs" | "spades" | "joker";
export type CardValue = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "JKR";

interface PlayingCardProps {
  suit: Suit;
  value: CardValue;
  faceUp?: boolean;
  onClick?: () => void;
  className?: string;
  isSelected?: boolean;
}

export const getSuitSymbol = (suit: Suit) => {
  switch (suit) {
    case "hearts": return "♥";
    case "diamonds": return "♦";
    case "clubs": return "♣";
    case "spades": return "♠";
    case "joker": return "★";
  }
};

export const getSuitColor = (suit: Suit) => {
  if (suit === "joker") return "text-amber-600";
  return suit === "hearts" || suit === "diamonds" ? "text-red-500" : "text-zinc-900";
};

export default function PlayingCard({
  suit,
  value,
  faceUp = true,
  onClick,
  className = "",
  isSelected = false,
}: PlayingCardProps) {
  const symbol = getSuitSymbol(suit);
  const colorClass = getSuitColor(suit);

  // Gunakan inline style untuk dimensi agar tidak bisa di-override oleh Flexbox/Grid apapun
  const cardStyle: React.CSSProperties = {
    width: "64px",
    height: "96px",
    minWidth: "64px",
    minHeight: "96px",
    maxWidth: "64px",
    maxHeight: "96px",
    flexShrink: 0,
  };

  if (!faceUp) {
    return (
      <div
        onClick={onClick}
        className={`rounded-xl relative overflow-hidden flex items-center justify-center cursor-pointer border-2 border-white shadow-xl transition-all active:scale-95 select-none ${className}`}
        style={{
          ...cardStyle,
          background: "repeating-linear-gradient(45deg, #991b1b, #991b1b 10px, #7f1d1d 10px, #7f1d1d 20px)",
        }}
      >
        <div className="absolute inset-2 border border-white/30 rounded-lg flex items-center justify-center">
          <div className="text-gold font-serif text-sm opacity-80 rotate-12">♠♣♦♥</div>
        </div>
      </div>
    );
  }

  const isJoker = suit === "joker" || value === "JKR";

  return (
    <div
      onClick={onClick}
      style={cardStyle}
      className={`poker-card bg-white rounded-xl shadow-lg border-2 cursor-pointer select-none flex flex-col justify-between p-1.5 relative transition-all active:scale-95 ${
        isSelected
          ? "border-gold shadow-gold/50 shadow-xl"
          : isJoker
            ? "border-amber-200/80"
            : "border-zinc-200"
      } ${className}`}
    >
      {/* Top-Left corner */}
      <div className={`flex flex-col items-center leading-none ${colorClass}`}>
        <span className="text-xs font-bold font-sans">{value === "JKR" ? "J" : value}</span>
        <span className="text-[10px] -mt-0.5">{symbol}</span>
      </div>

      {/* Center Emblem */}
      <div className={`absolute inset-0 flex items-center justify-center opacity-20 text-2xl pointer-events-none ${colorClass}`}>
        {isJoker ? (
          <div className="flex flex-col items-center scale-90 opacity-80">
            <span className="text-3xl">★</span>
            <span className="text-[7px] font-bold font-mono tracking-[0.25em] uppercase -mt-1">Joker</span>
          </div>
        ) : symbol}
      </div>

      {/* Bottom-Right corner */}
      <div className={`flex flex-col items-center leading-none self-end rotate-180 ${colorClass}`}>
        <span className="text-xs font-bold font-sans">{value === "JKR" ? "J" : value}</span>
        <span className="text-[10px] -mt-0.5">{symbol}</span>
      </div>
    </div>
  );
}

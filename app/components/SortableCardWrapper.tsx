"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PlayingCard, { Suit, CardValue } from "./PlayingCard";

interface SortableCardWrapperProps {
  id: string;
  suit: Suit;
  value: CardValue;
  isSelected: boolean;
  isPartofValidMeld?: boolean;
  hasDrawnThisTurn: boolean;
  onClick: () => void;
}

export default function SortableCardWrapper({
  id,
  suit,
  value,
  isSelected,
  isPartofValidMeld,
  hasDrawnThisTurn,
  onClick,
}: SortableCardWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform ? {
      ...transform,
      // Maintain selected lift translate along with drag transform
      y: transform.y + (isSelected ? -24 : 0),
    } : null),
    transition,
    zIndex: isDragging ? 1000 : isSelected ? 50 : 10,
    opacity: isDragging ? 0.5 : 1,
    touchAction: "none", // Critical for mobile swipe to work correctly with DnD Kit
  };

  // For standard dnd-kit we spread attributes and listeners directly on the card.
  // We merge them so tapping still registers, but dragging takes over on threshold.
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        width: "48px",
        height: "72px",
        flexShrink: 0,
      }}
      {...attributes}
      {...listeners}
      className="relative select-none"
    >
      <PlayingCard
        suit={suit}
        value={value}
        isSelected={isSelected}
        onClick={onClick}
        className={`!w-12 !h-[72px] shadow-xl rounded-xl border-2 transition-all duration-300 ${
          isDragging ? "scale-105 rotate-3 cursor-grabbing shadow-gold/20" : "cursor-grab"
        } ${
          isPartofValidMeld 
            ? "border-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.6)] scale-110" 
            : isSelected 
              ? "border-gold shadow-gold/40 scale-105" 
              : suit === 'joker' 
                ? "border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)] bg-amber-50/10"
                : "border-zinc-300"
        }`}
      />

      {/* Special Joker Glow Overlay */}
      {suit === 'joker' && !isDragging && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-amber-400/10 to-transparent animate-pulse pointer-events-none border border-amber-300/30" />
      )}

      {/* Selection Indicator Dot */}
      {isSelected && !isDragging && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-3 h-3 bg-gold rounded-full shadow-lg animate-ping pointer-events-none" />
      )}
    </div>
  );
}

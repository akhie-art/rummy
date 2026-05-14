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
  hasDrawnThisTurn: boolean;
  onClick: () => void;
}

export default function SortableCardWrapper({
  id,
  suit,
  value,
  isSelected,
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
        className={`!w-12 !h-[72px] shadow-xl rounded-xl border-2 ${
          isDragging ? "scale-105 rotate-3 cursor-grabbing shadow-gold/20" : "cursor-grab"
        } ${isSelected ? "border-gold shadow-gold/40 scale-105" : "border-zinc-300"}`}
      />

      {/* Selection Indicator Dot */}
      {isSelected && !isDragging && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-3 h-3 bg-gold rounded-full shadow-lg animate-ping pointer-events-none" />
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";

interface EmojiItem {
  id: string;
  emoji: string;
  x: number; // random starting horizontal position
}

interface FloatingEmojisProps {
  reactions: { id: string; emoji: string; timestamp: number }[];
}

const FloatingEmojis: React.FC<FloatingEmojisProps> = ({ reactions }) => {
  const [visibleEmojis, setVisibleEmojis] = useState<EmojiItem[]>([]);
  const processedIds = React.useRef(new Set<string>());

  useEffect(() => {
    // Only process new reactions
    const now = Date.now();
    const newReactions = reactions.filter(r => !processedIds.current.has(r.id) && now - r.timestamp < 3000);
    
    if (newReactions.length > 0) {
      console.log(`🌸 [VFX] Rendering ${newReactions.length} new emojis`);
      const mapped = newReactions.map(r => {
        processedIds.current.add(r.id);
        return {
          id: r.id,
          emoji: r.emoji,
          x: 20 + Math.random() * 60 // Between 20% and 80% width
        };
      });

      setVisibleEmojis(prev => [...prev, ...mapped]);

      // Cleanup after animation ends (3s)
      setTimeout(() => {
        const idsToRemove = mapped.map(m => m.id);
        setVisibleEmojis(prev => prev.filter(e => !idsToRemove.includes(e.id)));
      }, 3500);
    }
  }, [reactions]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[999999] overflow-hidden">
      {visibleEmojis.map((e) => (
        <div
          key={e.id}
          className="absolute bottom-[-50px] text-5xl"
          style={{
            left: `${e.x}%`,
            animation: "float-emoji 3s ease-out forwards"
          }}
        >
          {e.emoji}
        </div>
      ))}
      <style>{`
        @keyframes float-emoji {
          0% {
            transform: translateY(0) scale(0.5) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
            transform: translateY(-50px) scale(1.5) rotate(15deg);
          }
          100% {
            transform: translateY(-110vh) scale(1) rotate(-30deg);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default FloatingEmojis;

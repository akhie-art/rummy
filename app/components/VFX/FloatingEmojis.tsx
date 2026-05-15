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
  const [processedIds] = useState(new Set<string>());

  useEffect(() => {
    // Only process new reactions
    const now = Date.now();
    const newReactions = reactions.filter(r => !processedIds.has(r.id) && now - r.timestamp < 3000);
    
    if (newReactions.length > 0) {
      const mapped = newReactions.map(r => {
        processedIds.add(r.id);
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
      }, 3000);
    }
  }, [reactions]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100002] overflow-hidden">
      {visibleEmojis.map((e) => (
        <div
          key={e.id}
          className="absolute bottom-[-50px] text-4xl animate-float-emoji"
          style={{
            left: `${e.x}%`,
            animationDuration: "3s",
            animationFillMode: "forwards"
          }}
        >
          {e.emoji}
        </div>
      ))}
      <style jsx global>{`
        @keyframes float-emoji {
          0% {
            transform: translateY(0) scale(0.5) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
            transform: translateY(-50px) scale(1.2) rotate(10deg);
          }
          100% {
            transform: translateY(-100vh) scale(1) rotate(-20deg);
            opacity: 0;
          }
        }
        .animate-float-emoji {
          animation-name: float-emoji;
          animation-timing-function: ease-out;
        }
      `}</style>
    </div>
  );
};

export default FloatingEmojis;

import React, { useState, useRef, useEffect } from "react";
import { ChatMessage, RemotePlayer } from "../../types/game";
import { compressImageToBase64 } from "../../utils/imageCompressor";

interface FloatingSocialDeckProps {
  chatMessages: ChatMessage[];
  playerName: string;
  sendChatMessage: (text?: string, photoBase64?: string, recipient?: string) => Promise<void>;
  remotePlayers: RemotePlayer[];
}

const FloatingSocialDeck: React.FC<FloatingSocialDeckProps> = ({
  chatMessages,
  playerName,
  sendChatMessage,
  remotePlayers,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isCompressing, setIsCompressing] = useState(false);
  
  // Target penerima pesan: "All" = Publik, "Nama Pemain" = Bisikan Gelap 🔒
  const [selectedRecipient, setSelectedRecipient] = useState<string>("All");
  
  // State untuk notifikasi lencana merah (Badge)
  const [lastSeenCount, setLastSeenCount] = useState(chatMessages.length);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Daftar pemain lain yang terhubung di meja
  const otherPlayers = remotePlayers.filter(
    p => !p.isHost && p.name.toUpperCase() !== playerName.toUpperCase()
  );

  // Filter pesan: Hanya tampilkan jika Publik, Dikirim oleh saya, atau Ditujukan ke saya!
  const visibleMessages = chatMessages.filter(msg => {
    const isPublic = !msg.recipient || msg.recipient === "All";
    const isFromMe = msg.sender.toUpperCase() === playerName.toUpperCase();
    const isToMe = msg.recipient?.toUpperCase() === playerName.toUpperCase();
    return isPublic || isFromMe || isToMe;
  });

  // 1. Update Notifikasi Pesan Baru secara Reaktif
  useEffect(() => {
    if (isOpen) {
      setLastSeenCount(chatMessages.length);
      setUnreadCount(0);
    } else {
      const diff = chatMessages.length - lastSeenCount;
      setUnreadCount(diff > 0 ? diff : 0);
    }
  }, [chatMessages, isOpen, lastSeenCount]);

  // 2. Otomatis Scroll ke Bawah saat Pesan Baru Masuk / Laci Dibuka
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [visibleMessages.length, isOpen]);

  // 3. Event Handler: Kirim Teks
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    setInputText(""); // Optimistic Input Reset
    await sendChatMessage(trimmed, undefined, selectedRecipient);
  };

  // 4. Event Handler: Kompres & Kirim Foto Mini
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsCompressing(true);
    try {
      const base64 = await compressImageToBase64(files[0], 240);
      await sendChatMessage(undefined, base64, selectedRecipient);
    } catch (error) {
      console.error("⚠️ [IMAGE PROCESS ERROR]:", error);
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      {/* A. TOMBOL PEMICU MELAYANG (FLOATING TRIGGER BUBBLE) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-20 right-4 z-[100] w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 active:scale-90 hover:scale-105 cursor-pointer ${
          isOpen 
            ? "bg-zinc-800 border border-zinc-700 text-zinc-400" 
            : "bg-emerald-950/85 border border-emerald-600/40 text-emerald-400 shadow-emerald-900/20 backdrop-blur-md"
        }`}
        style={{ 
          display: playerName.toLowerCase() === "host" ? "none" : "flex" 
        }}
      >
        {isOpen ? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <div className="relative">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {/* LENCANA MERAH NOTIFIKASI (BADGE) */}
            {unreadCount > 0 && (
              <span className="absolute -top-2.5 -right-2.5 bg-rose-600 border border-zinc-950 text-[8px] font-black text-white rounded-full w-4 h-4 flex items-center justify-center animate-bounce">
                {unreadCount}
              </span>
            )}
          </div>
        )}
      </button>

      {/* C. BACKDROP LUXURY UNTUK MENUTUP LACI SAAT DIKLIK DI LUAR */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-[98] bg-black/20 backdrop-blur-[0.5px] animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* B. LACI CHAT MELUNCUR (GLASSMORPHIC SLIDE-UP SOCIAL DRAWER) */}
      <div 
        className={`fixed inset-y-0 right-0 z-[99] w-full max-w-[290px] bg-[#070a0a]/95 backdrop-blur-xl border-l border-zinc-800/60 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ display: playerName.toLowerCase() === "host" ? "none" : "flex" }}
      >
        {/* Header Drawer */}
        <div className="px-4 py-3.5 border-b border-zinc-900 bg-black/20 flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black font-mono uppercase tracking-[0.25em] text-zinc-200">
              Social Deck
            </span>
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Body: Message Scroll View */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 no-scrollbar">
          {visibleMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-25 pointer-events-none">
              <svg className="w-8 h-8 text-zinc-600 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[9px] font-mono tracking-wider uppercase">Hening... Mulai Obrolan</span>
            </div>
          ) : (
            visibleMessages.map((msg) => {
              const isMe = msg.sender.toUpperCase() === playerName.toUpperCase();
              const initials = msg.sender.substring(0, 2).toUpperCase();
              const isWhisper = msg.recipient && msg.recipient !== "All";

              return (
                <div 
                  key={msg.id} 
                  className={`flex items-end gap-2 animate-fade-in ${
                    isMe ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Sender Avatar Minimal */}
                  <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-bold font-mono tracking-wider border select-none transition-all ${
                    isMe 
                      ? isWhisper 
                        ? "bg-indigo-950 border-indigo-700/50 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.1)]"
                        : "bg-emerald-950 border-emerald-700/40 text-emerald-400" 
                      : isWhisper
                        ? "bg-indigo-950/50 border-indigo-900/50 text-indigo-400"
                        : "bg-zinc-900 border-zinc-700/50 text-zinc-400"
                  }`}>
                    {initials}
                  </div>

                  {/* Chat Bubble Panel */}
                  <div className={`flex flex-col max-w-[80%] ${isMe ? "items-end" : "items-start"}`}>
                    {/* Header Label: Sender Name */}
                    <div className="flex items-center mb-0.5">
                      {!isMe && (
                        <span className={`text-[7px] font-mono tracking-widest uppercase ml-1 ${isWhisper ? "text-indigo-400" : "text-zinc-500"}`}>
                          {msg.sender}
                        </span>
                      )}
                    </div>

                    {/* Actual Bubble Content */}
                    <div className={`px-3 py-2 rounded-xl border shadow-sm transition-colors duration-300 ${
                      isMe 
                        ? isWhisper
                          ? "bg-indigo-950/40 border-indigo-800/30 rounded-br-sm text-indigo-50"
                          : "bg-emerald-950/40 border-emerald-800/30 rounded-br-sm text-zinc-100" 
                        : isWhisper
                          ? "bg-indigo-950/20 border-indigo-900/40 rounded-bl-sm text-zinc-200 shadow-inner"
                          : "bg-zinc-900/50 border-zinc-800/60 rounded-bl-sm text-zinc-300"
                    }`}>
                      {/* Render Text Message */}
                      {msg.text && (
                        <p className="text-xs leading-relaxed tracking-wide break-words selection:bg-indigo-800">
                          {msg.text}
                        </p>
                      )}

                      {/* Render Photo Payload */}
                      {msg.photoBase64 && (
                        <div className={`overflow-hidden rounded-lg border border-zinc-800/80 shadow-lg ${msg.text ? "mt-1.5" : ""}`}>
                          <img 
                            src={msg.photoBase64} 
                            alt="Shared photo" 
                            className="w-full max-w-[160px] object-cover h-auto hover:scale-[1.05] transition-transform duration-300"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Footer Panel (Target Selector + Actions) */}
        <div className="border-t border-zinc-900/80 flex-shrink-0 flex flex-col bg-[#090d0c]/40">
          
          {/* 💊 HORIZONTAL RECIPIENT TARGET PICKER */}
          <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-zinc-900/40">
            <span className="text-[7px] font-mono uppercase text-zinc-600 tracking-widest flex-shrink-0 select-none">
              Kirim Ke:
            </span>
            
            {/* "Semua" Pill */}
            <button
              type="button"
              onClick={() => setSelectedRecipient("All")}
              className={`px-2 py-0.5 rounded-full text-[8px] font-mono uppercase tracking-wider border transition-all flex-shrink-0 cursor-pointer ${
                selectedRecipient === "All"
                  ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/60 font-bold shadow-[0_0_8px_rgba(16,185,129,0.05)]"
                  : "bg-zinc-950/20 text-zinc-500 border-zinc-850 hover:text-zinc-400 hover:border-zinc-800"
              }`}
            >
              🟢 Semua
            </button>

            {/* Opponents List Pills */}
            {otherPlayers.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelectedRecipient(p.name)}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono uppercase tracking-wider border transition-all flex-shrink-0 cursor-pointer flex items-center gap-1 ${
                  selectedRecipient === p.name
                    ? "bg-indigo-950/60 text-indigo-400 border-indigo-800/80 font-bold shadow-[0_0_12px_rgba(99,102,241,0.15)]"
                    : "bg-zinc-950/20 text-zinc-500 border-zinc-850 hover:text-zinc-400 hover:border-zinc-800"
                }`}
              >
                👤 {p.name}
              </button>
            ))}
          </div>

          {/* ⚡ QUICK CHAT PILLS ROW */}
          <div className="px-3 pt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {["Buruan dong! ⏰", "Mantap Jiwa! 🔥", "Wkwkwk lucu.. 😂", "Hampir aja! 😱", "Gaspolll! 🚀", "Aduh ampas.. 🃏", "Ojo Celelean Gerrrr 🤣"].map((msg, i) => (
              <button
                key={i}
                onClick={() => sendChatMessage(msg, undefined, selectedRecipient)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-emerald-800/40 text-[9px] font-bold text-zinc-300 hover:text-emerald-400 whitespace-nowrap transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                {msg}
              </button>
            ))}
          </div>

          {/* Input Panel Area */}
          <div className="p-3 bg-black/10">
            <form onSubmit={handleSendMessage} className="flex gap-1.5 items-center">
              {/* 📸 Camera/Photo Pick */}
              <button
                type="button"
                disabled={isCompressing}
                onClick={() => fileInputRef.current?.click()}
                className={`w-9 h-9 flex-shrink-0 rounded-xl border flex items-center justify-center transition-all cursor-pointer active:scale-90 ${
                  isCompressing
                    ? "bg-zinc-900 border-zinc-800 text-zinc-700 cursor-not-allowed"
                    : "bg-zinc-900/60 border-zinc-800 hover:border-emerald-900 text-zinc-400 hover:text-emerald-400"
                }`}
              >
                {isCompressing ? (
                  <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
              </button>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handlePhotoSelect} 
                accept="image/*" 
                className="hidden" 
              />

              {/* ✍️ Text Composer */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={selectedRecipient === "All" ? "Kirim ke semua..." : `Bisik rahasia ke ${selectedRecipient}...`}
                className={`flex-1 h-9 bg-[#0b0f0e] border rounded-xl px-3 text-[11px] text-zinc-200 focus:outline-none focus:ring-0 transition-all shadow-inner placeholder:text-zinc-700 ${
                  selectedRecipient === "All" 
                    ? "border-zinc-800/80 focus:border-emerald-900/80" 
                    : "border-indigo-950/70 focus:border-indigo-800/80"
                }`}
              />

              {/* 🚀 Rocket Send Action */}
              <button
                type="submit"
                disabled={!inputText.trim()}
                className={`w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
                  inputText.trim()
                    ? selectedRecipient === "All"
                      ? "bg-emerald-950 border border-emerald-700/60 text-emerald-400 cursor-pointer hover:bg-emerald-900/30"
                      : "bg-indigo-950 border border-indigo-700/60 text-indigo-400 cursor-pointer hover:bg-indigo-900/30"
                    : "bg-zinc-950 border border-zinc-900 text-zinc-700 cursor-not-allowed shadow-none"
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

export default FloatingSocialDeck;

import React from "react";

interface LandingViewProps {
  roomCode: string;
  setRoomCode: (code: string) => void;
  playerName: string;
  setPlayerName: (name: string) => void;
  handleCreateRoom: () => Promise<void>;
  handleJoinRoom: (code: string, name: string) => Promise<void>;
}

const LandingView: React.FC<LandingViewProps> = ({
  roomCode,
  setRoomCode,
  playerName,
  setPlayerName,
  handleCreateRoom,
  handleJoinRoom,
}) => {
  return (
    <div className="max-w-xs w-full bg-black/20 backdrop-blur-md rounded-2xl p-6 text-center relative z-10 border border-zinc-800/60 animate-fade-in">
      <div className="mb-8 flex flex-col items-center">
        <h1 className="text-3xl font-light tracking-[0.25em] text-zinc-100 uppercase">
          Rummy
        </h1>
        <div className="h-[1px] w-12 bg-zinc-700 mt-3 opacity-50" />
      </div>

      <div className="space-y-4">
        <button
          onClick={handleCreateRoom}
          className="w-full py-2.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium tracking-widest transition-all uppercase cursor-pointer"
        >
          Buat Meja
        </button>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-zinc-800/50"></div>
          <span className="flex-shrink mx-3 text-[9px] text-zinc-600 tracking-widest font-mono">
            ATAU
          </span>
          <div className="flex-grow border-t border-zinc-800/50"></div>
        </div>

        <div className="space-y-2.5">
          <input
            type="text"
            placeholder="NAMA KAMU"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-center text-zinc-200 text-xs font-light tracking-widest placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors uppercase"
          />
          <input
            type="text"
            placeholder="KODE ROOM"
            maxLength={4}
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            className="w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-center text-zinc-200 text-xs font-medium tracking-[0.2em] placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors uppercase"
          />
          <button
            onClick={() => handleJoinRoom(roomCode, playerName)}
            className="w-full py-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium tracking-widest transition-all uppercase cursor-pointer"
          >
            Gabung Game
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingView;

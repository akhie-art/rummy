"use client";

/**
 * A lightweight, zero-asset sound engine using Web Audio API
 * to provide tactile audio feedback for game actions.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;

  private initCtx() {
    if (!this.ctx && typeof window !== "undefined") {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx?.state === "suspended") {
      this.ctx.resume();
    }
  }

  // A crisp "click" for drawing or selecting cards
  playClick() {
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  // A slightly lower, "thud" for discarding cards
  playDiscard() {
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  // A celebratory "ding" for winning or melds
  playSuccess() {
    this.initCtx();
    if (!this.ctx) return;

    const playTone = (freq: number, startTime: number) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.4);
    };

    const now = this.ctx.currentTime;
    playTone(523.25, now); // C5
    playTone(659.25, now + 0.1); // E5
    playTone(783.99, now + 0.2); // G5
    playTone(1046.50, now + 0.3); // C6
  }

  // A subtle "pop" for notifications
  playPop() {
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1500, this.ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }
}

export const soundEngine = new SoundEngine();

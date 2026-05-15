class AudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  private init() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  public toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  public getMutedState() {
    return this.isMuted;
  }

  // Generate a short burst of noise (card slide/deal/paper sound)
  private playNoiseBurst(duration: number, frequency: number, type: "highpass" | "bandpass" | "lowpass" = "highpass", volume: number = 0.5) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Fill with white noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;

    // Filter the noise to sound like paper
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;

    // Envelope to make it a quick burst
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    noiseSource.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    noiseSource.start();
  }

  // Synthesize simple tonal beep
  private playTone(frequency: number, type: OscillatorType, duration: number, vol = 0.1) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
    
    gainNode.gain.setValueAtTime(vol, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  public playCardDeal() {
    // Quick paper slide sound
    this.playNoiseBurst(0.12, 4000, "highpass", 0.2);
  }

  public playCardDraw() {
    // Slightly longer/lower slide sound
    this.playNoiseBurst(0.18, 1500, "bandpass", 0.3);
  }

  public playCardDrop() {
    // Sharp snap (mix of low thud and quick noise)
    this.playTone(150, "sine", 0.1, 0.3);
    this.playNoiseBurst(0.05, 5000, "highpass", 0.4);
  }

  public playWin() {
    // Arpeggio up (Triumphant)
    if (this.isMuted) return;
    this.init();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C E G C
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, "sine", 0.4, 0.15), i * 100);
    });
  }

  public playTurnStart() {
    // Subtle ping indicating it's your turn
    this.playTone(880, "sine", 0.3, 0.1);
  }

  public playError() {
    // Low error buzz
    this.playTone(150, "sawtooth", 0.3, 0.1);
  }
}

// Export a singleton instance
export const audio = new AudioEngine();

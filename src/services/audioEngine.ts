class AudioEngine {
  private readonly audio: HTMLAudioElement;
  private baseVolume = 0.8;
  private baseMuted = false;
  private fadeMultiplier = 1;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.applyEffectiveVolume();
  }

  private applyEffectiveVolume(): void {
    const effective = Math.max(
      0,
      Math.min(1, this.baseVolume * this.fadeMultiplier),
    );
    this.audio.volume = effective;
    this.audio.muted = this.baseMuted;
  }

  getElement(): HTMLAudioElement {
    return this.audio;
  }

  getCurrentTime(): number {
    const cur = this.audio.currentTime;
    return Number.isFinite(cur) && cur >= 0 ? cur : 0;
  }

  getDuration(): number {
    const dur = this.audio.duration;
    return Number.isFinite(dur) && dur > 0 ? dur : 0;
  }

  hasSource(): boolean {
    return Boolean(this.audio.currentSrc || this.audio.getAttribute("src"));
  }

  async loadAndPlay(proxyUrl: string): Promise<void> {
    this.audio.pause();
    this.audio.src = proxyUrl;
    this.audio.load();
    await this.play();
  }

  async play(): Promise<void> {
    if (!this.hasSource()) return;
    try {
      await this.audio.play();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Cambio traccia rapido o pausa sopravvenuta: ignora AbortError innocuo.
        return;
      }
      throw err;
    }
  }

  pause(): void {
    this.audio.pause();
  }

  stop(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  seek(seconds: number): void {
    if (!this.hasSource()) return;
    const duration = this.audio.duration;
    const clamped = Number.isFinite(duration) && duration > 0
      ? Math.max(0, Math.min(duration, seconds))
      : Math.max(0, seconds);
    this.audio.currentTime = clamped;
  }

  setVolume(volume: number, muted: boolean): void {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    this.baseMuted = muted;
    this.applyEffectiveVolume();
  }

  setFadeMultiplier(multiplier: number): void {
    this.fadeMultiplier = Number.isFinite(multiplier)
      ? Math.max(0, Math.min(1, multiplier))
      : 1;
    this.applyEffectiveVolume();
  }

  resetFade(): void {
    if (this.fadeMultiplier === 1) return;
    this.fadeMultiplier = 1;
    this.applyEffectiveVolume();
  }

  getBufferedEnd(currentTime: number): number {
    const ranges = this.audio.buffered;
    if (!ranges || ranges.length === 0) return 0;

    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (currentTime >= start - 0.5 && currentTime <= end + 0.5) {
        return end;
      }
    }
    return ranges.end(ranges.length - 1);
  }
}

export const audioEngine = new AudioEngine();

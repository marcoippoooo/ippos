import {
  EqualizerBands,
  EqualizerConfig,
  EqualizerPresetId,
} from "../types/music";

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export const EQUALIZER_BANDS_META: readonly {
  frequency: number;
  label: string;
  shortName: string;
  type: BiquadFilterType;
}[] = [
  { frequency: 60, label: "60Hz", shortName: "Bassi", type: "lowshelf" },
  { frequency: 250, label: "250Hz", shortName: "M-Bassi", type: "peaking" },
  { frequency: 1000, label: "1kHz", shortName: "Medi", type: "peaking" },
  { frequency: 4000, label: "4kHz", shortName: "M-Alti", type: "peaking" },
  { frequency: 12000, label: "12kHz", shortName: "Alti", type: "highshelf" },
];

export const EQUALIZER_PRESETS: Record<
  Exclude<EqualizerPresetId, "custom">,
  { label: string; bands: EqualizerBands }
> = {
  flat: { label: "Flat", bands: [0, 0, 0, 0, 0] },
  bass_boost: { label: "Bass Boost", bands: [6, 4, 0, -1, 1] },
  vocal: { label: "Vocal", bands: [-2, 1, 4, 3, 1] },
  electronic: { label: "Electronic", bands: [5, 2, -1, 3, 5] },
  rock: { label: "Rock", bands: [4, 2, -1, 3, 4] },
};

export interface AudioEngineEventHandlers {
  onLoadStart?: () => void;
  onWaiting?: () => void;
  onLoadedMetadata?: (duration: number) => void;
  onPlaying?: () => void;
  onPause?: (ended: boolean) => void;
  onTimeUpdate?: (currentTime: number, audioDuration: number) => void;
  onProgress?: (bufferedEnd: number) => void;
  onEnded?: () => void;
  onError?: () => void;
}

interface DeckSlot {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
}

function clampDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, db));
  return Math.round(clamped * 2) / 2;
}

function createAudioElement(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.loop = false;
  return el;
}

function buildEqualPowerCurve(from: number, to: number, steps = 32): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    if (to > from) {
      const s = Math.sin(t * (Math.PI / 2));
      curve[i] = from + (to - from) * s;
    } else {
      const c = Math.cos(t * (Math.PI / 2));
      curve[i] = to + (from - to) * c;
    }
  }
  return curve;
}

class AudioEngine {
  private deckA: DeckSlot;
  private deckB: DeckSlot;
  private activeDeck: DeckSlot;
  private standbyDeck: DeckSlot;

  private audioCtx: AudioContext | null = null;
  private mixBus: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private eqRoutingMode: "bypass" | "eq" | null = null;

  private eqConfig: EqualizerConfig = {
    enabled: false,
    preset: "flat",
    bands: [0, 0, 0, 0, 0],
  };

  private baseVolume = 0.8;
  private baseMuted = false;
  private fadeMultiplier = 1;
  private playGeneration = 0;

  private crossfadeGen = 0;
  private crossfadeCleanupTimer: number | null = null;
  private fallbackRafId: number | null = null;

  constructor() {
    this.deckA = { audio: createAudioElement(), source: null, gain: null };
    this.deckB = { audio: createAudioElement(), source: null, gain: null };
    this.activeDeck = this.deckA;
    this.standbyDeck = this.deckB;
    this.applyEffectiveVolume();
  }

  private getAudioContextConstructor(): typeof AudioContext | null {
    if (typeof window === "undefined") return null;
    const win = window as Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    return win.AudioContext ?? win.webkitAudioContext ?? null;
  }

  private ensureAudioGraph(): boolean {
    if (this.audioCtx && this.mixBus && this.masterGain) {
      return true;
    }
    const Ctor = this.getAudioContextConstructor();
    if (!Ctor) return false;

    try {
      const ctx = new Ctor();
      const mixBus = ctx.createGain();
      mixBus.gain.value = 1;

      const masterGain = ctx.createGain();
      const effective = this.computeMasterGainValue();
      masterGain.gain.value = effective;
      masterGain.connect(ctx.destination);

      const filters = EQUALIZER_BANDS_META.map((meta, idx) => {
        const filter = ctx.createBiquadFilter();
        filter.type = meta.type;
        filter.frequency.value = meta.frequency;
        if (meta.type === "peaking") {
          filter.Q.value = 1.0;
        }
        filter.gain.value = this.eqConfig.bands[idx] ?? 0;
        return filter;
      });

      for (let i = 0; i < filters.length - 1; i++) {
        filters[i].connect(filters[i + 1]);
      }

      const initDeck = (deck: DeckSlot, initialGain: number) => {
        deck.audio.volume = 1;
        deck.audio.muted = false;
        const source = ctx.createMediaElementSource(deck.audio);
        const gain = ctx.createGain();
        gain.gain.value = initialGain;
        source.connect(gain);
        gain.connect(mixBus);
        deck.source = source;
        deck.gain = gain;
      };

      initDeck(this.activeDeck, 1);
      initDeck(this.standbyDeck, 0);

      this.audioCtx = ctx;
      this.mixBus = mixBus;
      this.masterGain = masterGain;
      this.eqFilters = filters;
      this.eqRoutingMode = null;
      this.applyEqualizerRouting();
      return true;
    } catch {
      this.audioCtx = null;
      this.mixBus = null;
      this.masterGain = null;
      this.eqFilters = [];
      this.eqRoutingMode = null;
      return false;
    }
  }

  private applyEqualizerRouting(): void {
    if (!this.mixBus || !this.masterGain || this.eqFilters.length === 0) {
      return;
    }

    const desiredMode = this.eqConfig.enabled ? "eq" : "bypass";
    if (this.eqRoutingMode === desiredMode) {
      return;
    }

    try {
      this.mixBus.disconnect();
    } catch {
      // ignore disconnect when not connected
    }
    const lastFilter = this.eqFilters[this.eqFilters.length - 1];
    try {
      lastFilter.disconnect();
    } catch {
      // ignore disconnect when not connected
    }

    if (desiredMode === "eq") {
      this.mixBus.connect(this.eqFilters[0]);
      lastFilter.connect(this.masterGain);
    } else {
      this.mixBus.connect(this.masterGain);
    }
    this.eqRoutingMode = desiredMode;
  }

  private syncFilterGains(): void {
    if (!this.audioCtx || this.eqFilters.length === 0) return;
    const now = this.audioCtx.currentTime;
    for (let i = 0; i < this.eqFilters.length; i++) {
      const gainVal = this.eqConfig.bands[i] ?? 0;
      const param = this.eqFilters[i].gain;
      try {
        param.setTargetAtTime(gainVal, now, 0.015);
      } catch {
        param.value = gainVal;
      }
    }
  }

  private async resumeContext(): Promise<void> {
    this.ensureAudioGraph();
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      try {
        await this.audioCtx.resume();
      } catch {
        // ignore if gesture restriction prevents immediate resume
      }
    }
  }

  private computeMasterGainValue(): number {
    if (this.baseMuted) return 0;
    return Math.max(0, Math.min(1, this.baseVolume * this.fadeMultiplier));
  }

  private applyEffectiveVolume(): void {
    const effective = this.computeMasterGainValue();
    if (this.audioCtx && this.masterGain) {
      try {
        this.masterGain.gain.setTargetAtTime(
          effective,
          this.audioCtx.currentTime,
          0.015,
        );
      } catch {
        this.masterGain.gain.value = effective;
      }
      this.activeDeck.audio.volume = 1;
      this.activeDeck.audio.muted = false;
      this.standbyDeck.audio.volume = 1;
      this.standbyDeck.audio.muted = false;
      return;
    }

    this.activeDeck.audio.volume = Math.max(
      0,
      Math.min(1, this.baseVolume * this.fadeMultiplier),
    );
    this.activeDeck.audio.muted = this.baseMuted;
  }

  private cancelOutgoingFade(): void {
    this.crossfadeGen += 1;
    if (this.crossfadeCleanupTimer !== null) {
      window.clearTimeout(this.crossfadeCleanupTimer);
      this.crossfadeCleanupTimer = null;
    }
    if (this.fallbackRafId !== null) {
      window.cancelAnimationFrame(this.fallbackRafId);
      this.fallbackRafId = null;
    }

    if (this.audioCtx && this.activeDeck.gain && this.standbyDeck.gain) {
      const now = this.audioCtx.currentTime;
      try {
        this.activeDeck.gain.gain.cancelScheduledValues(now);
        this.activeDeck.gain.gain.setValueAtTime(1, now);
        this.standbyDeck.gain.gain.cancelScheduledValues(now);
        this.standbyDeck.gain.gain.setValueAtTime(0, now);
      } catch {
        this.activeDeck.gain.gain.value = 1;
        this.standbyDeck.gain.gain.value = 0;
      }
    }

    this.standbyDeck.audio.pause();
    this.standbyDeck.audio.removeAttribute("src");
    this.standbyDeck.audio.load();
    this.applyEffectiveVolume();
  }

  getElement(): HTMLAudioElement {
    return this.activeDeck.audio;
  }

  subscribeEvents(handlers: AudioEngineEventHandlers): () => void {
    const attach = (deck: DeckSlot) => {
      const el = deck.audio;
      const isActive = () => deck === this.activeDeck;

      const onLoadStart = () => {
        if (isActive()) handlers.onLoadStart?.();
      };
      const onWaiting = () => {
        if (isActive()) handlers.onWaiting?.();
      };
      const onLoadedMetadata = () => {
        if (!isActive()) return;
        const dur = el.duration;
        if (Number.isFinite(dur) && dur > 0) {
          handlers.onLoadedMetadata?.(dur);
        }
      };
      const onPlaying = () => {
        if (isActive()) handlers.onPlaying?.();
      };
      const onPause = () => {
        if (isActive()) handlers.onPause?.(el.ended);
      };
      const onTimeUpdate = () => {
        if (!isActive()) return;
        const cur = Number.isFinite(el.currentTime) && el.currentTime >= 0 ? el.currentTime : 0;
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
        handlers.onTimeUpdate?.(cur, dur);
      };
      const onProgress = () => {
        if (!isActive()) return;
        const cur = Number.isFinite(el.currentTime) && el.currentTime >= 0 ? el.currentTime : 0;
        handlers.onProgress?.(this.getBufferedEnd(cur));
      };
      const onEnded = () => {
        if (isActive()) handlers.onEnded?.();
      };
      const onError = () => {
        if (isActive()) handlers.onError?.();
      };

      el.addEventListener("loadstart", onLoadStart);
      el.addEventListener("waiting", onWaiting);
      el.addEventListener("loadedmetadata", onLoadedMetadata);
      el.addEventListener("durationchange", onLoadedMetadata);
      el.addEventListener("playing", onPlaying);
      el.addEventListener("pause", onPause);
      el.addEventListener("timeupdate", onTimeUpdate);
      el.addEventListener("progress", onProgress);
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onError);

      return () => {
        el.removeEventListener("loadstart", onLoadStart);
        el.removeEventListener("waiting", onWaiting);
        el.removeEventListener("loadedmetadata", onLoadedMetadata);
        el.removeEventListener("durationchange", onLoadedMetadata);
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("pause", onPause);
        el.removeEventListener("timeupdate", onTimeUpdate);
        el.removeEventListener("progress", onProgress);
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
      };
    };

    const detachA = attach(this.deckA);
    const detachB = attach(this.deckB);
    return () => {
      detachA();
      detachB();
    };
  }

  getCurrentTime(): number {
    const cur = this.activeDeck.audio.currentTime;
    return Number.isFinite(cur) && cur >= 0 ? cur : 0;
  }

  getDuration(): number {
    const dur = this.activeDeck.audio.duration;
    return Number.isFinite(dur) && dur > 0 ? dur : 0;
  }

  hasSource(): boolean {
    const el = this.activeDeck.audio;
    return Boolean(el.currentSrc || el.getAttribute("src"));
  }

  isEnded(): boolean {
    return this.activeDeck.audio.ended;
  }

  isPaused(): boolean {
    return this.activeDeck.audio.paused;
  }

  loadSource(proxyUrl: string): void {
    this.playGeneration += 1;
    this.cancelOutgoingFade();
    const el = this.activeDeck.audio;
    el.pause();
    el.loop = false;
    const sameSrc = el.currentSrc === proxyUrl;
    el.src = proxyUrl;
    if (sameSrc) {
      el.load();
    }
  }

  async loadAndPlay(proxyUrl: string): Promise<void> {
    const gen = ++this.playGeneration;
    this.cancelOutgoingFade();
    await this.resumeContext();

    const el = this.activeDeck.audio;
    el.pause();
    el.loop = false;
    const sameSrc = el.currentSrc === proxyUrl;
    el.src = proxyUrl;
    if (sameSrc) {
      el.load();
    }

    try {
      await el.play();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (this.playGeneration !== gen) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.playGeneration !== gen) {
          return;
        }
        await el.play();
        return;
      }
      throw err;
    }
  }

  async crossfadeTo(proxyUrl: string, durationSec: number): Promise<void> {
    const safeDuration = Math.max(0.25, Math.min(8, durationSec));
    const gen = ++this.playGeneration;
    this.cancelOutgoingFade();
    const fadeGen = ++this.crossfadeGen;

    const hasGraph = this.ensureAudioGraph();
    await this.resumeContext();

    const incoming = this.standbyDeck;
    const outgoing = this.activeDeck;

    if (hasGraph && this.audioCtx && incoming.gain) {
      const now = this.audioCtx.currentTime;
      try {
        incoming.gain.gain.cancelScheduledValues(now);
        incoming.gain.gain.setValueAtTime(0, now);
      } catch {
        incoming.gain.gain.value = 0;
      }
    } else {
      incoming.audio.volume = 0;
      incoming.audio.muted = this.baseMuted;
    }

    incoming.audio.pause();
    incoming.audio.loop = false;
    const sameSrc = incoming.audio.currentSrc === proxyUrl;
    incoming.audio.src = proxyUrl;
    if (sameSrc) {
      incoming.audio.load();
    }

    try {
      await incoming.audio.play();
    } catch (err: unknown) {
      incoming.audio.pause();
      incoming.audio.removeAttribute("src");
      incoming.audio.load();
      throw err;
    }

    if (this.playGeneration !== gen || this.crossfadeGen !== fadeGen) {
      incoming.audio.pause();
      incoming.audio.removeAttribute("src");
      incoming.audio.load();
      return;
    }

    // Swap immediato: i nuovi eventi timeupdate/metadata arrivano dal brano entrante
    this.activeDeck = incoming;
    this.standbyDeck = outgoing;

    if (
      hasGraph &&
      this.audioCtx &&
      incoming.gain &&
      outgoing.gain
    ) {
      const now = this.audioCtx.currentTime;
      const outStart = outgoing.gain.gain.value;
      const outCurve = buildEqualPowerCurve(outStart, 0, 32);
      const inCurve = buildEqualPowerCurve(0, 1, 32);

      try {
        outgoing.gain.gain.cancelScheduledValues(now);
        outgoing.gain.gain.setValueCurveAtTime(outCurve, now, safeDuration);
        incoming.gain.gain.cancelScheduledValues(now);
        incoming.gain.gain.setValueCurveAtTime(inCurve, now, safeDuration);
      } catch {
        outgoing.gain.gain.setValueAtTime(outStart, now);
        outgoing.gain.gain.linearRampToValueAtTime(0, now + safeDuration);
        incoming.gain.gain.setValueAtTime(0, now);
        incoming.gain.gain.linearRampToValueAtTime(1, now + safeDuration);
      }
    } else {
      const startMs = performance.now();
      const durationMs = safeDuration * 1000;
      const step = (nowMs: number) => {
        if (this.crossfadeGen !== fadeGen) return;
        const t = Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
        const inAmp = Math.sin(t * (Math.PI / 2));
        const outAmp = Math.cos(t * (Math.PI / 2));
        const targetMaster = this.computeMasterGainValue();
        incoming.audio.volume = Math.max(0, Math.min(1, targetMaster * inAmp));
        incoming.audio.muted = this.baseMuted;
        outgoing.audio.volume = Math.max(0, Math.min(1, targetMaster * outAmp));
        outgoing.audio.muted = this.baseMuted;
        if (t < 1) {
          this.fallbackRafId = window.requestAnimationFrame(step);
        } else {
          this.fallbackRafId = null;
        }
      };
      this.fallbackRafId = window.requestAnimationFrame(step);
    }

    this.crossfadeCleanupTimer = window.setTimeout(() => {
      if (this.crossfadeGen !== fadeGen) return;
      this.crossfadeCleanupTimer = null;
      outgoing.audio.pause();
      outgoing.audio.removeAttribute("src");
      outgoing.audio.load();
      if (this.audioCtx && outgoing.gain) {
        try {
          outgoing.gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        } catch {
          outgoing.gain.gain.value = 0;
        }
      }
    }, Math.round(safeDuration * 1000) + 80);
  }

  async restart(): Promise<boolean> {
    this.resetFade();
    this.cancelOutgoingFade();
    if (!this.hasSource()) {
      return false;
    }
    await this.resumeContext();
    const gen = ++this.playGeneration;
    const el = this.activeDeck.audio;
    try {
      el.loop = false;
      el.currentTime = 0;
      await el.play();
      if (this.playGeneration !== gen) {
        return true;
      }
      return !el.paused;
    } catch {
      return false;
    }
  }

  async play(): Promise<void> {
    if (!this.hasSource()) return;
    await this.resumeContext();
    try {
      await this.activeDeck.audio.play();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Cambio traccia rapido o pausa sopravvenuta: ignora AbortError innocuo.
        return;
      }
      throw err;
    }
  }

  pause(): void {
    this.cancelOutgoingFade();
    this.activeDeck.audio.pause();
  }

  stop(): void {
    this.cancelOutgoingFade();
    const el = this.activeDeck.audio;
    el.pause();
    el.removeAttribute("src");
    el.load();
  }

  seek(seconds: number): void {
    if (!this.hasSource()) return;
    this.cancelOutgoingFade();
    const el = this.activeDeck.audio;
    const duration = el.duration;
    const clamped =
      Number.isFinite(duration) && duration > 0
        ? Math.max(0, Math.min(duration, seconds))
        : Math.max(0, seconds);
    el.currentTime = clamped;
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

  setEqualizerEnabled(enabled: boolean): void {
    this.eqConfig = { ...this.eqConfig, enabled };
    if (this.audioCtx) {
      this.applyEqualizerRouting();
    }
  }

  setEqualizerBandGain(bandIndex: number, gainDb: number): void {
    if (bandIndex < 0 || bandIndex >= 5) return;
    const clamped = clampDb(gainDb);
    const nextBands: EqualizerBands = [...this.eqConfig.bands] as EqualizerBands;
    nextBands[bandIndex] = clamped;
    this.eqConfig = {
      ...this.eqConfig,
      preset: "custom",
      bands: nextBands,
    };
    this.syncFilterGains();
  }

  setEqualizerBands(bands: EqualizerBands): void {
    const nextBands: EqualizerBands = [
      clampDb(bands[0]),
      clampDb(bands[1]),
      clampDb(bands[2]),
      clampDb(bands[3]),
      clampDb(bands[4]),
    ];
    this.eqConfig = {
      ...this.eqConfig,
      bands: nextBands,
    };
    this.syncFilterGains();
  }

  applyEqualizerConfig(config: EqualizerConfig): void {
    const nextBands: EqualizerBands = [
      clampDb(config.bands[0]),
      clampDb(config.bands[1]),
      clampDb(config.bands[2]),
      clampDb(config.bands[3]),
      clampDb(config.bands[4]),
    ];
    this.eqConfig = {
      enabled: config.enabled,
      preset: config.preset,
      bands: nextBands,
    };
    this.syncFilterGains();
    if (this.audioCtx) {
      this.applyEqualizerRouting();
    }
  }

  getEqualizerConfig(): EqualizerConfig {
    return {
      enabled: this.eqConfig.enabled,
      preset: this.eqConfig.preset,
      bands: [...this.eqConfig.bands] as EqualizerBands,
    };
  }

  getBufferedEnd(currentTime: number): number {
    const ranges = this.activeDeck.audio.buffered;
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

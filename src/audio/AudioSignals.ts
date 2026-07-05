/** AudioSignals — FAR MODE audio is primary. The phone is 2–3m away and
 *  untouchable, so state is carried by sound:
 *    tick()   — short click per counted rep
 *    buzz()   — harsh buzz on a "NOT COUNTED" fault
 *    startPausedTone()/stopPausedTone() — sustained tone while a hold-clock
 *                                          is paused (used by plank/stillness)
 *  All synthesized with the Web Audio API — no asset files. Must be resume()d
 *  from a user gesture (browsers start the AudioContext suspended). */
export class AudioSignals {
  private ctx: AudioContext | null = null;
  private pausedOsc: OscillatorNode | null = null;
  private pausedGain: GainNode | null = null;
  private pausedLfo: OscillatorNode | null = null;

  /** Call from a click/tap. Creates (or resumes) the AudioContext. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Short, bright click — one counted rep. */
  tick(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.04);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Harsh, low buzz — a rep was rejected (SHALLOW — NOT COUNTED). */
  buzz(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.linearRampToValueAtTime(90, t + 0.28);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
    gain.gain.setValueAtTime(0.55, t + 0.24);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  /** NEAR MODE cue — a soft chime when a still/hold clock pauses. The user may
   *  have their eyes closed (stillness), so audio carries the state change. */
  pausedCue(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.linearRampToValueAtTime(495, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** NEAR MODE cue — a low, calm tone when the clock resumes counting. */
  resumedCue(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(196, t);
    osc.frequency.linearRampToValueAtTime(262, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  /** Begin the paused signal (hold-clock paused). Idempotent.
   *  A slow PULSE, not a flat drone — a 2Hz tremolo on a low sine reads as
   *  "warning, fix it" without drilling into the ears when a pause runs long. */
  startPausedTone(): void {
    if (!this.ctx || this.pausedOsc) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(196, t);
    // carrier level ramps in low…
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.15);
    // …and a 2Hz LFO swings it between near-silent and ~0.2
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(2, t);
    lfoGain.gain.setValueAtTime(0.09, t);
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start(t);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    this.pausedOsc = osc;
    this.pausedGain = gain;
    this.pausedLfo = lfo;
  }

  /** Stop the paused signal. Idempotent. */
  stopPausedTone(): void {
    if (!this.ctx || !this.pausedOsc || !this.pausedGain) return;
    const t = this.now();
    this.pausedGain.gain.cancelScheduledValues(t);
    this.pausedGain.gain.setValueAtTime(Math.max(this.pausedGain.gain.value, 0.0001), t);
    this.pausedGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    this.pausedOsc.stop(t + 0.1);
    this.pausedLfo?.stop(t + 0.1);
    this.pausedOsc = null;
    this.pausedGain = null;
    this.pausedLfo = null;
  }

  /** Personal record falls mid-session — a rising major triad, unmistakably
   *  different from the rep tick. */
  record(): void {
    if (!this.ctx) return;
    const t = this.now();
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const at = t + i * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(this.ctx!.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
  }

  /** Release everything (call on session end). */
  dispose(): void {
    this.stopPausedTone();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** App-wide singleton. The AudioContext must be unlocked from a user gesture,
 *  and in FAR MODE the user's last gesture is the BEGIN tap on the pre-session
 *  screen — before the session component exists. A shared instance lets that
 *  tap unlock the context the session will later play through. */
export const audioSignals = new AudioSignals();

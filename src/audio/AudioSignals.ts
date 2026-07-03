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

  /** Begin a sustained tone (hold-clock paused). Idempotent. */
  startPausedTone(): void {
    if (!this.ctx || this.pausedOsc) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    this.pausedOsc = osc;
    this.pausedGain = gain;
  }

  /** Stop the sustained paused tone. Idempotent. */
  stopPausedTone(): void {
    if (!this.ctx || !this.pausedOsc || !this.pausedGain) return;
    const t = this.now();
    this.pausedGain.gain.cancelScheduledValues(t);
    this.pausedGain.gain.setValueAtTime(this.pausedGain.gain.value, t);
    this.pausedGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    this.pausedOsc.stop(t + 0.1);
    this.pausedOsc = null;
    this.pausedGain = null;
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

import type { GameEvent } from '../../shared/game';

class AudioFeedback {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = 0;
  volume = 0.45;
  muted = false;
  onError: (message: string) => void = () => {};

  async unlock() {
    if (this.muted) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended' && !document.hidden) await this.context.resume();
      this.master!.gain.value = this.volume;
    } catch (error) {
      console.error('Audio could not start.', error);
      this.onError('Sound could not start. Try the sound button again, or continue quietly.');
    }
  }
  quiet() {
    if (this.master) this.master.gain.value = 0;
    if (this.context?.state === 'running') {
      void this.context.suspend().catch(error => {
        console.error('Could not suspend sound.', error);
        this.onError('Sound could not pause. Use mute to silence effects.');
      });
    }
  }
  tone(frequency: number, duration = 0.1, delay = 0, type: OscillatorType = 'sine', end?: number) {
    const ctx = this.context;
    if (this.muted || document.hidden || !ctx || ctx.state !== 'running' || !this.master || this.voices >= 12) return;
    this.master.gain.value = this.volume;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const time = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.12, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain); gain.connect(this.master);
    this.voices++;
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.voices--; };
    osc.start(time); osc.stop(time + duration + 0.01);
  }
  turn() {
    [587, 784, 988].forEach((f, i) => this.tone(f, 0.16, i * 0.09, 'triangle'));
  }
  play(type: GameEvent['type']) {
    if (type === 'roll') [0, 0.055, 0.12, 0.2].forEach((delay, i) => this.tone(240 + i * 35, 0.04, delay, 'triangle', 90));
    if (type === 'move') this.tone(430, 0.065, 0, 'sine', 570);
    if (type === 'ladder') [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.14, i * 0.065));
    if (type === 'snake') this.tone(430, 0.35, 0, 'triangle', 120);
    if (type === 'capture') { this.tone(180, 0.1, 0, 'triangle', 80); this.tone(740, 0.1, 0.08); }
    if (type === 'home') [520, 660].forEach((f, i) => this.tone(f, 0.15, i * 0.08));
    if (type === 'win') [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, i * 0.12, 'triangle'));
  }
}
export const audio = new AudioFeedback();

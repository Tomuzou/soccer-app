/**
 * WebAudio で合成する効果音モジュール。音源ファイルを持たず全てその場で生成する。
 * AudioContext はブラウザの自動再生制限を避けるため、最初のキック（ユーザー操作起点）で
 * 遅延生成する。各メソッドは短い間隔での連打を内部でスロットリングする。
 */
export class Sfx {
  private muted = false;

  setMuted(muted: boolean): void { this.muted = muted; }

  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 効果音ごとの最終再生時刻（スロットリング用） */
  private lastPlay = new Map<string, number>();

  /** AudioContext を必要になった時点で生成・再開する */
  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** minInterval 秒以内の連打を弾く。再生可なら ctx を返す */
  private gate(key: string, minInterval: number): AudioContext | null {
    if (this.muted) return null;
    const ctx = this.ensure();
    if (!ctx) return null;
    const now = ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -Infinity;
    if (now - last < minInterval) return null;
    this.lastPlay.set(key, now);
    return ctx;
  }

  /** ホワイトノイズのバッファを作る */
  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** キック音：低い「ドンッ」（パワーで音量・重さが変わる） */
  kick(power: number): void {
    const ctx = this.gate('kick', 0.05);
    if (!ctx) return;
    const t = ctx.currentTime;
    const vol = 0.4 + power * 0.5;

    // 胴：サイン波のピッチ落ち
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 - power * 30, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.18);

    // 蹴った瞬間の「パスッ」というノイズ
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 0.05);
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 2500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(nf).connect(ng).connect(this.master!);
    noise.start(t);
  }

  /** ポスト・バー音：金属の「カーン」 */
  post(): void {
    const ctx = this.gate('post', 0.08);
    if (!ctx) return;
    const t = ctx.currentTime;
    // 倍音関係にない周波数を重ねると金属っぽい響きになる
    for (const [freq, vol] of [
      [2350, 0.28],
      [3571, 0.16],
      [5232, 0.08],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.55);
    }
  }

  /** バウンド音：地面・障害物に当たった「ボスッ」（強さは衝突速度で調整） */
  bounce(intensity: number): void {
    const k = Math.min(1, Math.max(0, intensity));
    if (k < 0.08) return; // 弱すぎる接触は鳴らさない（転がり中の連続接触対策）
    const ctx = this.gate('bounce', 0.09);
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** ネット音：柔らかい「シャッ」というこすれ音 */
  net(): void {
    const ctx = this.gate('net', 0.3);
    if (!ctx) return;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 0.22);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    noise.connect(bp).connect(g).connect(this.master!);
    noise.start(t);
  }

  /** ゴール音：観衆の歓声（フィルタしたノイズのうねり） */
  goal(): void {
    const ctx = this.gate('goal', 0.5);
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 2.2;

    // 歓声の主体：バンドパスノイズが盛り上がって減衰する
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(1300, t + 0.3);
    bp.frequency.linearRampToValueAtTime(800, t + dur);
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.18);
    g.gain.setValueAtTime(0.5, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(bp).connect(g).connect(this.master!);
    noise.start(t);

    // 低域のどよめきを重ねて厚みを出す
    const low = ctx.createBufferSource();
    low.buffer = this.noiseBuffer(ctx, dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0.001, t);
    lg.gain.exponentialRampToValueAtTime(0.3, t + 0.25);
    lg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    low.connect(lp).connect(lg).connect(this.master!);
    low.start(t);
  }

  /** ステージクリアのホイッスル（ピッ・ピッ・ピーッ） */
  whistle(): void {
    const ctx = this.gate('whistle', 0.5);
    if (!ctx) return;
    const t = ctx.currentTime;
    const beeps: [number, number][] = [
      [0, 0.12],
      [0.22, 0.12],
      [0.44, 0.5],
    ];
    for (const [offset, len] of beeps) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 2100;
      // ホイッスルらしい揺らぎ（ビブラート）
      const vib = ctx.createOscillator();
      vib.frequency.value = 30;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 60;
      vib.connect(vibGain).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t + offset);
      g.gain.setValueAtTime(0.12, t + offset + len - 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + len);
      osc.connect(g).connect(this.master!);
      osc.start(t + offset);
      osc.stop(t + offset + len + 0.02);
      vib.start(t + offset);
      vib.stop(t + offset + len + 0.02);
    }
  }
}

/**
 * Minimal, structurally-faithful WebAudio fake for node environments.
 * It tracks every created node (so per-frame creation is detectable), records
 * automation calls, and mirrors the connect/disconnect topology — enough to
 * smoke-test graph construction and node-count stability without a browser.
 */

export class FakeAudioParam {
  value = 0;
  events: Array<Record<string, unknown>> = [];
  constructor(
    public kind: string,
    initial = 0,
  ) {
    this.value = initial;
  }
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
  setValueCurveAtTime(v: ArrayLike<number>, startTime: number, duration: number): this {
    this.events.push({ kind: 'curve', length: v.length, startTime, duration });
    return this;
  }
}

export class FakeAudioNode {
  connections: FakeAudioNode[] = [];
  disconnected = false;
  constructor(
    public ctx: FakeAudioContext,
    public kind: string,
    public params: Record<string, FakeAudioParam> = {},
  ) {
    // Expose params as direct properties (node.gain, node.frequency, ...).
    Object.assign(this, params);
  }
  get context(): FakeAudioContext {
    return this.ctx;
  }
  connect(dest: FakeAudioNode | { destination?: unknown }): FakeAudioNode {
    if (dest instanceof FakeAudioNode) this.connections.push(dest);
    else this.connections.push(dest as FakeAudioNode);
    return dest as FakeAudioNode;
  }
  disconnect(): void {
    this.disconnected = true;
    this.connections = [];
  }
}

export class FakeOscillator extends FakeAudioNode {
  type = 'sine';
  frequency: FakeAudioParam;
  detune: FakeAudioParam;
  started = false;
  stopped = false;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'oscillator', {});
    this.frequency = new FakeAudioParam('frequency', 440);
    this.detune = new FakeAudioParam('detune', 0);
    this.params.frequency = this.frequency;
    this.params.detune = this.detune;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeBufferSource extends FakeAudioNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'bufferSource');
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeBuffer {
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  private data: Float32Array[] = [];
  getChannelData(ch: number): Float32Array {
    while (this.data.length <= ch) this.data.push(new Float32Array(this.length));
    return this.data[ch]!;
  }
}

export class FakeAudioContext {
  sampleRate = 48000;
  private _t = 0;
  currentTime = 0;
  state = 'running';
  destination: FakeAudioNode;
  /** Every node ever created — the per-frame-creation detector. */
  created: FakeAudioNode[] = [];

  constructor() {
    this.destination = new FakeAudioNode(this, 'destination');
  }

  /** Advance the clock (fake contexts have no render quantum). */
  advance(seconds: number): void {
    this._t += seconds;
    this.currentTime = this._t;
  }

  createOscillator(): FakeOscillator {
    const n = new FakeOscillator(this);
    this.created.push(n);
    return n;
  }
  createBufferSource(): FakeBufferSource {
    const n = new FakeBufferSource(this);
    this.created.push(n);
    return n;
  }
  createGain(): GainNode {
    const n = new FakeAudioNode(this, 'gain', {
      gain: new FakeAudioParam('gain', 1),
    });
    this.created.push(n);
    return n as unknown as GainNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    const n = new FakeAudioNode(this, 'biquadFilter', {
      frequency: new FakeAudioParam('frequency', 350),
      Q: new FakeAudioParam('Q', 1),
      gain: new FakeAudioParam('gain', 0),
    });
    this.created.push(n);
    return n as unknown as BiquadFilterNode;
  }
  createStereoPanner(): StereoPannerNode {
    const n = new FakeAudioNode(this, 'stereoPanner', {
      pan: new FakeAudioParam('pan', 0),
    });
    this.created.push(n);
    return n as unknown as StereoPannerNode;
  }
  createDynamicsCompressor(): DynamicsCompressorNode {
    const n = new FakeAudioNode(this, 'dynamicsCompressor', {
      threshold: new FakeAudioParam('threshold', -24),
      knee: new FakeAudioParam('knee', 30),
      ratio: new FakeAudioParam('ratio', 12),
      attack: new FakeAudioParam('attack', 0.003),
      release: new FakeAudioParam('release', 0.25),
    });
    this.created.push(n);
    return n as unknown as DynamicsCompressorNode;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }
}

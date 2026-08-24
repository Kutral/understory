# Performance Budget (hard gates, measured not assumed)

Target: 1080p, 60fps sustained on a mid-range 2023 laptop iGPU at **Medium** tier.

| Budget | Limit |
|---|---|
| Frame total | ≤16.6ms |
| CPU sim | ≤4ms |
| Physics | ≤2ms |
| Render submit | ≤6ms |
| UI | ≤1ms |
| Draw calls | ≤150 typical, ≤220 worst case |
| Frame-loop allocations | zero |
| Shader compiles after loading | zero (warm every pipeline up front) |
| Chunk streaming spike | never above 24ms |
| Initial JS+WASM | <1.5MB gzipped |
| Assets | <6MB total (KTX2 textures, Draco/meshopt meshes only) |
| First interactive | <3s on cable |
| Heap drift | flat over 10 minutes (±15%), proven by leak test |

## Wave 1.5 gate (blocking)

Vertical slice measured on CPU-throttled 4x profile, GPU-limited settings:
p99 ≤20ms over 3-minute continuous drive, zero post-load shader compiles.
Recorded in `docs/PERF.md` with p50/p99/worst-frame/draw-calls/triangles/instances/
heap t0+t180/first-interactive/post-load-compiles.

## Flora budget (Wave 2 corrected)

Trees in view: **≤80 full-detail, ≤400 mid-LOD, remainder impostors.**
Undergrowth: ~200k grass blades within 30m across three rings.
Total draw calls with full forest: <150.

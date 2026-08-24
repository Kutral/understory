# Vendored fonts

Self-hosted subset woff2 files (latin subset, Fontsource builds), referenced by
`src/styles/fonts.css` with `font-display: swap` and metric-matched fallbacks.

| File | Family | Weight/Style | Size |
|---|---|---|---|
| `vollkorn-latin-600.woff2` | Vollkorn | 600 normal | 27 KB |
| `vollkorn-latin-600-italic.woff2` | Vollkorn | 600 italic | 27 KB |
| `instrument-sans-latin-400.woff2` | Instrument Sans | 400 normal | 17 KB |
| `instrument-sans-latin-500.woff2` | Instrument Sans | 500 normal | 17 KB |
| `martian-mono-latin-400.woff2` | Martian Mono | 400 normal | 10 KB |

**None missing** — all five faces the UI shell uses are vendored.

Fallback metrics were measured from the actual vendored files with fontTools
(upem / hhea ascent+descent / OS/2 xAvgCharWidth) and matched against the local
system stand-ins (Georgia, Segoe UI, Consolas); see the override block in
`src/styles/fonts.css`.

Note on paths: `fonts.css` references the files with a relative
`../../public/fonts/...` URL so both the dev server and `vite build` resolve
them under the site's configured `base` (`/understory/`). If the build ever
warns about public-dir assets, switch to absolute `/fonts/...` URLs — those are
rewritten with base at build time but not in dev.

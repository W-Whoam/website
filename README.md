# who.ulus.me

Static Astro site. Everything runs in the browser; Cloudflare serves the built files.

| Route | What |
| --- | --- |
| `/` | "soon" |
| `/are-you-a-human-pale-guy` | Pale Visitor ("Yalnız mısın?") meme maker |
| anything else | 404 page |

SEO: every page sets title, description, canonical URL, Open Graph/Twitter tags and JSON-LD through
`src/layouts/Base.astro`. `@astrojs/sitemap` writes `sitemap-index.xml` at build time; `public/robots.txt` points to it.
The meme page's share image is `public/pale-guy/og.jpg` (1200×630).

## Develop

```sh
bun install
bun run dev       # http://localhost:4321
bun run build     # -> dist/
bun run preview   # build, then serve it in Cloudflare's local runtime (wrangler dev)
```

## Deploy (Cloudflare Workers, static assets only)

Same flow as the Ulus Studio site, minus the bindings: there is no Worker script, D1, R2 or adapter.
`wrangler.jsonc` only points Cloudflare at `dist/`. Free plan; static asset requests are not billed.

1. Dashboard → **Workers & Pages** → **Create** → **Import a repository** → this repo.
2. Deploy command `bunx wrangler deploy` (it runs `bun run build` itself via `build.command`, so the build command
   field can stay empty). Every push to `main` redeploys.
   The `name` in `wrangler.jsonc` (`whoam-website`) must match the Worker's name in the dashboard, or the build fails.
   Bun is pinned with `packageManager` in `package.json`; keep it equal to the Bun that wrote `bun.lock`, since
   older Bun cannot read newer lockfiles.
3. Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `who.ulus.me`.

From a terminal instead: `bunx wrangler login`, then `bun run deploy`.

Routing (`wrangler.jsonc`): `/are-you-a-human-pale-guy` redirects to the trailing-slash URL, unknown paths get
`404.html` with a 404 status. Cache headers live in `public/_headers`: hashed `/_astro/*` files and fonts are cached
for a year, images for a day, JSON and HTML revalidate on every visit.

## Meme maker

Source in `src/pale/`, static assets in `public/pale-guy/`.

- `model.json`: the fitted text model. Each text slot (dialogue line, two-line dialogue, answer boxes in each state) holds
  the perspective plane (`params`: x, y, rotation, shear, scale, perspective), glow colours (`coefs`: core + 2.5/10/24 px
  glows per RGB channel) and the original text it was fitted on. `falloff` is the darker strip on the right of the
  game's view.
- `img/`: clean background plates with the game text removed. `base` (grin) plus patches for the other faces and the
  three answer-box states, and the empty doorway.
- `variations.json`: what a first-time visitor sees. Replace it with your own export to change the defaults.
- `examples/uluslu-taslak.json`: pack to import in the editor. Variations whose id starts with `w` are Whoam's
  (his question and answers, other lines from the game); `c` and `r` ones are Claude's drafts.

### Variation JSON

```json
{
  "format": "pale-guy-meme",
  "version": 1,
  "variations": [
    {
      "id": "w1-yalnizim",
      "name": "Uluslu musun?",
      "notes": "optional",
      "lines": {
        "open": "Pekiiiii...",
        "question": "Uluslu musun?",
        "left": "Evet, Ulusluyum",
        "right": "Hayır, yalnızım",
        "reply": "Şanslı günündesin.",
        "whisper": "İçeriden fısıltı sesi geliyor.",
        "close": "Tabii, birkaç gün sonra nerede olurlar\nbilemiyorum."
      },
      "scenes": [
        { "face": "smirk", "text": "{open}", "answers": "hidden", "duration": 2 }
      ]
    }
  ]
}
```

- `face`: `smirk` | `grin` | `stare` | `door`
- `answers`: `hidden` | `none` | `left` | `right` (which box is highlighted; `left` shows `lines.left`)
- `text`: free text; `{open}` `{question}` `{left}` `{right}` `{reply}` `{whisper}` `{close}` pull in the lines; `\n` makes
  a second line (max 2).
- `scenes` is optional; without it the ~18 s template from the original clip is used.
- Importing a file whose ids already exist updates those variations instead of duplicating them.

Share links put the whole variation in the URL hash (`#v=…`), so nothing is stored anywhere.

Film effect (`film` in `model.json`, `src/pale/film.ts`): a light flicker on the source clip's measured per-frame
pattern (30 fps). `matrix` sets the second state (now 4% darker, no colour shift) and `grain` the moving grain
strength (0-1) in preview and video.
The GIF gets the flicker only (10 fps, 560 px, unchanged pixels written as transparent), since grain would make it
several times bigger.

Export: GIF via [gifenc](https://github.com/mattdesl/gifenc) (one frame per scene, ordered dithering), video via
WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 MP4), falling back to real-time `MediaRecorder`
where WebCodecs is missing.

Art from *No, I'm Not a Human* (Trioskaz); fan-made. Font: Chakra Petch (SIL OFL, `public/pale-guy/fonts/OFL.txt`).

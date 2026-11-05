# who.ulus.me

Static Astro site. Everything runs in the browser, so it deploys to Cloudflare Pages as plain files.

| Route | What |
| --- | --- |
| `/` | "soon" |
| `/are-you-a-human-pale-guy` | Pale Visitor ("Yalnız mısın?") meme maker |

## Develop

```sh
bun install
bun run dev      # http://localhost:4321
bun run build    # -> dist/
```

Cloudflare Pages: build command `bun run build`, output directory `dist`. No functions or server code.

## Meme maker

Source in `src/pale/`, static assets in `public/pale-guy/`.

- `model.json`: the fitted text model. Each text slot (dialogue line, two-line dialogue, answer boxes in each state) holds
  the perspective plane (`params`: x, y, rotation, shear, scale, perspective), glow colours (`coefs`: core + 2.5/10/24 px
  glows per RGB channel) and the original text it was fitted on. `falloff` is the darker strip on the right of the
  game's view.
- `img/`: clean background plates with the game text removed. `base` (grin) plus patches for the other faces and the
  three answer-box states, and the empty doorway.
- `variations.json`: what a first-time visitor sees. Replace it with your own export to change the defaults.
- `examples/uluslu-taslak.json`: draft pack to import in the editor.

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

Export: GIF via [gifenc](https://github.com/mattdesl/gifenc) (one frame per scene, ordered dithering), video via
WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 MP4), falling back to real-time `MediaRecorder`
where WebCodecs is missing.

Art from *No, I'm Not a Human* (Trioskaz); fan-made. Font: Chakra Petch (SIL OFL, `public/pale-guy/fonts/OFL.txt`).

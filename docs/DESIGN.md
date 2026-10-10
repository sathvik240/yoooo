# Unpin — design plan

## Concept: "the survey plate"

Unpin is styled like a cartographer's field instrument: warm survey paper, plotter
ink, hairline contour lines, and exactly one loud colour: the vermilion of a map
pin. The pin is the product's whole story. It drops onto a self-drawn contour
plate when we find GPS in your photo, and it lifts off and dissolves when we
unpin the file.

## Palette (named, restrained)

| Token          | Name             | Hex       | Use |
|----------------|------------------|-----------|-----|
| `--paper`      | Survey Paper     | `#F2EDE3` | page background |
| `--paper-2`    | Vellum           | `#E9E2D4` | recessed panels, map plate |
| `--ink`        | Plotter Ink      | `#17181C` | text, rules, wordmark |
| `--graphite`   | Graphite         | `#565A63` | secondary text (6.0:1 on paper) |
| `--contour`    | Contour          | `#C8BFAD` | hairlines, grid, contour lines |
| `--pin`        | Pin Vermilion    | `#E5432A` | the pin, exposure highlights (graphics + large text only) |
| `--pin-ink`    | Deep Vermilion   | `#B12E18` | small text that must be red (5.3:1 on paper) |
| `--cleared`    | Survey Green     | `#24624F` | "verified clean" stamp, success text (6.4:1) |

Dark mode swaps paper and ink (`#121316` night plate, `#ECE5D8` text) and lifts
vermilion to `#FF6B4F` for contrast. No gradients, no glassmorphism, no purple.

## Type pairing

- **Fraunces** (variable, optical size + "SOFT"/"WONK" axes): the one bold
  typographic moment. The wordmark `unpin` is set huge (clamp 5–13rem), heavy,
  tight, with the dot of the `i` replaced by the vermilion pin. When a file is
  cleaned the pin lifts out of the wordmark.
- **Instrument Sans** (variable): body and UI. Calm, slightly narrow, not Inter.
- **JetBrains Mono**: every metadata readout, coordinate, and field name, so the
  "what your photo was broadcasting" ledger reads like instrument output.

All three are bundled from `@fontsource-variable/*`; no font CDN.

## Layout concept

- One long, quiet page with generous spacing (8px base, 96–160px section gaps).
- Hero: the giant wordmark, one sentence, and the drop zone drawn as a dashed
  survey boundary, not a card.
- Each file becomes a **plate**: left, the contour map (or the photo itself when
  there's no GPS); right, the **ledger** of fields that type out line by line.
  Below: actions (Redact, Unpin), then the check-before-you-post list.
  On a phone the plate stacks: map, ledger, actions, checklist.
- Thin 1px ink rules and small-caps mono labels separate sections instead of
  shadows and rounded cards. Radius is 2px max.
- Motion is saved for the reveal (pin drop, ledger typing) and the scrub (pin
  dissolve, fields struck through and collapsed, a "verified" stamp). Everything
  else is still. `prefers-reduced-motion` shows final states instantly.

## Default-check review

Things I removed from the first draft because they read as templates:

- ~~Indigo/violet accent + gradient hero~~ → single vermilion on paper.
- ~~Inter everywhere~~ → Fraunces / Instrument Sans / JetBrains Mono.
- ~~Three feature cards with icons under the hero~~ → the drop zone *is* the
  hero; the explanation lives in the reveal itself.
- ~~Rounded cards with drop shadows~~ → hairline rules and a vellum plate.
- ~~Toast notifications~~ → status written into the ledger where the eye already is.
- ~~Real map tiles~~ → impossible anyway (privacy); the contour plate is drawn
  locally from a seeded noise field, with a lat/long graticule and scale bar.

## Accessibility

- All interactive elements reachable by keyboard; visible 2px ink focus ring
  with offset (vermilion in dark mode).
- Colour is never the only signal: exposures are labelled, the stamp has text.
- Contrast: body ≥ 7:1, secondary ≥ 4.5:1; vermilion only on graphics/large text.
- Live regions announce reveal/scrub/verify results for screen readers.
- Touch targets ≥ 44px; layout tested down to 360px wide.

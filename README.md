# Unpin

**Take the location out of your photos, before you post them.**

Unpin is a static website that shows you what your photos and documents are
quietly broadcasting (GPS coordinates, the exact time, your phone model and
serial number, your name), then strips it out and *proves* it's gone. It also
flags the things metadata removal can't fix: street signs in the picture,
"I'm here right now" in your caption, the username that links two accounts.

Everything runs in your browser. There is no server, no upload, no analytics.

---

## What it does

| | |
|---|---|
| **Photos** | JPEG, PNG, WebP, HEIC/HEIF. Reads EXIF, GPS, XMP, IPTC, maker notes, embedded thumbnails, PNG text chunks, trailing "motion photo" data. Re-encodes from pixels only, keeps rotation, saves as `unpinned-N.jpg`. |
| **The reveal** | A survey-plate map *drawn on your device* drops a pin on the coordinates, and the fields type out one by one. Then the pin dissolves and each field is struck out. No map tiles, no geocoding. |
| **Verification** | The clean file is re-read by **two independent parsers** (exifr and Unpin's own byte-level container scanner). Unpin only says "0 metadata fields remaining" when both agree; otherwise it lists exactly what's left. |
| **Redaction brush** | Blur, pixelate or cover faces, house numbers, plates and reflections. Pen pressure (Wacom, Apple Pencil, Surface Pen) changes width and strength. Undo/redo, before/after slider. Redactions are baked into the pixels at full resolution. |
| **Check before you post** | A short checklist with every file covering what stripping can't fix, with a "go back and redact" shortcut. Screenshots get their own list (usernames, tabs, notifications, file paths). |
| **Caption scanner** | Highlights emails, phone numbers, addresses, ZIP/postcodes, handles for other platforms, real-time location phrases ("just landed in…"), "home alone" style posts, birthdays, and approximate school/work/neighbourhood hints. |
| **Documents** | PDF (Info dictionary, XMP, comment authors, document ID, old revisions) and Word/Excel/PowerPoint (author, last editor, company, manager, template path, comments, tracked-change authors and dates, revision IDs, Excel's saved folder path). Embedded photos are re-encoded too. |
| **Video** | MP4 and MOV (iPhone and Android): GPS location, device make/model, software, names, comments, XMP and recording timestamps. Cleaned in place in milliseconds, with no re-encoding and no quality loss. |
| **Batches** | Drop many files at once, "Unpin all", download everything as one ZIP (with neutral timestamps). |
| **Beyond files** | A practical guide to everything else: separate identities, location settings, fitness apps, data brokers, WHOIS privacy. |

Try it without your own files: the home page has **a sample photo** (an
illustrated street scene with a house number, street sign, mailbox and plate to
redact, plus phone-style EXIF with GPS) and **a sample Word document**.

## Privacy model

* **No backend.** The build output is plain static files.
* **No uploads.** Files are read with the File API and processed in memory, in
  a Web Worker for images. Videos are never loaded whole: only their small
  index is read and patched. Nothing is written anywhere except the download you
  click.
* **No third-party requests.** Fonts and libraries are bundled. The HEIC
  decoder (libheif, WebAssembly) and JSZip are lazy-loaded *from the same site*
  only when needed.
* **Locked down by policy.** The production build ships a strict
  Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`, no
  `unsafe-eval`). Even if a dependency tried to phone home, the browser would
  block it. `netlify.toml` and `vercel.json` also send it as an HTTP header,
  with `Referrer-Policy: no-referrer` and a `Permissions-Policy` that disables
  geolocation, camera and microphone.
* **No map lookups.** The location reveal is drawn from a noise field on your
  device. Coordinates are never sent to a map, geocoder or search API, because
  that request would itself leak them.
* **A counter you can watch.** The badge in the header ("0 outside requests")
  is counted from the browser's own Resource Timing records.

### Check it yourself: zero network requests

1. Open Unpin, then open DevTools (**F12**, or **Cmd+Opt+I** on a Mac) and go
   to the **Network** tab.
2. Tick **Preserve log**, then click the 🚫 icon to clear the list.
3. Drop a photo, press **Unpin this photo**, and download the result.
4. Look at the list. You should see at most a few files from Unpin's own
   address (`assets/strip.worker-….js`, and `libheif-bundle-….js` the first
   time you open a HEIC photo). There should be **nothing from any other
   domain** and **no request containing your file**. Filtering by
   **Fetch/XHR** should show nothing at all (unless you clicked a sample file,
   which is fetched from Unpin's own address).
5. For extra certainty, load the page, then switch DevTools to **Offline**
   (the throttling dropdown) and use it. Everything still works.

`npm run e2e` automates this: it drives the production build in headless
Chromium, records every request, and fails if anything goes to another origin.

## What Unpin can't protect you from

Said plainly in the app too:

* **What's visible in the picture.** Faces, signs, reflections, the view from
  your window. That's what the checklist and the brush are for.
* **Your IP address and device fingerprint** when you upload or post somewhere.
* **Accounts that link you**: reused usernames, profile photos, emails, writing style.
* **Records that already exist**: data brokers, public records, WHOIS.
* **Other people** tagging you or posting your location.
* **Platforms** that re-compress, add their own metadata, or keep your original.

Also worth knowing:

* Re-encoding drops the colour profile, so wide-gamut (Display P3) photos are
  converted to sRGB. Animated GIFs become a still PNG.
* Word tracked changes are anonymised, but **deleted text is still in the
  file**. Unpin says so and asks you to accept or reject changes first.
* Excel and PowerPoint comments are kept with their author names replaced by
  "Author"; Word comments are removed entirely.
* The caption scanner is pattern-based. It will miss things and flag harmless
  things, and it says so. It doesn't attempt time-of-day analysis, which isn't
  possible from text.
* Screenshot detection is a heuristic (screen-sized dimensions, no camera
  data, an OS "Screenshot" marker, a status-bar-like top strip).

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ locally
```

Node 20+ (developed on Node 22).

## Tests

```bash
npm test             # all unit tests (Node + real Chromium)
npm run test:node    # scanner, PDF, Office, video, ZIP, screenshot heuristics
npm run test:browser # image strip/verify, rotation, redaction, HEIC, 12 MP perf
npm run build && npm run e2e   # end-to-end + network check against dist/
```

Browser tests run in real Chromium through Vitest's browser mode and
Playwright, because stripping relies on `createImageBitmap`, `OffscreenCanvas`
and real JPEG/PNG/WebP encoders.

Results at the time of writing:

```
 Test Files  9 passed (9)
      Tests  100 passed (100)
```

| Suite | What it proves |
|---|---|
| `tests/browser/strip.test.ts` | Reading finds GPS/device/people/thumbnail/XMP/IPTC; JPEG, PNG and WebP come out with **no** EXIF/XMP/IPTC/text chunks (checked with exifr *and* a byte scan); EXIF rotation is baked in (a stored 60×30 image with Orientation 6 comes out 30×60 with the red stripe on top); output names are neutral; JPEG quality ≥ 0.92; corrupt files fail with a plain-language fix; verify is not vacuous (originals fail it). |
| performance | A 4032×3024 (12 MP) JPEG with GPS is stripped and verified in **~0.7 s** in headless Chromium. |
| `tests/browser/redact.test.ts` | Cover is fully opaque; blur/pixelate destroy detail inside the stroke and leave the rest untouched; pen pressure widens strokes; a later blur can't reveal an earlier cover; redactions are present in the exported, verified file. |
| `tests/browser/heic.test.ts` | GPS read from a HEIC; converted with the lazy-loaded decoder to a clean JPEG. |
| `tests/node/scanner.test.ts` | 41 positive and 15 negative caption checks. |
| `tests/node/pdf.test.ts` | Info, XMP and comment authors removed; raw bytes no longer contain the author's name; pages and comment text intact; damaged PDF error. |
| `tests/node/office.test.ts` | DOCX/XLSX/PPTX properties, comments, tracked changes, rsids, template path, saved folder path, embedded GPS photo; every XML part is re-read after cleaning. |
| `tests/node/video.test.ts` | MP4 (3GPP `loci`, iTunes tags) and MOV (Apple QuickTime keys) read and cleaned; output is byte-for-byte the same size, contains none of the original strings, **ffprobe sees zero metadata tags and ffmpeg decodes every frame**; a 100 MB video cleans in ~1 ms because only its index is read; truncated and non-video files are refused with a fix. |
| `tests/node/screenshot.test.ts`, `zip.test.ts` | Screenshot heuristics; ZIP contents and fixed timestamps. |

Fixtures are generated by `scripts/make-fixtures.py` (Pillow, piexif,
pillow-heif) and `scripts/make-doc-fixtures.mjs`, and committed.

## Deploying

The site is fully static. Build once, upload `dist/`.

* **Netlify**: connect the repo. `netlify.toml` sets the build command,
  publish directory and security headers.
* **Vercel**: import the repo. `vercel.json` does the same.
* **GitHub Pages**: enable Pages with "GitHub Actions" as the source.
  `.github/workflows/pages.yml` tests, builds and deploys on every push to
  `main`. The build uses relative paths (`base: './'`), so project sub-paths
  work.
* **Anywhere else**: `npm run build` and serve `dist/` as static files.

## How it's built

Vite + TypeScript, no UI framework (the UI is a handful of small components;
a framework wouldn't earn its weight here). Runtime dependencies:

* `exifr`: EXIF/XMP/IPTC reading
* `pdf-lib`: PDF cleaning
* `jszip`: Office files and batch ZIPs (lazy-loaded)
* `libheif-js`: HEIC decoding, WebAssembly (lazy-loaded, only for HEIC)
* `@fontsource-variable/*`: Fraunces, Instrument Sans, JetBrains Mono, self-hosted

```
src/
  lib/            no DOM: parsing, cleaning, verification, scanners
    containers.ts   JPEG/PNG/WebP segment scanner (second verifier; WebP reader)
    bmff.ts         ISO-BMFF reader (HEIF Exif/XMP items)
    imageMeta.ts    read + verify images
    strip.ts        worker orchestration, orientation safety net, HEIC
    redact.ts       destructive blur/pixelate/cover, shared by UI and worker
    video.ts        MP4/MOV in-place metadata removal
    pdf.ts, office.ts, scanner.ts, screenshot.ts, zip.ts, netwatch.ts
  workers/strip.worker.ts   decode → redact → re-encode off the main thread
  ui/             plate (one file's journey), ledger, contour map, editor,
                  checklist, caption scanner, doc sheet, compare slider
docs/DESIGN.md    palette, type and layout plan
```

A few decisions worth noting:

* **exifr can't read WebP**, and rejects some valid HEIC files. Unpin parses
  those containers itself and hands exifr a minimal JPEG shell holding the
  EXIF/XMP, so reading is consistent across formats.
* **heic2any was replaced by libheif's WASM build** because heic2any needs
  `eval`, which the CSP forbids (it hung silently rather than failing).
* **Blur is destructive**, not a Gaussian filter: the region is shrunk to a few
  pixels and scaled back up, so the detail is gone from the file.

## Design

See [`docs/DESIGN.md`](docs/DESIGN.md). In short: a cartographer's survey
plate. Survey Paper `#F2EDE3`, Plotter Ink `#17181C`, and one loud colour,
Pin Vermilion `#E5432A`. Fraunces for the one big typographic moment (the
wordmark, whose i-dot is the pin), Instrument Sans for reading, JetBrains Mono
for every metadata readout. Motion is reserved for the reveal and the scrub,
and `prefers-reduced-motion` shows final states instantly. Text contrast meets
WCAG AA in both light and dark themes.

## Accessibility

Keyboard reachable throughout, with visible focus. The checklist uses native
checkboxes, the compare slider is a native range input, and results are
announced through live regions. Touch targets are at least 44 px and the
layout works down to 360 px wide. The redaction brush is pointer-based, so
it isn't usable by keyboard alone; everything else is.

## Video: how, and why not ffmpeg.wasm

The brief suggested ffmpeg.wasm with `-map_metadata -1 -c copy`. Unpin does
the same job differently, on purpose:

* ffmpeg.wasm is a ~30 MB download, needs the whole video in memory, and is
  slow on phones (the devices that shot the video).
* In MP4/MOV, metadata lives in small boxes (`udta`, `meta`, XMP `uuid`) and
  in the creation/modification times of the movie, track and media headers.
  Unpin renames those boxes to `free` (which every player skips), zeroes
  their contents, and zeroes the timestamps. **No box changes size, so no
  offsets move**, and the audio/video data is passed through as untouched
  Blob slices.

Result: no extra download, no re-encode, no quality loss, roughly constant
time regardless of file size, and the output is the same size as the input.
Tests confirm with ffprobe (an independent parser) that no tags remain and
with ffmpeg that every frame still decodes.

What it can't remove: separate timed-metadata *tracks*, such as GoPro GPS
telemetry (`gpmd`), Google `camm` or Apple `mebx`. When one is present Unpin
lists it and **won't call the file clean**; the user is told to re-export
without telemetry. Fragmented MP4 (`moof`) files with per-fragment metadata
are uncommon from phones and haven't been tested.

## Future work

* Remove timed-metadata tracks from videos (needs remuxing).
* Optional face detection to suggest redaction areas (on-device only).
* Accept/reject tracked changes inside Unpin instead of only warning.

## Licenses

No license has been chosen for Unpin's own code yet. Bundled libraries keep
their own licenses: exifr and pdf-lib (MIT), JSZip (MIT or GPL-3.0, used under MIT), libheif-js (LGPL-3.0), and
the fonts (SIL Open Font License).

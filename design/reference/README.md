# Design reference — status

## What was supposed to be here

The original ground-zero brief for the local-agent-loop work called for a locked
visual reference file, `foundry-glass-jarvis-rams-v2.html`, described as
"attached separately" and demonstrating a liquid-glass-depth aesthetic
(backdrop blur + flat translucent fill + one specular edge line) filtered
through Rams restraint, using two locked colors (H3ROS signal orange +
"FOUND3RY vertical slate").

**That file was never actually attached or provided in any session.** It does
not exist anywhere on the local machine it was supposed to be committed from.
Rather than fabricate a mockup and present it as "the locked reference," this
directory instead documents real, verified design tokens pulled live from
the two production sites on 2026-07-27, per explicit instruction to use those
as the canonical reference going forward.

## Live sites inspected (2026-07-27)

- https://h3ros.com — parent brand
- https://found3ry.com — FOUND3RY vertical

Captured via computed-style + CSS custom-property inspection of the live
pages, not screenshots or guesswork. **Re-verify against the live sites
before relying on this for new work** — this is a dated snapshot, not a
synced reference; the sites can change without this file updating.

## Confirmed shared tokens (both sites)

```
--ink / --color-ink        #141413   near-black, primary text/ink
--off-white                #F2F2EE   primary background
--vellum                   #E8E5DD   card/surface background
--signal / --color-signal  #E84A0E   H3ROS signal orange — confirmed, matches brief
```

**"FOUND3RY vertical slate" (the brief's second locked color) could not be
confirmed** — no token literally named "slate" exists in either site's CSS.
Closest candidates, reported honestly rather than guessed as fact:
- `--color-ink` (`#141413`) — shared parent ink, used as FOUND3RY's primary text color
- `--color-n600` (`#5F5F5A`) — FOUND3RY's muted/secondary text gray

If "vertical slate" refers to something more specific, it wasn't observable
from the live public marketing pages.

## Typography (confirmed via computed styles)

| Site | Body | Headings | UI / buttons |
|---|---|---|---|
| found3ry.com | Barlow | Barlow Condensed, 700 weight | IBM Plex Mono |
| h3ros.com | IBM Plex Serif | — | — |

Note: the missing reference file's docstring flagged Söhne/Tiempos (Klim,
commercially licensed) as substituted with Space Grotesk/JetBrains Mono,
with licensing unconfirmed. **Neither pair appears on the live sites.** IBM
Plex Mono/Serif is what's actually shipping, and the IBM Plex family is
open-licensed (SIL Open Font License) — so in practice this resolves the
licensing open item for anything matching current production, though it
does not confirm what the original (missing) mockup intended.

## Layout / motion tokens (h3ros.com; found3ry.com shares the color set but
this file didn't inventory its spacing/motion scale separately)

```
--space-1 .. --space-9   8px, 16px, 24px, 32px, 48px, 64px, 96px, 128px, 192px
--ease-h3ros              cubic-bezier(.2, 0, 0, 1)
--dur-hover / --dur-page / --dur-reveal    .2s / .4s / .6s
--hairline                #c8c5bd  (used as 1px bottom-border rule)
--float-shadow            0 8px 24px #14141314
```

Buttons/links observed: `border-radius: 0` (sharp corners throughout, no
rounding), transparent backgrounds, hairline/no visible border by default.

## Explicit discrepancy vs. the missing file's spec

The missing file's docstring described "liquid-glass depth achieved purely
optically (backdrop blur + a single flat translucent fill + one flat
specular edge line)." **Neither live site currently uses `backdrop-filter`
anywhere** (checked via a full-DOM computed-style sweep on each site's
landing page — zero elements with a non-`none` `backdrop-filter`). The live
public marketing sites are flat-fill + hairline-border, no glass/blur
treatment observed. This may be intentional (marketing site vs. in-product
UI could differ — COFOUND3R's actual app screens weren't inspected here,
only the public landing pages) — flagging this rather than assuming the
glass treatment is either confirmed or abandoned.

## For future sessions

Treat this file as a starting point, not gospel. Before matching FOUND3RY
UI work to "the design reference," re-inspect the live sites' current
computed styles rather than trusting this snapshot indefinitely — colors,
fonts, or the blur question above may have changed.

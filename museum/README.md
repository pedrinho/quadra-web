# Quadra museum: the archive

The research behind the museum page (`/museum`, built from `web/src/ui/museum.ts`): Quadra's
original life from 1998 to 2014, the recordings that survive, the world high-score lists, and what
the company and its players wrote. It was gathered in October 2026 from the Wayback Machine, the
Google Code Archive, LWN and a mirror of the HELLFIRE clan's site. Every item's source is in
[`sources.md`](sources.md).

## What's here

| Path | What |
|---|---|
| [`sources.md`](sources.md) | Every URL, with Wayback timestamps, including what was checked and found empty |
| [`recordings/CATALOG.md`](recordings/CATALOG.md) | Every known Quadra recording: format, version, length, players, scores and provenance |
| `recordings/pedrinhu/pedrinhu-qserv-entry.redacted.txt` | The world score server's stored entry for pedrinhu's 2003 run, IP address removed |
| [`highscores/`](highscores/README.md) | The world top 100 in March 2000 and in May 2009, as CSV |
| [`writing/hellfire-and-quadra.md`](writing/hellfire-and-quadra.md) | How a TetriNET clan moved to Quadra, in its own words, 2000–2004 |
| [`code-curiosities.md`](code-curiosities.md) | Odd rules, bugs kept on purpose and the people visible in the 1.3.0 source |
| [`tools/shoot.sh`](tools/shoot.sh) | Photographs a recording as the original game replays it (needs `patches/0002`) |

What the page publishes lives in the web app: the recordings, the pictures, the game's own art
and sounds in `web/public/museum/` (credited in its `ATTRIBUTION.txt`), and every word in
`web/src/museum/`.

## Kept locally, not in the repository

`.gitignore` keeps these out, because they are other people's full texts or the unredacted
originals of published files. Their addresses are in `sources.md`.

- `writing/`: Ludus Design's site (news 1998–2000, about, credits, FAQ, change history), *Why
  Quadra* in both versions, ComDAC's FAQ, Dada's server notes, HELLFIRE's pages.
- `highscores/*.raw.html`: the two archived score pages as captured.
- `recordings/*/`: the files as recovered. `google-code/local0.qrec` still holds its player's
  network addresses; the published copy does not.
- `pictures/ludus-1999/`: Ludus Design's three screenshots (also published, in
  `web/public/museum/shots/`).

## Highlights

- **Ludus Design's own news page survives**, from "looking for a publisher" in December 1998 to
  the closing in July 2000. It names the five founders, the Tetris legal trouble, the first world
  records and the open-sourcing.
- **No `.rec` archive survives.** The world score server stored every submitted run with its
  recording, and it's gone. Only names and numbers were archived.
- **Two world top-100 runs survive as recordings:** pedrinhu's 854,975 (#43) and [qz]-Zap-'s
  997,672 (#33).
- **The shipped demos are the team playing:** Dada and Rem, two of the founders, with Norm and
  Jeps, two of the testers, on the 1.1.0 test server days before its release.
- **HELLFIRE quit TetriNET for Quadra in October 2000.** *"After playing it, you will lose all
  respect for the regular Tetris games."*

## Rights and privacy

- The essays, FAQs, server notes and clan pages are quoted briefly on the page, credited and
  linked, not republished.
- The score-server entry for pedrinhu originally included the submitting IP address; the copy
  here has it replaced with `[redacted]`. Keep the unredacted original
  (`~/code/quadra-master/demos/pedrinho.qrec`) out of anything public.
- Player names are public handles from public lists. The real names on the page (the founders,
  Norm, Tom and Michele) are as Ludus Design and HELLFIRE published them.

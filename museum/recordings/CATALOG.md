# Quadra recordings: catalog

Every Quadra recording known as of 10 October 2026: the ones recovered online for this museum,
and the ones already in Pedro's collection at `~/code/quadra-master/demos/`.

All nineteen are published in [`web/public/museum/rec/`](../../web/public/museum/rec/) and
listed on the museum page. `web/src/museum/recordings.ts` holds what the page says about each,
and `web/test/museum.test.ts` checks it against the files. The originals recovered online stay out of
the repository (see `../.gitignore`), because `local0.qrec` carries its player's network
addresses: the published copy, `issue4-local0.qrec`, has those digits replaced with x's and is
otherwise identical.

## Two formats

A `.rec` (renamed `.qrec` from Quadra 1.2.0) is a zlib stream behind a 4-byte length. Inside is
one of two things:

- **Old single-player form**: a seed, one byte of input per frame, and the final score. The
  port replays these bit-exact today.
- **Packet form**: the network packets a client received during the game. Later builds recorded
  every game this way, solo ones included. The port refuses these until it has the netcode.
  Quadra 1.3.0 itself still plays all of them, including the 1.1.8 and 1.2.0 ones: that is how
  the museum's pictures were taken (`../tools/shoot.sh`).

"Version" below is the protocol version the game ran at. It decides which rules apply: 20 is the
original ruleset and 23 is Quadra 1.1.5's; 22 and 24 turn up in recordings from 1.1.8 and 1.2.0.
The port plays rules 20 and 23.

## Recovered online for the museum

| File | Quadra | Form | Version | Length | Players and scores | Found at |
|---|---|---|---|---|---|---|
| [`pedrinhu-854975.rec`](../../web/public/museum/rec/pedrinhu-854975.rec) | 1.1.3 | old single-player | 20 | 12:00 | pedrinhu 854,975 (343 lines, level 23) | Pedro's own score file (see below) |
| [`issue11-local0.rec`](../../web/public/museum/rec/issue11-local0.rec) | 1.1.8 | packet | 22 | 9:34 | [qz]-Zap- 997,672 (456 lines) | Google Code issue 11 |
| [`issue4-local0.qrec`](../../web/public/museum/rec/issue4-local0.qrec) | 1.2.0 | packet | 24 | 5:04 | niebie 150,205 | Google Code issue 4 |
| [`issue46-quadra-rotate-bug.rec`](../../web/public/museum/rec/issue46-quadra-rotate-bug.rec) | 1.1.8 | packet | 24 | 0:33 | a 33-second bug clip | Google Code issue 46 |
| `20-liner.zip` | 1.1.5 | packet | 23 | 7:35 | the same `20-liner.rec` as below | aaltonen's site, Wayback 2005 |

**pedrinhu, 854,975.** Played on 29 October 2003 on Windows (DirectX), Quadra 1.1.3, at the
"Faster" repeat speed. It was #43 in the world top 100 archived in 2009, and would have been #1
on the March 2000 list. The port replays it bit-exact: 854,975 points, 343 lines, level 23, with
all 57,375 input bytes used. It reached us as the high-score server's stored entry, a Perl
`Data::Dumper` text with the recording base64-encoded inside. That wrapper is kept as
[`pedrinhu/pedrinhu-qserv-entry.redacted.txt`](pedrinhu/pedrinhu-qserv-entry.redacted.txt),
with the submitting IP address removed.

**[qz]-Zap-, 997,672.** #33 in the 2009 world top 100. Its owner attached it to a bug report on 19 March
2008 ("Problem with a singelplayer rec": the game quit whenever this run was uploaded to the
high-score list).
This is the only surviving recording of a world top-100 run besides pedrinhu's.

## Already in Pedro's collection (`~/code/quadra-master/demos/`)

| File | Quadra | Form | Version | Length | Players and scores |
|---|---|---|---|---|---|
| `Buk14clean.rec` | 1.1.3 | old single-player | 20 | 4:38 | BuK LaO 362,179 |
| `demo00.rec` | 1.1.0 | packet | 20 | 2:49 | Dada 62,423; Rem 21,199; Norm 106,453; Jeps 87,934 |
| `demo01.rec` | 1.1.0 | packet | 20 | 3:51 | Dada 90,959; Rem 86,414; Norm 39,121; Jeps 51,413 |
| `demo02.rec` | 1.1.0 | packet | 20 | 1:21 | Dada 54,826 |
| `demo03.rec` | 1.1.0 | packet | 20 | 6:34 | Dada 148,438; Rem 143,589; Norm 127,023; Jeps 110,911 |
| `16linesingle.rec` | 1.1.5 | packet | 23 | 5:53 | RZ***Stephen 312,165 (141 lines, solo) |
| `show0690.rec` | 1.1.5 | packet | 23 | 15:18 | RZ***Stephen 564,905 (one player, survivor mode) |
| `183k.rec` | 1.1.5 | packet | 23 | 2:47 | SadButTrue 16,462; RZ***Stephen 235,950; Boomie 25,795; Pano 55,055; Paratek 12,870; RZ**AdEpt 97,846; Roston 46,970 |
| `20-liner.rec` | 1.1.5 | packet | 23 | 7:35 | Seb 140,085; m ^ojo^ m 66,495; Pihvi 78,100; destiny4ever 55,220; bw\|Sentinel 199,619 |
| `2v2andyzlipvsnormdada12.rec` | 1.1.5 | packet | 23 | 4:55 | Dada 122,540; StepheN 210,265; Norm 133,320; [hf]tom 128,590; RZ***dB 58,905 |
| `dBownsalltherestsuckass.rec` | 1.1.5 | packet | 23 | 8:13 | Roger 20,405; roston 34,155; StepheN 20,130; [hf]tom 356,950; RZ***dB 186,120 |
| `show0376.rec` | 1.1.5 | packet | 23 | 3:59 | AVE Goran 31,130; Parallax 14,190; m ^ojo^ m 41,195; RZ**AdEpt 108,262; BruC 29,205; RZ***Stephen 319,605; jojje 41,453; addicted 103,125 |
| `michvsn.rec` | 1.1.5 | packet | 23 | 30:53 | StepheN 1,440,450; [hf]michele 1,327,535 |
| `stephen-vs-alex.rec` | 1.1.5 | packet | 23 | 22:58 | Stephen 997,645; Alex 715,990 |
| `stephen-vs-hfmich.rec` | 1.1.5 | packet | 23 | 35:02 | [HF]mich 970,530; Stephen 1,141,415 |

Players are listed as the summary records them, including players who joined and left mid-game.
The multiplayer games are all the same mode: survivor, first to 15 frags (5 or 10 in the 1.1.0
demos), with plain line attacks.

Where they came from:

- `demo00`–`demo03` shipped inside the game itself, in `quadra.res`, and played in the title
  screen's attract mode.
- `20-liner.rec` was hosted on aaltonen's Danish fan site; the copy recovered here is
  byte-identical.
- The rest are in neither the upstream git repository nor any archive found so far.
  `pedrinho.rec` and `pedrinho.qrec` in that folder are both copies of the score-server entry,
  not recordings.

## People in the recordings

- **Dada** is one of the original Quadra programmers: the comment in upstream `wadder.cc` is
  signed that way. Dada plays `demo02` alone, `demo00`/`01`/`03` with Rem, Norm and Jeps, and the
  2v2 game with Norm (`2v2andyzlipvsnormdada12`, "andy zlip vs norm dada").
- **StepheN / RZ***Stephen**, of team RecognizE. Holds #1, #2 and 7 more of the 2009 world top
  100. Won HELLFIRE's first Quadra tournament (January 2001). A "StepheN" is #3 on the March 2000
  list, though nothing confirms it's the same player.
- **micheLe** ([hf]michele, [HF]mich), of HELLFIRE: a former TetriNET ladder champion from the
  United States. Plays the two longest games here, against StepheN.
- **[hf]tom** is probably **zLiP** (real name Tom, from Sweden), micheLe's 2v2 partner. The
  filename `2v2andyzlipvsnormdada12` names zlip, and [hf]tom is the HELLFIRE player in that game.
  The clan's news page announced their wedding on 29 February 2004. See
  [`../writing/hellfire-and-quadra.md`](../writing/hellfire-and-quadra.md).

## Not Quadra

HELLFIRE's site also hosted a `rec/` folder of match recordings (`spindizzy-vs-*`,
`hellfire-vs-*`, `michele-vs-*`, 27 files, 1999–2003). The 12 that could be fetched are TetriNET
spectator logs: plain text with `playerjoin`, `pline` and `newgame` lines. The other 15 sit in
the same folder and are almost certainly the same kind. None are kept here; their URLs are in
[`../sources.md`](../sources.md).

## Lost

- The world high-score server stored every submitted run with its recording embedded. It's gone,
  and the game fetched recordings by POST, which the Wayback Machine never saved.
- The game saved downloaded world top runs as `global0.qrec`… on players' disks. Old hard drives
  are the only place left to look.

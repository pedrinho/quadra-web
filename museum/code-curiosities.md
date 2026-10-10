# Curiosities in the original source

Found in Quadra 1.3.0 (<https://github.com/quadra-game/quadra>, tag `v1.3.0`). Paths are
relative to that repository.

## Rules stranger than they look

- **The "points per minute" limit isn't per minute** (`source/net_list.cc:501`). After 4 minutes
  of play, the server drops anyone whose *total* score is over 4× the limit. Nothing divides by
  time, so a slow, steady player gets kicked eventually too, with the message *"Please join an
  expert server."*
- **Garbage is a negative of the attacker's move** (`source/player.cc:567`,
  `source/net_list.cc:128`). From protocol version 23, each garbage line has holes exactly where
  the blocks that cleared the sender's line came from. Before 23, every garbage line had a single
  hole, in the column where the last piece landed.
- **A clean board sends "really crappy holes"**, in the comment's words (`source/net_list.cc:125`).
  The garbage alternates two fixed patterns, 585 and 72, which line up into vertical shafts at
  columns 4 and 7.
- **`rnd(n)` is a bitmask, not a range.** `rnd(3)` returns 0–3. Pieces come from `rnd() % 7` on
  16 bits, and 65,536 isn't divisible by 7, so O and S each turn up 1 time in 65,536 more often
  than the other pieces.
- **Watching a demo can't unlock backgrounds** (`source/canvas.cc:653`). Reaching a level unlocks
  its theme, but only when not in playback.

## Bugs kept on purpose

- **The "minimum combo" option did nothing in 1.1.5 games** (`source/canvas.cc:547`). Version 23
  overwrites that check with its own rule, and the comment admits it: *"this is a bug, it should
  have been done like net_version >= 24 (below) but it must remain as is for network
  compatibility."*
- **`crap_rnd`, the "crappy proc"** (`source/random.cc:44`). It stores its own shifted output as
  its next state, which leaves about 22 bits of state, and it returns the low bits, the least
  random part of this kind of generator. Every piece before version 23 came from it, including
  all of pedrinhu's 343 lines in 2003.
- **"This sucks, see ya in 1.3.0 (maybe :))"** (`source/net_list.cc:350` and `:942`). The code
  under it is still commented out in 1.3.0.

## The people in the code

- **The demos that shipped with the game are the developers playing.** Dada signs the long
  comment in `source/wadder.cc` as *"one of the original Quadra programmers"*, apologizing for
  *"25000 lines of bad C++"*. Dada plays `demo02` alone and is one of four players, with Rem,
  Norm and Jeps, in `demo00`, `demo01` and `demo03`.
- **`Playback::shit_skipper2000()`, "the Shit-skipper 2000(tm)"** (`source/recording.cc:390`). It
  removes the chatter before a multiplayer game starts and shifts every timestamp so the demo
  begins immediately.
- **Hot potato mode:** *"Sorry mister, your buddies are still juggling the hot potato, you can't
  go help them yet! :)"* (`source/player.cc:1016`). Each round a team survives, its potato quota
  goes up: *"At least one alive, next time it will be tougher :)"* (`source/game.cc:507`).
- **Mixed French and English comments:** *"On connait pas repeat, smooth, shadow mais on s'en
  tappe parce qu'on est pas en playback"* ("we don't know repeat, smooth or shadow, but we don't
  give a damn because we're not in playback", `source/game.cc:146`). The `Game` constructor opens
  with *"Ok, we all know this sucks, but there supposedly are references to ::game in some of
  the things we call here and I don't feel like tracking them down"* (`source/game.cc:113`).

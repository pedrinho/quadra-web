# World high scores

Two snapshots of Quadra's online high-score list, nine years apart. Each was saved as the raw page
the Wayback Machine archived (`*.raw.html`, kept locally, not in the repository) and as a clean
CSV, which the museum page reads from `web/src/museum/`.

| Snapshot | Server | Rows | #1 | #100 |
|---|---|---|---|---|
| [8 March 2000](../../web/src/museum/2000-03-08-ludusdesign-highscores.csv) | Ludus Design's own site, before the game went open source | 100 | Norm, 783,549 (350 lines, level 24) | Berduck, 235,962 |
| [6 May 2009](../../web/src/museum/2009-05-06-qserv-top100.csv) | `qserv.pl`, the open-source era server at ludusdesign.com | 100 | RZ***Stephen, 2,951,441 (733 lines, level 49) | Siw, 646,360 |

Notes:

- **The bar rose almost threefold.** #100 went from 235,962 to 646,360, and #1 from 783,549 to
  2,951,441. No name appears on both lists.
- **pedrinhu is #43 in 2009** with 854,975 (343 lines, level 23), played 29 October 2003. On the
  2000 list that score would have been #1. The recording survives: see
  [`../recordings/CATALOG.md`](../recordings/CATALOG.md).
- **[qz]-Zap- is #33** with 997,672. That recording survives too.
- **RZ***Stephen holds 9 of the 2009 top 100**, including #1, #2 and #7. Ric has 7.
- **Every 2009 date reads 1969-12-31 19:00:00.** The open-source server never stored a date with a
  score (`do_postdemo` in upstream `server/qserv.pl` saves only what the client sent), so the
  HTML page formatted time zero, which is 7 pm on New Year's Eve 1969 in US Eastern time. The 2000
  list has real dates, from 28 May 1999 to 7 March 2000.

The table is only names and numbers. The server also kept each run's recording, but the game
fetched those by POST, which the Wayback Machine never saved.

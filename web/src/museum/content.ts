/*
 * What the museum says, and where each thing comes from.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Everything here is sourced: the company's own news page, its about and credits pages, the
 * world high-score lists, HELLFIRE's site, the upstream source, the recordings' summaries. The
 * URLs are in museum/sources.md at the repo root. When the record does not say something — who
 * stood behind a clan tag, whether two names are one player — this does not say it either.
 *
 * Quotes are short and credited. The pages they come from are linked rather than copied.
 */

export interface Source {
  label: string;
  href: string;
}

const LUDUS_NEWS: Source = {
  label: 'Ludus Design news, 1998–2000',
  href: 'http://web.archive.org/web/20001204192300/http://www.ludusdesign.com/',
};
const LUDUS_ABOUT: Source = {
  label: 'Ludus Design, About',
  href: 'http://web.archive.org/web/2000id_/http://www.ludusdesign.com/about.html',
};
const LUDUS_FAQ: Source = {
  label: 'Ludus Design, Quadra FAQ',
  href: 'http://web.archive.org/web/2000id_/http://www.ludusdesign.com/quadra_faq.html',
};
const LUDUS_CREDITS: Source = {
  label: 'Ludus Design, Quadra credits',
  href: 'http://web.archive.org/web/2000id_/http://www.ludusdesign.com/quadra_credits.html',
};
const LIST_2000: Source = {
  label: 'World high scores, 8 March 2000',
  href: 'http://web.archive.org/web/20000308142554/http://ludusdesign.com:80/highscores.shtml',
};
const LIST_2009: Source = {
  label: 'World top 100, 6 May 2009',
  href: 'http://web.archive.org/web/20090506003422/http://ludusdesign.com:80/cgi-bin/qserv.pl?data=gethighscoreshtml%0Anum%20100',
};
const HELLFIRE: Source = { label: 'HELLFIRE’s site (mirror)', href: 'https://synt4x.org/tgm/hellfire/' };
const WHY_QUADRA: Source = {
  label: 'spindizzy, Why Quadra (mirror)',
  href: 'https://synt4x.org/tgm/hellfire/quadra/',
};
const LWN_2009: Source = { label: 'LWN, 4 June 2009', href: 'https://lwn.net/Articles/336170' };
const UPSTREAM: Source = { label: 'Quadra source', href: 'https://github.com/quadra-game/quadra' };
const GOOGLE_CODE: Source = {
  label: 'Google Code archive',
  href: 'https://code.google.com/archive/p/quadra/issues',
};

/* --- the timeline ------------------------------------------------------------ */

export interface Moment {
  /** As precise as the source is: `1998`, `1998-10`, or `1999-05-25`. */
  when: string;
  title: string;
  text: string;
  quote?: { text: string; by: string };
  source: Source;
  /** A recording in the archive this moment can be watched or downloaded from. */
  recording?: string;
}

export const TIMELINE: readonly Moment[] = [
  {
    when: '1998',
    title: 'Remtris',
    text:
      'Before Quadra there was Remtris 2, free, for MS-DOS, played over an IPX network with up to ' +
      'three players to a computer. Quadra itself began as “Remtris 3”.',
    source: LUDUS_NEWS,
  },
  {
    when: '1998-10',
    title: 'Ludus Design',
    text:
      'Five college friends found a company: Rémi “Remz” Veilleux, Stéphane “Dada” Lajoie, Pierre ' +
      '“Seventh” Phaneuf, Sylvain “FortS” Fortin and Guy “Xen” Fleurant.',
    quote: {
      text: 'trying to overcome their Doom II addiction by making computer games themselves',
      by: 'Ludus Design, About',
    },
    source: LUDUS_ABOUT,
  },
  {
    when: '1998-12-14',
    title: 'Looking for a publisher',
    text:
      'A beta test that year showed severe lag over the Internet. By March the network protocol ' +
      'had been redesigned twice.',
    source: LUDUS_NEWS,
  },
  {
    when: '1999-03-26',
    title: 'The owners of Tetris',
    text:
      'Legal “difficulties” with the owners of Tetris delay the release. Remtris 2, offered free ' +
      'in December, is withdrawn “due to legal constraints”.',
    quote: {
      text: 'There’s quite a funny story behind that but I don’t feel like telling it right now (the time’s 03:47, that’s not 15:47).',
      by: 'Dada',
    },
    source: LUDUS_NEWS,
  },
  {
    when: '1999-05-25',
    title: 'Quadra 1.0.0',
    text:
      'Released for Windows and Linux as shareware, with a world high-score list online. Asked why it was called Quadra, the FAQ said they had chosen a name that “doesn’t ' +
      'sound remotely like some unpleasant peoples’ trademarks.”',
    quote: { text: 'it’s the best game of its genre today!', by: 'Dada, on release day' },
    source: LUDUS_NEWS,
  },
  {
    when: '1999-05-28',
    title: 'The first world scores',
    text:
      'Three days after release, Xen and Doh, two names from the game’s own credits, post the ' +
      'oldest scores still on the world list in March 2000.',
    source: LIST_2000,
  },
  {
    when: '1999-08-03',
    title: 'Sungdo, then Mutt',
    text:
      'Sungdo becomes the first player from outside Ludus Design to top the world list. Mutt takes ' +
      'the lead within hours, by nearly 80,000 points.',
    quote: {
      text: 'Previous champions were all Ludus Design programmers or beta-testers',
      by: 'Dada',
    },
    source: LUDUS_NEWS,
  },
  {
    when: '1999-09-21',
    title: 'Quadra 1.1.0',
    text:
      'Recordings of multiplayer games, Demo central, and games of up to eight players. The four ' +
      'demos the game shipped with were recorded on its test server days before, by two of the ' +
      'programmers and two of the testers.',
    source: LUDUS_NEWS,
    recording: 'demo03',
  },
  {
    when: '1999-10-08',
    title: 'The first fan site',
    text:
      'ComDAC, 42nd in the world at the time, puts up a site with a FAQ and game recordings. In ' +
      'December, 1.1.3 adds the Hot Potato mode, with thanks to ComDAC.',
    source: LUDUS_NEWS,
  },
  {
    when: '2000-03-08',
    title: 'Norm is number 1',
    text:
      'Normand “Norm” Lebreux, a beta tester and the author of QSnoop, the Quadra game finder, ' +
      'leads the world list with 783,549. Mutt is 2,826 points behind him.',
    source: LIST_2000,
  },
  {
    when: '2000-07-20',
    title: 'Ludus Design closes',
    text:
      'With a company’s fees coming due, the founders shut it down. Quadra is to become free ' +
      'software, source and all.',
    quote: {
      text: 'We expect that a community of developers will pick up the torch in some non-official manner.',
      by: 'Ludus Design',
    },
    source: LUDUS_NEWS,
  },
  {
    when: '2000-08-07',
    title: 'The source is released',
    text:
      'Pierre Phaneuf makes the first commit of the open-source Quadra, 1.1.4. Version 1.1.5 ' +
      'follows in October, with a new home at quadra.sourceforge.net.',
    source: UPSTREAM,
  },
  {
    when: '2000-10',
    title: 'HELLFIRE arrives',
    text:
      'A TetriNET clan moves to Quadra and spindizzy writes Why Quadra to explain it. By May they ' +
      'are calling themselves the best Quadra team on Earth.',
    quote: {
      text: 'After playing it, you will lose all respect for the regular Tetris games.',
      by: 'spindizzy',
    },
    source: WHY_QUADRA,
  },
  {
    when: '2001-01-26',
    title: 'The first HELLFIRE tournament',
    text:
      'StepheN wins it. Two weeks earlier, on HELLFIRE’s tournament server, Stephen and [HF]mich ' +
      'played for thirty-five minutes. The recording survives.',
    source: HELLFIRE,
    recording: 'stephen-vs-hfmich',
  },
  {
    when: '2003-10-29',
    title: 'pedrinhu, 854,975',
    text: 'Twelve minutes on Quadra 1.1.3. Number 43 in the world by 2009. It still replays here today.',
    source: LIST_2009,
    recording: 'pedrinhu-854975',
  },
  {
    when: '2004-02-29',
    title: 'zLiP and micheLe',
    text: 'HELLFIRE’s news page announces that the two players, its 2v2 team, are getting married the next day.',
    source: HELLFIRE,
  },
  {
    when: '2008-03',
    title: 'Recordings in bug reports',
    text:
      'Players attach recordings to bug reports on Google Code. One is [qz]-Zap-’s 997,672, which ' +
      'made the game quit every time it was sent to the high-score server.',
    source: GOOGLE_CODE,
    recording: 'issue11-local0',
  },
  {
    when: '2009-05-06',
    title: 'The 2009 list',
    text:
      'A capture of the world top 100. RZ***Stephen is number 1 with 2,951,441, and holds ' +
      'nine of the hundred places.',
    source: LIST_2009,
  },
  {
    when: '2009-06-04',
    title: 'Quadra 1.2.0',
    text:
      'The first stable release in almost eight years, “for its 10th anniversary”. Quadra had been ' +
      'downloaded almost 70,000 times in the three years before.',
    source: LWN_2009,
  },
  {
    when: '2014-08-25',
    title: 'Quadra 1.3.0',
    text: 'Ported to SDL2, with a Mac OS X build. The latest release.',
    source: UPSTREAM,
  },
  {
    when: '2026-10',
    title: 'This museum',
    text:
      'The world high-score server, which kept a recording of every run sent to it, is gone. ' +
      'Nineteen recordings are known to survive, and they are here.',
    source: { label: 'Sources for this page', href: 'https://github.com/pedrinho/quadra-web/blob/main/museum/sources.md' },
  },
];

/* --- the people ----------------------------------------------------------- */

export interface Person {
  name: string;
  /** Other names the record shows them under, when the record says they are the same. */
  also?: string;
  role: string;
  text: string;
  source: Source;
}

export const MAKERS: readonly Person[] = [
  {
    name: 'Remz',
    also: 'Rémi Veilleux',
    role: 'Lead programmer and designer',
    text:
      'Designed Quadra with Dada, and drew some of its graphics. Plays as Rem in the demos that ' +
      'shipped with the game.',
    source: LUDUS_ABOUT,
  },
  {
    name: 'Dada',
    also: 'Stéphane Lajoie',
    role: 'Programmer, and the voice of the news page',
    text:
      'Plays in all four shipped demos, and was still playing in 2001, two against two with Norm. ' +
      'Signs a comment in the source as “one of the original Quadra programmers”.',
    source: LUDUS_ABOUT,
  },
  {
    name: 'Seventh',
    also: 'Pierre Phaneuf',
    role: 'Programmer, the Linux version',
    text: 'Released the source in 2000 and kept the project going for the next fourteen years.',
    source: LUDUS_ABOUT,
  },
  {
    name: 'FortS and Xen',
    also: 'Sylvain Fortin, Guy Fleurant',
    role: 'Programmers, and two of the five founders',
    text: 'Xen “is notable for his lack of an internet connection”, the about page said.',
    source: LUDUS_ABOUT,
  },
  {
    name: 'Vro',
    also: 'Véronique Bruneau',
    role: 'Graphics',
    text: 'Made the game’s graphics with Remz, and the company’s web site.',
    source: LUDUS_CREDITS,
  },
];

export const PLAYERS: readonly Person[] = [
  {
    name: 'StepheN',
    also: 'RZ***Stephen',
    role: 'RecognizE',
    text:
      'Number 1 in the world in 2009, with nine of the hundred places. Won HELLFIRE’s first ' +
      'tournament. Ludus Design thanked him in 2000 for running QuadraNet and for being “the most ' +
      'assiduous player ever”. A StepheN, Stephen or RZ***Stephen is in nine of the nineteen ' +
      'recordings here.',
    source: LUDUS_NEWS,
  },
  {
    name: 'Norm',
    also: 'Normand Lebreux',
    role: 'Beta tester',
    text:
      'Wrote QSnoop, the first program made for Quadra by somebody outside the company. Number 1 ' +
      'in March 2000, and in Dada’s words “arguably the best online Quadra player in the world”.',
    source: LUDUS_NEWS,
  },
  {
    name: 'Mutt',
    role: 'Number 2, March 2000',
    text:
      'Took the world lead in August 1999 and was thanked “for trying so hard to spread Quadra to ' +
      'all the corners of the earth!”',
    source: LUDUS_NEWS,
  },
  {
    name: 'micheLe',
    also: '[hf]michele, [HF]mich',
    role: 'HELLFIRE',
    text:
      'A former TetriNET ladder champion from the United States. Plays the two longest games in ' +
      'the archive, both against StepheN.',
    source: HELLFIRE,
  },
  {
    name: 'zLiP',
    also: 'zlip',
    role: 'HELLFIRE',
    text:
      'Tom, from Sweden: a former Quadra ladder champion, and micheLe’s partner in what the clan called ' +
      '“the greatest Quadra 2v2 team ever”. Three places in the 2009 top 100.',
    source: HELLFIRE,
  },
  {
    name: 'spindizzy',
    role: 'HELLFIRE',
    text: 'Wrote Why Quadra in October 2000, and recruited most of the clan.',
    source: WHY_QUADRA,
  },
  {
    name: 'ComDAC',
    role: 'The first fan site',
    text: 'Wrote the Quadra FAQ/Guide in 1999, and is thanked in the notes for Hot Potato.',
    source: LUDUS_NEWS,
  },
  {
    name: '[qz]-Zap-',
    role: '[qz]',
    text: 'Number 33 in 2009 with 997,672. One of only two world top-100 runs whose recording survives.',
    source: LIST_2009,
  },
];

/* --- the clans ------------------------------------------------------------ */

export interface Clan {
  tag: string;
  name?: string;
  /** Places in the 2009 world top 100. */
  places: number;
  best: string;
  text: string;
  source?: Source;
}

export const CLANS: readonly Clan[] = [
  {
    tag: 'RZ',
    name: 'RecognizE',
    places: 14,
    best: 'RZ***Stephen, number 1',
    text:
      'Ran its own ladder and its own servers. Their names survive in the recordings: ' +
      'RZ***Showdown, RZ***MediumPace, “RZ**dB pro server (80k+)”. When the master server went up ' +
      'and down, Why Quadra told newcomers to type in q.recognize.nu by hand.',
    source: WHY_QUADRA,
  },
  {
    tag: '[hf]',
    name: 'HELLFIRE',
    places: 0,
    best: 'zlip, number 25 (without the tag)',
    text:
      'A TetriNET clan from DALnet that crossed over in October 2000 and ran tournaments on its own ' +
      'server. No [hf] tag is on the 2009 world list; zlip, at 25, is the clan’s one name there.',
    source: HELLFIRE,
  },
  {
    tag: '[qz]',
    places: 11,
    best: '[qz]-Polly-, number 21',
    text: 'Polly, trigger, fawk, Zap, Viking, Gaz. Nothing else about them was archived.',
  },
  {
    tag: '*$@w*',
    places: 6,
    best: '*$@w*Arjen, number 3',
    text: 'Arjen and Altec.',
  },
];

/* --- the curiosities ------------------------------------------------------- */

export interface Curiosity {
  title: string;
  text: string;
  /** A file and line in the upstream source, or a page. */
  cite: string;
}

export const CURIOSITIES: readonly Curiosity[] = [
  {
    title: 'The year every score was set',
    text:
      'Every date on the 2009 world list reads 31 December 1969, 7 pm. The open-source score ' +
      'server never stored a date, so the page printed time zero, in Eastern time.',
    cite: 'server/qserv.pl',
  },
  {
    title: 'Players called #1',
    text:
      'A player who never typed a name played as #1, #2 or #3. Two of them are on the March 2000 ' +
      'world list: #1 with 336,471 and #3 with 236,980.',
    cite: 'source/cfgfile.cc:76',
  },
  {
    title: 'The team on its own list',
    text:
      'In March 2000 the world list had Dada at 19, Rem at 24 and Xen at 60, from the company, and ' +
      'Jeps at 41 and 74 and Doh at 76, from its testers. Norm, a tester too, was number 1.',
    cite: 'World high scores, March 2000',
  },
  {
    title: 'The Shit-skipper 2000(tm)',
    text:
      'The function that cuts the chatter before a multiplayer recording starts, so a demo begins ' +
      'with the game. Its name is in the source exactly like that.',
    cite: 'source/recording.cc:390',
  },
  {
    title: 'A random number that isn’t',
    text:
      'rnd(3) returns 0 to 3: it is a bitmask, not a range. And since 65,536 does not divide by ' +
      'seven, O and S each turn up once in 65,536 more often than the other five.',
    cite: 'source/random.cc',
  },
  {
    title: 'A bug kept on purpose',
    text:
      '“This is a bug, it should have been done like net_version >= 24 (below) but it must ' +
      'remain as is for network compatibility.” The minimum-combo option did nothing in 1.1.5 games.',
    cite: 'source/canvas.cc:547',
  },
  {
    title: 'Points per minute, not per minute',
    text:
      'A server could set a points-per-minute limit to keep experts out. After four minutes it ' +
      'compares the total score with four minutes’ worth of the limit, and never divides by time, so ' +
      'anyone who plays long enough is told “Please join an expert server.”',
    cite: 'source/net_list.cc:501',
  },
  {
    title: 'Watching cannot unlock',
    text:
      'Reaching a level unlocks its background for later games, except while watching a recording.',
    cite: 'source/canvas.cc:653',
  },
  {
    title: 'In French, in the comments',
    text:
      '“On connait pas repeat, smooth, shadow mais on s’en tappe parce qu’on est pas en ' +
      'playback”: we don’t know the repeat, smooth or shadow settings, but we don’t care, because ' +
      'we’re not in playback.',
    cite: 'source/game.cc:146',
  },
  {
    title: 'See ya in 1.3.0',
    text:
      '“This sucks, see ya in 1.3.0 (maybe :))”, says a comment over code left switched off. ' +
      '1.3.0 came out in 2014. The code is still switched off.',
    cite: 'source/net_list.cc:350',
  },
  {
    title: 'A Pentium 133',
    text:
      'The system requirements: “a Pentium 133 MHz with 16 MB RAM should be enough … just about ' +
      'any computer purchased new after 1995, as long as it’s not a Mac :)”.',
    cite: 'Ludus Design, Quadra FAQ',
  },
  {
    title: 'How to win',
    text:
      '“First of all, identify your opponent. If it is Remz, simply give up the notion of actually ' +
      'winning: this guy has got the skills.”',
    cite: 'Ludus Design, Quadra FAQ',
  },
];

export const FAQ_SOURCE = LUDUS_FAQ;

/* --- the curator ---------------------------------------------------------- */

/*
 * Pedro's, in the first person, and his to rewrite. Kept short: the museum is about the game and
 * the people who played it, and this only says who put it together.
 */
export const CURATOR_NOTE: readonly string[] = [
  'I played Quadra as pedrinhu. In October 2003 I sent a run of 854,975 to the world list, and it ' +
    'was still number 43 in 2009. Later, a Quadra developer sent me the copy the score server had ' +
    'kept. In 2014 I made a few small commits to Quadra 1.3.0, one of them to Demo central, where ' +
    'recordings are watched.',
  'This port began with wanting to play it again. The museum is for everything around the game: ' +
    'the company, the lists, the clans, the recordings people kept.',
];

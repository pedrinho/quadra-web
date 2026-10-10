/*
 * Every Quadra recording known to survive, as the museum lists them.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * The files are in `public/museum/rec/` under these names, and each entry here is checked against
 * its file by test/museum.test.ts: the date, the length, the version and the scores below are
 * what the recording's own summary says, not what anyone remembered. Adding a find is one file
 * and one entry.
 *
 * Two forms exist (see replay/rec.ts). The old single-player form is a seed and the keys, and this
 * engine replays it. The packet form is the network traffic a client received, which later
 * versions wrote for every game, solo ones included; replaying one needs the netcode, so those
 * wait for it. `canPlay` is the one place that changes when it arrives.
 */

export type RecForm = 'single' | 'packet';

export interface RecPlayerLine {
  name: string;
  score: number;
}

export interface MuseumRecording {
  /** Stable, and what `/museum?watch=` names. */
  id: string;
  /** Under `/museum/rec/`. Original names kept, except where two files shared one. */
  file: string;
  title: string;
  /** The day the recording's own clock gave, in UTC. */
  played: string;
  /** The Quadra release that wrote it. */
  quadra: string;
  /** The rules version the game ran under: 20 is the original, 23 is 1.1.5's. */
  protocol: number;
  /** Centiseconds, as the summary's `duration` counts them. */
  duration: number;
  form: RecForm;
  /** The game's name in the server list, when it had one. */
  server?: string;
  /** Everyone the summary lists, in its order, including anyone who left early. */
  players: RecPlayerLine[];
  /** Where this copy came from. */
  source: string;
  note?: string;
}

export const RECORDINGS: readonly MuseumRecording[] = [
  {
    id: 'pedrinhu-854975',
    file: 'pedrinhu-854975.rec',
    title: 'pedrinhu, 854,975',
    played: '2003-10-29',
    quadra: '1.1.3',
    protocol: 20,
    duration: 72043,
    form: 'single',
    players: [{ name: 'pedrinhu', score: 854975 }],
    source: 'The world high-score server’s own copy, kept by a Quadra developer',
    note:
      'Twelve minutes, 343 lines, level 23, played at the “Faster” repeat speed. Number 43 in the ' +
      'world in 2009; it would have been number 1 in March 2000.',
  },
  {
    id: 'buk14clean',
    file: 'Buk14clean.rec',
    title: 'BuK LaO, 362,179',
    played: '2000-12-19',
    quadra: '1.1.3',
    protocol: 20,
    duration: 27832,
    form: 'single',
    players: [{ name: 'BuK LaO', score: 362179 }],
    source: 'The curator’s collection',
    note: 'The port’s test suite replays this one on every change: 149 lines, level 10, to the point.',
  },
  {
    id: 'demo03',
    file: 'demo03.rec',
    title: 'Dada, Rem, Norm and Jeps',
    played: '1999-09-16',
    quadra: '1.1.0',
    protocol: 20,
    duration: 39470,
    form: 'packet',
    server: 'Q1.1 Test',
    players: [
      { name: 'Dada', score: 148438 },
      { name: 'Rem', score: 143589 },
      { name: 'Norm', score: 127023 },
      { name: 'Jeps', score: 110911 },
    ],
    source: 'Shipped inside Quadra 1.1.0 and shown on its title screen',
    note: 'Two of the programmers and two of the testers, five days before 1.1.0 came out.',
  },
  {
    id: 'demo00',
    file: 'demo00.rec',
    title: 'Dada, Rem, Norm and Jeps',
    played: '1999-09-16',
    quadra: '1.1.0',
    protocol: 20,
    duration: 16996,
    form: 'packet',
    server: 'Q1.1 Test',
    players: [
      { name: 'Dada', score: 62423 },
      { name: 'Rem', score: 21199 },
      { name: 'Norm', score: 106453 },
      { name: 'Jeps', score: 87934 },
    ],
    source: 'Shipped inside Quadra 1.1.0 and shown on its title screen',
  },
  {
    id: 'demo01',
    file: 'demo01.rec',
    title: 'Dada, Rem, Norm and Jeps',
    played: '1999-09-16',
    quadra: '1.1.0',
    protocol: 20,
    duration: 23149,
    form: 'packet',
    server: 'Q1.1 Test',
    players: [
      { name: 'Dada', score: 90959 },
      { name: 'Rem', score: 86414 },
      { name: 'Norm', score: 39121 },
      { name: 'Jeps', score: 51413 },
    ],
    source: 'Shipped inside Quadra 1.1.0 and shown on its title screen',
  },
  {
    id: 'demo02',
    file: 'demo02.rec',
    title: 'Dada, alone',
    played: '1999-09-17',
    quadra: '1.1.0',
    protocol: 20,
    duration: 8148,
    form: 'packet',
    server: 'Q1.1 Test',
    players: [{ name: 'Dada', score: 54826 }],
    source: 'Shipped inside Quadra 1.1.0 and shown on its title screen',
  },
  {
    id: 'stephen-vs-hfmich',
    file: 'stephen-vs-hfmich.rec',
    title: 'Stephen vs [HF]mich',
    played: '2001-01-12',
    quadra: '1.1.5',
    protocol: 23,
    duration: 210233,
    form: 'packet',
    server: 'HF Tournament Server',
    players: [
      { name: '[HF]mich', score: 970530 },
      { name: 'Stephen', score: 1141415 },
    ],
    source: 'The curator’s collection',
    note:
      'Thirty-five minutes of survivor, first to fifteen. Played on HELLFIRE’s tournament server ' +
      'in the month of its first Quadra tournament, which StepheN won.',
  },
  {
    id: 'stephen-vs-alex',
    file: 'stephen-vs-alex.rec',
    title: 'Stephen vs Alex',
    played: '2001-01-13',
    quadra: '1.1.5',
    protocol: 23,
    duration: 137850,
    form: 'packet',
    server: 'HF Pong',
    players: [
      { name: 'Stephen', score: 997645 },
      { name: 'Alex', score: 715990 },
    ],
    source: 'The curator’s collection',
  },
  {
    id: '2v2andyzlipvsnormdada12',
    file: '2v2andyzlipvsnormdada12.rec',
    title: 'Two against two',
    played: '2001-01-28',
    quadra: '1.1.5',
    protocol: 23,
    duration: 29565,
    form: 'packet',
    server: '2v2 only',
    players: [
      { name: 'Dada', score: 122540 },
      { name: 'StepheN', score: 210265 },
      { name: 'Norm', score: 133320 },
      { name: '[hf]tom', score: 128590 },
      { name: 'RZ***dB', score: 58905 },
    ],
    source: 'The curator’s collection',
    note: 'The filename reads “andy zlip vs norm dada”. Dada, one of the programmers, still playing in 2001.',
  },
  {
    id: 'michvsn',
    file: 'michvsn.rec',
    title: 'StepheN vs [hf]michele',
    played: '2001-02-11',
    quadra: '1.1.5',
    protocol: 23,
    duration: 185370,
    form: 'packet',
    server: '1 v 1 =p',
    players: [
      { name: 'StepheN', score: 1440450 },
      { name: '[hf]michele', score: 1327535 },
    ],
    source: 'The curator’s collection',
    note: 'Thirty-one minutes and twenty-nine rounds. Between them, 2,753 lines.',
  },
  {
    id: 'dbownsalltherestsuckass',
    file: 'dBownsalltherestsuckass.rec',
    title: 'RZ***Showdown',
    played: '2001-04-01',
    quadra: '1.1.5',
    protocol: 23,
    duration: 49330,
    form: 'packet',
    server: 'RZ***Showdown(www.recognize.nu)',
    players: [
      { name: 'Roger', score: 20405 },
      { name: 'roston', score: 34155 },
      { name: 'StepheN', score: 20130 },
      { name: '[hf]tom', score: 356950 },
      { name: 'RZ***dB', score: 186120 },
    ],
    source: 'The curator’s collection',
    note: 'The filename says “dB owns, all the rest suck ass”. [hf]tom finished with the most points.',
  },
  {
    id: '20-liner',
    file: '20-liner.rec',
    title: 'The 20-liner',
    played: '2001-05-10',
    quadra: '1.1.5',
    protocol: 23,
    duration: 45531,
    form: 'packet',
    server: 'RZ***Showdown(www.recognize.nu)',
    players: [
      { name: 'Seb', score: 140085 },
      { name: 'm ^ojo^ m', score: 66495 },
      { name: 'Pihvi', score: 78100 },
      { name: 'destiny4ever', score: 55220 },
      { name: 'bw|Sentinel', score: 199619 },
      { name: '#1', score: 0 },
    ],
    source: 'aaltonen’s Danish fan site, recovered from the Wayback Machine',
  },
  {
    id: '183k',
    file: '183k.rec',
    title: 'Seven players, one server',
    played: '2001-07-25',
    quadra: '1.1.5',
    protocol: 23,
    duration: 16752,
    form: 'packet',
    server: 'RZ**dB pro server (80k+)',
    players: [
      { name: 'SadButTrue', score: 16462 },
      { name: 'RZ***Stephen', score: 235950 },
      { name: 'Boomie', score: 25795 },
      { name: 'Pano', score: 55055 },
      { name: 'Paratek', score: 12870 },
      { name: 'RZ**AdEpt', score: 97846 },
      { name: 'Roston', score: 46970 },
    ],
    source: 'The curator’s collection',
  },
  {
    id: '16linesingle',
    file: '16linesingle.rec',
    title: 'RZ***Stephen, solo',
    played: '2001-08-02',
    quadra: '1.1.5',
    protocol: 23,
    duration: 35399,
    form: 'packet',
    players: [{ name: 'RZ***Stephen', score: 312165 }],
    source: 'The curator’s collection',
    note: 'A single-player game, recorded the way 1.1.5 recorded everything: as network traffic.',
  },
  {
    id: 'show0690',
    file: 'show0690.rec',
    title: 'RZ***Stephen, fifteen minutes',
    played: '2001-08-19',
    quadra: '1.1.5',
    protocol: 23,
    duration: 91831,
    form: 'packet',
    server: 'RZ***MediumPace',
    players: [{ name: 'RZ***Stephen', score: 564905 }],
    source: 'The curator’s collection',
  },
  {
    id: 'show0376',
    file: 'show0376.rec',
    title: 'Eight players',
    played: '2001-10-09',
    quadra: '1.1.5',
    protocol: 23,
    duration: 23923,
    form: 'packet',
    server: 'RZ***MediumPace',
    players: [
      { name: 'AVE Goran', score: 31130 },
      { name: 'Parallax', score: 14190 },
      { name: 'm  ^ojo^ m', score: 41195 },
      { name: 'RZ**AdEpt', score: 108262 },
      { name: 'BruC', score: 29205 },
      { name: 'RZ***Stephen', score: 319605 },
      { name: 'jojje', score: 41453 },
      { name: 'addicted', score: 103125 },
    ],
    source: 'The curator’s collection',
    note: 'A full server: eight is the most a Quadra game would take.',
  },
  {
    id: 'issue46-quadra-rotate-bug',
    file: 'issue46-quadra-rotate-bug.rec',
    title: 'Blocks overlap at rotate',
    played: '2002-05-30',
    quadra: '1.1.8',
    protocol: 24,
    duration: 3384,
    form: 'packet',
    players: [{ name: '#1', score: 0 }],
    source: 'Attached to Google Code issue 46, March 2008',
    note: 'A thirty-three-second clip sent with a bug report. The recorder’s clock said 2002.',
  },
  {
    id: 'issue11-local0',
    file: 'issue11-local0.rec',
    title: '[qz]-Zap-, 997,672',
    played: '2008-03-18',
    quadra: '1.1.8',
    protocol: 22,
    duration: 57425,
    form: 'packet',
    players: [{ name: '[qz]-Zap-', score: 997672 }],
    source: 'Attached to Google Code issue 11, March 2008',
    note:
      'Number 33 in the world in 2009. Its player attached it to a bug report because the game ' +
      'quit every time they tried to send it to the high-score server.',
  },
  {
    id: 'issue4-local0',
    file: 'issue4-local0.qrec',
    title: 'niebie, 150,205',
    played: '2008-03-18',
    quadra: '1.2.0',
    protocol: 24,
    duration: 30412,
    form: 'packet',
    players: [{ name: 'niebie', score: 150205 }],
    source: 'Attached to Google Code issue 4, March 2008',
    note: 'The player’s network addresses, written into the file by the game, are blanked in this copy.',
  },
];

/** Whether this engine can replay it today. The netcode milestone widens this to `packet`. */
export function canPlay(rec: MuseumRecording): boolean {
  return rec.form === 'single';
}

export function recordingUrl(rec: MuseumRecording): string {
  return `/museum/rec/${encodeURIComponent(rec.file)}`;
}

export function findRecording(id: string): MuseumRecording | undefined {
  return RECORDINGS.find((r) => r.id === id);
}

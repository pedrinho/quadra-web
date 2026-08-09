/*
 * The two e-mails this service sends.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Registration by e-mail is the one decision in this milestone that brings an outside dependency
 * with it, so it is kept to one file and one shape: build the message here, hand it to whichever
 * provider is configured. Resend is what is wired up, chosen for having a plain REST API and no
 * SDK; swapping it for Postmark or SES is `send` and nothing else.
 *
 * With no API key configured the mailer prints the link instead of sending it. That is not a
 * degraded mode to apologise for — it is how development works here, and it means a checkout
 * needs no mailbox and no account to exercise the whole registration flow.
 */

import type { Env } from './env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export function verifyMail(origin: string, token: string): Omit<Mail, 'to'> {
  const link = `${origin}/?verify=${token}`;
  return {
    subject: 'Confirm your Quadra address',
    text: [
      'Someone — probably you — registered this address for the Quadra leaderboard.',
      '',
      `Confirm it: ${link}`,
      '',
      'The link is good for 24 hours. If it was not you, ignore this and nothing happens.',
    ].join('\n'),
  };
}

export function resetMail(origin: string, token: string): Omit<Mail, 'to'> {
  const link = `${origin}/?reset=${token}`;
  return {
    subject: 'Reset your Quadra password',
    text: [
      'Someone asked to reset the password for this address.',
      '',
      `Reset it: ${link}`,
      '',
      'The link is good for an hour, and using it signs out every device.',
      'If it was not you, ignore this — the current password still works.',
    ].join('\n'),
  };
}

/**
 * Never throws and never reports which way it went.
 *
 * A caller must not behave differently depending on whether the send worked, because the
 * difference is observable and it answers the question "does this address have an account?" for
 * anyone who cares to ask. Failures go to the log, where they belong.
 */
export async function send(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });
    if (!res.ok) console.error(`[mail] ${res.status} sending to ${mail.to}: ${await res.text()}`);
  } catch (err) {
    console.error('[mail] send failed:', err);
  }
}

/*
 * The account overlay: signing in, choosing a name, registering, and the links that land here.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Built in the same idiom as `settings-panel.ts`: plain DOM over the canvas, no widget system,
 * `onVisibility` so the host pauses the game behind it. One thing it must get right that the
 * settings panel does not have to — that panel listens for `keydown` in the **capture** phase to
 * rebind keys, and `Keyboard` listens on the window to play the game. Both would eat the letters
 * of an e-mail address. The host suspends the keyboard for any overlay, and this panel stops its
 * own key handling at the form.
 */

import { apiMessage, type Account, type Api } from '../api.js';

type Mode = 'signin' | 'welcome' | 'register' | 'forgot' | 'reset' | 'account';

export interface AccountPanelOptions {
  host: HTMLElement;
  api: Api;
  /** Called whenever the signed-in player changes, including to null. */
  onAccount: (account: Account | null) => void;
  onVisibility?: (open: boolean) => void;
}

export class AccountPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private readonly switcher: HTMLElement;
  private mode: Mode = 'signin';
  private open = false;
  /** Carried between screens so the reset form knows whose link it is spending. */
  private token = '';
  private busy = false;

  constructor(private readonly opts: AccountPanelOptions) {
    this.root = document.createElement('div');
    this.root.className = 'overlay account';
    this.root.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'panel';

    const header = document.createElement('header');
    this.title = document.createElement('h2');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.hide());
    header.append(this.title, close);

    this.body = document.createElement('div');
    this.body.className = 'group';
    this.note = document.createElement('p');
    this.note.className = 'verdict';
    this.note.hidden = true;
    this.switcher = document.createElement('p');
    this.switcher.className = 'hint';

    panel.append(header, this.body, this.note, this.switcher);
    this.root.append(panel);
    opts.host.append(this.root);

    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    // Stop at the form: the game's keyboard and the settings panel's rebinding capture both
    // listen on the window, and either would swallow the letters of an address.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
    window.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(mode: Mode = this.opts.api.account ? 'account' : 'signin'): void {
    this.mode = mode;
    this.render();
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.opts.onVisibility?.(true);
    this.root.querySelector('input')?.focus();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.note.hidden = true;
    this.opts.onVisibility?.(false);
  }

  /**
   * Open straight onto a link: one that arrived by mail, or Google's way back with a first
   * sign-in still waiting for a name.
   *
   * They land on a page as a query parameter rather than on a route of their own, so no route has
   * to exist for them and whatever that page shows is already loading behind the panel. Either
   * page can honour one — see `readSignInLink`.
   */
  openFromLink(kind: 'verify' | 'reset' | 'welcome', token: string): void {
    this.token = token;
    if (kind !== 'verify') {
      this.show(kind);
      return;
    }
    this.show('signin');
    void this.run(async () => {
      const res = await this.opts.api.verifyEmail(token);
      if (!res.ok) return apiMessage(res);
      this.settle(res.player);
      this.say(`Confirmed. You are signed in as ${res.player.displayName}.`, 'ok');
      setTimeout(() => this.hide(), 1800);
      return null;
    });
  }

  /** Back from Google without a sign-in: cancelled there, or refused here. */
  signInFailed(): void {
    this.show('signin');
    this.say('Signing in with Google did not complete. Nothing was changed — try again?', 'bad');
  }

  /* --- screens ----------------------------------------------------------- */

  private render(): void {
    this.body.replaceChildren();
    this.switcher.replaceChildren();
    this.note.hidden = true;

    switch (this.mode) {
      case 'signin':
        return this.renderSignIn();
      case 'welcome':
        return this.renderWelcome();
      case 'register':
        return this.renderRegister();
      case 'forgot':
        return this.renderForgot();
      case 'reset':
        return this.renderReset();
      case 'account':
        return this.renderAccount();
    }
  }

  private renderSignIn(): void {
    this.title.textContent = 'Sign in';
    const { google, password } = this.opts.api.methods;

    if (google) {
      // A navigation, not a request: Google's pages come next, and then this page again.
      const go = action('Sign in with Google', () =>
        location.assign(this.opts.api.googleSignInUrl(location.pathname)),
      );
      go.className = 'play';
      this.body.append(
        go,
        note(
          'Google tells the board your address and nothing else it keeps. The name that goes ' +
            'on the board is one you choose.',
        ),
      );
    }

    if (password) {
      const email = field('E-mail', 'email', 'username');
      const secret = field('Password', 'password', 'current-password');
      const form = this.form([email, secret], 'Sign in', async () => {
        const res = await this.opts.api.login(email.input.value, secret.input.value);
        if (!res.ok) return apiMessage(res);
        this.settle(res.player);
        this.hide();
        return null;
      });
      this.body.append(form);
      this.switcher.append(
        text('No account yet? '),
        link('Register', () => this.show('register')),
        text(' · '),
        link('Forgotten your password?', () => this.show('forgot')),
      );
    }

    if (!google && !password) {
      // Either the board is down, or it is up with no way in configured — a development server
      // with no Google client and passwords off. Only the first is the player's business.
      const why = this.opts.api.reachable
        ? 'This server has no way of signing in set up.'
        : 'The board cannot be reached just now, so there is nothing to sign in to.';
      this.body.append(note(`${why} The game plays without it — runs simply will not count.`));
    }
  }

  /** A first Google sign-in: the player exists once they have a name, and not before. */
  private renderWelcome(): void {
    this.title.textContent = 'Choose your name';
    const name = field('Name on the board', 'text', 'nickname');
    const form = this.form([name], 'Start playing', async () => {
      const res = await this.opts.api.finishGoogle(this.token, name.input.value);
      if (!res.ok) {
        if (res.code !== 'bad-token') return apiMessage(res);
        this.switcher.replaceChildren(link('Sign in again', () => this.show('signin')));
        return 'That sign-in has expired. Signing in again takes a moment.';
      }
      this.settle(res.player);
      this.say(`Welcome, ${res.player.displayName}. Your runs count from now on.`, 'ok');
      setTimeout(() => this.hide(), 1800);
      return null;
    });
    this.body.append(form);
    this.switcher.append(
      text('It goes on the public board, so it need not be your real one. '),
      text('3 to 20 characters.'),
    );
  }

  private renderRegister(): void {
    this.title.textContent = 'Register';
    const name = field('Name on the board', 'text', 'nickname');
    const email = field('E-mail', 'email', 'username');
    const password = field('Password', 'password', 'new-password');
    password.input.setAttribute('minlength', '10');

    const form = this.form([name, email, password], 'Register', async () => {
      const res = await this.opts.api.register(
        email.input.value,
        password.input.value,
        name.input.value,
      );
      if (!res.ok) return apiMessage(res);
      this.say(
        `If ${email.input.value} can receive mail, a confirmation link is on its way. ` +
          'Follow it and your runs start counting.',
        'ok',
      );
      this.body.replaceChildren();
      this.switcher.replaceChildren(link('Back to signing in', () => this.show('signin')));
      return null;
    });

    this.body.append(form);
    this.switcher.append(
      text('The name is public and goes on the board. '),
      text('The address is only ever used for these two links.'),
      document.createElement('br'),
      link('I already have an account', () => this.show('signin')),
    );
  }

  private renderForgot(): void {
    this.title.textContent = 'Reset your password';
    const email = field('E-mail', 'email', 'username');
    const form = this.form([email], 'Send the link', async () => {
      const res = await this.opts.api.forgot(email.input.value);
      if (!res.ok) return apiMessage(res);
      // The server will not say whether the address has an account, so neither does this.
      this.say('If that address has an account, a reset link is on its way.', 'ok');
      this.body.replaceChildren();
      this.switcher.replaceChildren(link('Back to signing in', () => this.show('signin')));
      return null;
    });
    this.body.append(form);
    this.switcher.append(link('Back to signing in', () => this.show('signin')));
  }

  private renderReset(): void {
    this.title.textContent = 'Choose a new password';
    const password = field('New password', 'password', 'new-password');
    password.input.setAttribute('minlength', '10');
    const form = this.form([password], 'Set it', async () => {
      const res = await this.opts.api.resetPassword(this.token, password.input.value);
      if (!res.ok) return apiMessage(res);
      this.settle(res.player);
      this.say('Done. Every other device has been signed out.', 'ok');
      setTimeout(() => this.hide(), 1800);
      return null;
    });
    this.body.append(form);
  }

  private renderAccount(): void {
    const account = this.opts.api.account;
    if (!account) return this.renderSignIn();

    this.title.textContent = account.displayName;
    const lines = document.createElement('div');
    lines.className = 'readout';
    lines.textContent = !account.verified
      ? `${account.email} · not confirmed yet`
      : account.password
        ? `${account.email} · confirmed · your runs count`
        : `${account.email} · signed in with Google · your runs count`;
    this.body.append(lines);

    // Only where there is mail to send it with.
    if (!account.verified && this.opts.api.methods.password) {
      this.body.append(
        action('Send the confirmation link again', () =>
          this.run(async () => {
            const res = await this.opts.api.resendVerification(account.email);
            if (!res.ok) return apiMessage(res);
            this.say('On its way.', 'ok');
            return null;
          }),
        ),
      );
    }

    this.body.append(
      action('Sign out', () =>
        this.run(async () => {
          await this.opts.api.logout();
          this.settle(null);
          this.hide();
          return null;
        }),
      ),
    );

    this.switcher.replaceChildren(
      link('Close this account', () => {
        this.title.textContent = 'Close this account';
        // A password account proves it with the password. A Google one has none to ask for, so
        // typing the name stands in: the session already says who this is, and what is being
        // checked is that whoever is at the keyboard means it.
        const proof = account.password
          ? field('Password, to be sure', 'password', 'current-password')
          : field('Your name on the board, to be sure', 'text', 'off');
        const going = account.password
          ? 'Your address and password go.'
          : 'Your address goes, and the link to your Google account.';
        this.body.replaceChildren(
          note(
            `${going} Your runs stay on the board without a name on them — removing them ` +
              'would rewrite the standings of everyone who was ranked against you.',
          ),
          this.form([proof], 'Close it for good', async () => {
            const value = proof.input.value;
            const res = await this.opts.api.deleteAccount(
              account.password ? { password: value } : { confirm: value },
            );
            if (!res.ok) return apiMessage(res);
            this.settle(null);
            this.hide();
            return null;
          }),
        );
        this.switcher.replaceChildren(link('Keep it', () => this.show('account')));
      }),
    );
  }

  /* --- plumbing ---------------------------------------------------------- */

  /** A form whose submit runs `go`; a returned string is shown as the failure. */
  private form(
    fields: Field[],
    submitLabel: string,
    go: () => Promise<string | null>,
  ): HTMLFormElement {
    const form = document.createElement('form');
    for (const f of fields) form.append(f.root);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'play';
    submit.textContent = submitLabel;
    form.append(submit);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit.disabled = true;
      void this.run(go).finally(() => (submit.disabled = false));
    });
    return form;
  }

  /** Run one request at a time, and put whatever it complains about on screen. */
  private async run(go: () => Promise<string | null>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const problem = await go();
      if (problem) this.say(problem, 'bad');
    } finally {
      this.busy = false;
    }
  }

  private say(message: string, state: 'ok' | 'bad'): void {
    this.note.hidden = false;
    this.note.dataset['state'] = state;
    this.note.textContent = message;
  }

  private settle(account: Account | null): void {
    this.opts.api.account = account;
    this.opts.onAccount(account);
  }
}

interface Field {
  root: HTMLElement;
  input: HTMLInputElement;
}

function field(label: string, type: string, autocomplete: string): Field {
  const root = document.createElement('label');
  root.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  // As an attribute: the typed property only admits the standard tokens, and a password manager
  // is happier being told `nickname` than being told nothing.
  input.setAttribute('autocomplete', autocomplete);
  input.required = true;
  root.append(caption, input);
  return { root, input };
}

function action(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'link';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

const link = action;

function text(value: string): Text {
  return document.createTextNode(value);
}

function note(value: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'hint';
  el.textContent = value;
  return el;
}

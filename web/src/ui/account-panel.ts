/*
 * The account overlay: signing in, registering, and the two links that arrive by mail.
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

type Mode = 'signin' | 'register' | 'forgot' | 'reset' | 'account';

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
   * Open straight onto a link that arrived by mail.
   *
   * Both links land on the page as a query parameter rather than on a route of their own, so
   * there is still exactly one document and the game is already loading behind the panel.
   */
  openFromLink(kind: 'verify' | 'reset', token: string): void {
    this.token = token;
    if (kind === 'reset') {
      this.show('reset');
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

  /* --- screens ----------------------------------------------------------- */

  private render(): void {
    this.body.replaceChildren();
    this.switcher.replaceChildren();
    this.note.hidden = true;

    switch (this.mode) {
      case 'signin':
        return this.renderSignIn();
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
    const email = field('E-mail', 'email', 'username');
    const password = field('Password', 'password', 'current-password');
    const form = this.form([email, password], 'Sign in', async () => {
      const res = await this.opts.api.login(email.input.value, password.input.value);
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
    lines.textContent = account.verified
      ? `${account.email} · confirmed · your runs count`
      : `${account.email} · not confirmed yet`;
    this.body.append(lines);

    if (!account.verified) {
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
        const password = field('Password, to be sure', 'password', 'current-password');
        this.body.replaceChildren(
          note(
            'Your address and password go. Your runs stay on the board without a name on them — ' +
              'removing them would rewrite the standings of everyone who was ranked against you.',
          ),
          this.form([password], 'Close it for good', async () => {
            const res = await this.opts.api.deleteAccount(password.input.value);
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

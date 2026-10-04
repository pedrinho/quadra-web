/*
 * Moving between the app's views without leaving the document.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Each view is also a real file (see vite.config.ts), so a link can land on any of them and a
 * reload stays where it was. But once the app is up, following one of its own links only swaps
 * the panel: the board keeps its pixels, the fonts and the sound stay loaded, and the address bar
 * still says where you are, so Back and a copied link both work.
 */

export type Route = 'play' | 'board' | 'runs' | 'about';

/** The address each view lives at. The `.html` spellings are what `vite dev` serves them as. */
const PATHS: Record<string, Route> = {
  '/': 'play',
  '/index.html': 'play',
  '/records': 'board',
  '/records.html': 'board',
  '/player-highscores': 'runs',
  '/player-highscores.html': 'runs',
  '/about': 'about',
  '/about.html': 'about',
};

export function routeOf(pathname: string): Route | null {
  return PATHS[pathname.replace(/\/$/, '') || '/'] ?? null;
}

export class Router {
  constructor(private readonly onChange: (route: Route) => void) {
    document.addEventListener('click', this.onClick);
    window.addEventListener('popstate', () => this.onChange(this.route));
  }

  get route(): Route {
    return routeOf(location.pathname) ?? 'play';
  }

  /** Go to `href` inside the app. Same-route links still go, so a `?fresh=` can arrive. */
  go(href: string): void {
    const url = new URL(href, location.href);
    history.pushState(null, '', url.pathname + url.search + url.hash);
    this.onChange(this.route);
  }

  private readonly onClick = (e: MouseEvent): void => {
    // A modified click is someone asking for a new tab, and gets the browser's own behaviour.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-link]');
    if (!anchor) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || !routeOf(url.pathname)) return;
    e.preventDefault();
    this.go(url.href);
  };
}

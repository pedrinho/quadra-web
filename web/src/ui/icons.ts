/*
 * The handful of icons the interface uses, as inline SVG.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Drawn rather than typed. ▶, ❚❚, 🔊 and the arrow keys are characters the page's faces do not
 * have, so each one used to be set in whatever fallback font the system picked — a different
 * typeface on every machine, and a different weight from everything around it.
 */

const PATHS = {
  play: '<path d="M8 5.5v13l10.5-6.5z" stroke-linejoin="round"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  sound:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" stroke-linejoin="round"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  muted:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" stroke-linejoin="round"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** An icon at the current text colour. Decorative: the control it sits in carries the label. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = PATHS[name];
  return svg;
}

/** Put `name` in `button` in place of whatever it showed, and say what it does. */
export function setIcon(button: HTMLElement, name: IconName, label: string): void {
  button.replaceChildren(icon(name));
  button.setAttribute('aria-label', label);
  button.title = label;
}

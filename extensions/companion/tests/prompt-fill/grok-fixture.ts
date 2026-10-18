import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads the saved Grok Imagine fixture page and, optionally, makes its shape
 * button behave like the live menu: it opens on pointerdown, an item press
 * updates the button's label and closes the menu.
 */
// happy-dom replaces URL, so the path is joined instead of resolved.
const FIXTURE = readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'grok-imagine.html'),
  'utf8',
);

export interface GrokFixture {
  aspectButton: HTMLButtonElement;
  submitButton: HTMLButtonElement;
  /** Every press that reached the Generate button or submitted the form. */
  generatePresses: () => number;
  menuOpens: () => number;
}

export function loadGrokFixture({
  workingMenu = true,
  takesShape = true,
}: { workingMenu?: boolean; takesShape?: boolean } = {}): GrokFixture {
  document.body.innerHTML = FIXTURE;
  const aspectButton = document.getElementById('aspect') as HTMLButtonElement;
  const submitButton = document.getElementById('submit') as HTMLButtonElement;
  let generate = 0;
  let opens = 0;
  submitButton.addEventListener('click', () => {
    generate += 1;
  });
  document.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    generate += 1;
  });

  if (workingMenu) {
    const template = document.getElementById(
      'aspect-menu',
    ) as HTMLTemplateElement;
    aspectButton.addEventListener('pointerdown', () => {
      if (document.querySelector('[role="menu"]')) return;
      opens += 1;
      aspectButton.setAttribute('aria-expanded', 'true');
      const menu = template.content.firstElementChild?.cloneNode(true);
      if (!(menu instanceof HTMLElement)) return;
      for (const item of menu.querySelectorAll('[role="menuitemradio"]')) {
        item.addEventListener('click', () => {
          const label = aspectButton.querySelector('span');
          if (label && takesShape) {
            label.textContent = item.textContent?.trim() ?? '';
          }
          aspectButton.setAttribute('aria-expanded', 'false');
          menu.remove();
        });
      }
      document.body.append(menu);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape')
        document.querySelector('[role="menu"]')?.remove();
    });
  }

  return {
    aspectButton,
    submitButton,
    generatePresses: () => generate,
    menuOpens: () => opens,
  };
}

export const aspectLabel = (): string =>
  document.querySelector('#aspect span')?.textContent ?? '';

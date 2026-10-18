// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { findAspectButton, setAspect } from '../../src/prompt-fill/aspect';
import { findAiSite, type AspectMenu } from '../../src/sites/ai-sites';
import { aspectLabel, loadGrokFixture } from './grok-fixture';

const WAIT = { timeoutMs: 60, intervalMs: 5 };
const grokMenu = findAiSite('grok-imagine')?.aspectMenu as AspectMenu;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Grok shape menu', () => {
  it('is in the catalog', () => {
    expect(grokMenu).toBeTruthy();
  });

  it('finds the shape button by its ratio label, not Generate', () => {
    loadGrokFixture();
    expect(findAspectButton(grokMenu, document)?.id).toBe('aspect');
  });

  it('opens the menu, picks the shape and checks the button shows it', async () => {
    const page = loadGrokFixture();

    await expect(setAspect(grokMenu, document, '16:9', WAIT)).resolves.toBe(
      'set',
    );

    expect(aspectLabel()).toBe('16:9');
    expect(page.menuOpens()).toBe(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(page.generatePresses()).toBe(0);
  });

  it('matches whole ratios only: 9:16 is not 19:16', async () => {
    document.body.innerHTML =
      '<button type="button" id="aspect"><span>1:1</span></button>';
    const button = document.getElementById('aspect') as HTMLButtonElement;
    button.addEventListener('pointerdown', () => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      for (const ratio of ['19:16', '9:16']) {
        const item = document.createElement('div');
        item.setAttribute('role', 'menuitemradio');
        item.textContent = ratio;
        item.addEventListener('click', () => {
          const label = button.querySelector('span');
          if (label) label.textContent = ratio;
          menu.remove();
        });
        menu.append(item);
      }
      document.body.append(menu);
    });

    await expect(setAspect(grokMenu, document, '9:16', WAIT)).resolves.toBe(
      'set',
    );
    expect(aspectLabel()).toBe('9:16');
  });

  it('does nothing when the shape is already right', async () => {
    const page = loadGrokFixture();
    await expect(setAspect(grokMenu, document, '2:3', WAIT)).resolves.toBe(
      'set',
    );
    expect(page.menuOpens()).toBe(0);
  });

  it('closes the menu again when the site has no such shape', async () => {
    const page = loadGrokFixture();
    await expect(setAspect(grokMenu, document, '4:3', WAIT)).resolves.toBe(
      'no-option',
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(aspectLabel()).toBe('2:3');
    expect(page.generatePresses()).toBe(0);
  });

  it('reports a menu that never opens', async () => {
    loadGrokFixture({ workingMenu: false });
    await expect(setAspect(grokMenu, document, '16:9', WAIT)).resolves.toBe(
      'no-option',
    );
  });

  it('says so when the page does not take the shape', async () => {
    // The menu closes but the page keeps its old shape.
    loadGrokFixture({ takesShape: false });

    await expect(setAspect(grokMenu, document, '16:9', WAIT)).resolves.toBe(
      'unconfirmed',
    );
  });

  it('finds no menu on a page without one', async () => {
    document.body.innerHTML = '<form><textarea></textarea></form>';
    await expect(setAspect(grokMenu, document, '16:9', WAIT)).resolves.toBe(
      'no-menu',
    );
  });

  it('never presses a submit button, even one labelled like a shape', async () => {
    let submitted = 0;
    document.body.innerHTML =
      '<form><textarea></textarea><button id="ratio">16:9</button></form>';
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted += 1;
    });
    document.getElementById('ratio')?.addEventListener('click', () => {
      submitted += 1;
    });

    await expect(setAspect(grokMenu, document, '9:16', WAIT)).resolves.toBe(
      'no-menu',
    );
    expect(submitted).toBe(0);
  });
});

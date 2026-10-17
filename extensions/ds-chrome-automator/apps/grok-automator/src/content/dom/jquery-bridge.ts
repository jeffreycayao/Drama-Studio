export interface QueryCollection<TElement extends Element = Element> {
  readonly length: number;
  readonly [index: number]: TElement | undefined;
  first(): QueryCollection<TElement>;
  last(): QueryCollection<TElement>;
  get(index: number): TElement | undefined;
  find<TFound extends Element = Element>(
    selector: string,
  ): QueryCollection<TFound>;
  is(selector: string): boolean;
  attr(name: string): string | undefined;
  text(): string;
  click(): QueryCollection<TElement>;
}

type QueryContext = Document | Element;

interface CustomPseudo {
  start: number;
  end: number;
  name: 'eq' | 'first' | 'last' | 'contains' | 'has' | 'visible';
  argument: string;
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement))
    return false;
  const bounds = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

function splitSelectorGroups(selector: string): string[] {
  const groups: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(' || character === '[') {
      depth += 1;
    } else if (character === ')' || character === ']') {
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      groups.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  groups.push(selector.slice(start).trim());
  return groups.filter(Boolean);
}

function parseParenthesizedArgument(
  selector: string,
  openIndex: number,
): { end: number; value: string } {
  let depth = 1;
  let quote: string | null = null;
  for (let index = openIndex + 1; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return { end: index + 1, value: selector.slice(openIndex + 1, index) };
      }
    }
  }
  throw new Error(`Unclosed selector pseudo-class: ${selector}`);
}

function findCustomPseudo(selector: string): CustomPseudo | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '(') {
      depth += 1;
      continue;
    }
    if (character === ']' || character === ')') {
      depth -= 1;
      continue;
    }
    if (character !== ':' || depth !== 0) continue;

    for (const name of [
      'eq',
      'first',
      'last',
      'contains',
      'has',
      'visible',
    ] as const) {
      const prefix = `:${name}`;
      if (!selector.startsWith(prefix, index)) continue;
      const nextIndex = index + prefix.length;
      if (name === 'visible' && selector[nextIndex] !== '(') {
        return { start: index, end: nextIndex, name, argument: '' };
      }
      if (selector[nextIndex] === '(') {
        const parsed = parseParenthesizedArgument(selector, nextIndex);
        return { start: index, end: parsed.end, name, argument: parsed.value };
      }
    }
  }
  return null;
}

function unique(elements: Element[]): Element[] {
  return [...new Set(elements)];
}

function nativeQuery(
  selector: string,
  contexts: readonly QueryContext[],
): Element[] {
  const normalized = selector.trim().replace(/\*$/, '');
  if (!normalized)
    return contexts.filter(
      (context): context is Element => context instanceof Element,
    );
  const results: Element[] = [];
  for (const context of contexts) {
    try {
      results.push(...context.querySelectorAll(normalized));
    } catch {
      // An archived selector can become invalid as Grok evolves; treat it as no match.
    }
  }
  return unique(results);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  return (first === '"' || first === "'") && trimmed.at(-1) === first
    ? trimmed.slice(1, -1)
    : trimmed;
}

function applyPseudo(elements: Element[], pseudo: CustomPseudo): Element[] {
  switch (pseudo.name) {
    case 'eq': {
      const requestedIndex = Number.parseInt(pseudo.argument, 10);
      const index =
        requestedIndex < 0 ? elements.length + requestedIndex : requestedIndex;
      return elements[index] ? [elements[index]] : [];
    }
    case 'first':
      return elements[0] ? [elements[0]] : [];
    case 'last':
      return elements.at(-1) ? [elements.at(-1)!] : [];
    case 'contains': {
      const text = unquote(pseudo.argument);
      return elements.filter((element) => element.textContent?.includes(text));
    }
    case 'has':
      return elements.filter(
        (element) => evaluateSelector(pseudo.argument, [element]).length > 0,
      );
    case 'visible':
      return elements.filter(isVisible);
  }
}

function evaluateGroup(
  selector: string,
  contexts: readonly QueryContext[],
): Element[] {
  const pseudo = findCustomPseudo(selector);
  if (!pseudo) {
    if (
      selector.startsWith(':') &&
      contexts.every((context) => context instanceof Element)
    ) {
      return contexts.filter(
        (context): context is Element =>
          context instanceof Element && context.matches(selector),
      );
    }
    return nativeQuery(selector, contexts);
  }

  const prefix = selector.slice(0, pseudo.start);
  const matched = applyPseudo(nativeQuery(prefix, contexts), pseudo);
  const remainder = selector.slice(pseudo.end);
  if (!remainder) return matched;
  if (remainder.startsWith(':')) return evaluateGroup(remainder, matched);
  if (/^\s/.test(remainder)) return evaluateSelector(remainder.trim(), matched);
  if (remainder.startsWith('>'))
    return nativeQuery(`:scope ${remainder}`, matched);
  return matched.filter((element) => {
    try {
      return element.matches(remainder);
    } catch {
      return false;
    }
  });
}

function evaluateSelector(
  selector: string,
  contexts: readonly QueryContext[],
): Element[] {
  return unique(
    splitSelectorGroups(selector).flatMap((group) =>
      evaluateGroup(group, contexts),
    ),
  );
}

class CleanQueryCollection<
  TElement extends Element = Element,
> implements QueryCollection<TElement> {
  readonly [index: number]: TElement | undefined;
  readonly length: number;

  constructor(private readonly elements: TElement[]) {
    this.length = elements.length;
    elements.forEach((element, index) => {
      Object.defineProperty(this, index, { value: element, enumerable: true });
    });
  }

  first(): QueryCollection<TElement> {
    return new CleanQueryCollection(this.elements.slice(0, 1));
  }

  last(): QueryCollection<TElement> {
    return new CleanQueryCollection(this.elements.slice(-1));
  }

  get(index: number): TElement | undefined {
    return this.elements[index];
  }

  find<TFound extends Element = Element>(
    selector: string,
  ): QueryCollection<TFound> {
    return new CleanQueryCollection(
      evaluateSelector(selector, this.elements) as TFound[],
    );
  }

  is(selector: string): boolean {
    if (selector === ':visible') return this.elements.some(isVisible);
    if (selector === ':disabled') {
      return this.elements.some((element) =>
        element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? element.disabled
          : element.getAttribute('aria-disabled') === 'true',
      );
    }
    return this.elements.some((element) => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    });
  }

  attr(name: string): string | undefined {
    return this.elements[0]?.getAttribute(name) ?? undefined;
  }

  text(): string {
    return this.elements.map((element) => element.textContent ?? '').join('');
  }

  click(): QueryCollection<TElement> {
    this.elements.forEach((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    return this;
  }
}

/** Compatibility adapter for the archived selector dialect used by Grok config. */
export function query<TElement extends Element = Element>(
  selector: string | TElement | readonly TElement[] | QueryCollection<TElement>,
): QueryCollection<TElement> {
  if (typeof selector === 'string') {
    return new CleanQueryCollection(
      evaluateSelector(selector, [document]) as TElement[],
    );
  }
  if (selector instanceof Element) return new CleanQueryCollection([selector]);
  if (Array.isArray(selector)) return new CleanQueryCollection([...selector]);
  const elements: TElement[] = [];
  for (let index = 0; index < selector.length; index += 1) {
    const element = selector[index];
    if (element) elements.push(element);
  }
  return new CleanQueryCollection(elements);
}

export function collectionToArray<TElement extends Element>(
  collection: QueryCollection<TElement>,
): TElement[] {
  const values: TElement[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const value = collection[index];
    if (value) values.push(value);
  }
  return values;
}

import type { Page } from 'playwright';
import type { ElementRegistry, InteractiveElement, AmbiguousMatch } from '../types.js';

export const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

class ElementRegistryImpl implements ElementRegistry {
  async scan(page: Page): Promise<InteractiveElement[]> {
    const elements = await page.evaluate((selector: string) => {
      const ELEMENT_LIMIT = 500;
      const nodes = Array.from(document.querySelectorAll(selector));

      // Deduplicate nodes that match multiple selectors
      const seen = new Set<Element>();
      const unique: Element[] = [];
      for (const node of nodes) {
        if (unique.length >= ELEMENT_LIMIT) break;
        if (!seen.has(node)) {
          seen.add(node);
          // Skip nested elements that are descendants of an already-added element with the same text
          if (unique.some(u => u.contains(node) && (u as HTMLElement).innerText?.trim() === (node as HTMLElement).innerText?.trim())) continue;
          unique.push(node);
        }
      }

      return unique.map((el, i) => {
        const htmlEl = el as HTMLElement;

        // Skip elements inside aria-hidden containers (B3)
        if (htmlEl.closest('[aria-hidden="true"]')) {
          return null;
        }

        // Skip hidden elements (offsetParent === null and position !== 'fixed')
        const style = window.getComputedStyle(htmlEl);
        if (htmlEl.offsetParent === null && style.position !== 'fixed') {
          return null;
        }

        // Skip elements outside viewport (B1 - off-screen menus, collapsed drawers)
        const rect = htmlEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) return null;

        // Resolve label text
        let labelText: string | undefined;
        const id = htmlEl.getAttribute('id');
        if (id) {
          const escapedId = CSS.escape(id);
          const labelEl = document.querySelector(`label[for="${escapedId}"]`);
          if (labelEl) {
            labelText = (labelEl as HTMLElement).innerText?.trim() || undefined;
          }
        }
        if (!labelText) {
          const closestLabel = htmlEl.closest('label');
          if (closestLabel) {
            labelText = closestLabel.innerText?.trim() || undefined;
          }
        }

        // text: prefer aria-label, fall back to innerText, then title/data-testid/type (U4)
        const ariaLabel = htmlEl.getAttribute('aria-label');
        const innerText = htmlEl.innerText?.trim();
        const titleAttr = htmlEl.getAttribute('title');
        const testId = htmlEl.getAttribute('data-testid');
        const typeAttr = htmlEl.getAttribute('type');
        const text = ariaLabel?.trim() || innerText || titleAttr?.trim() || testId || typeAttr || '';

        // input type / value / placeholder / disabled
        const tag = htmlEl.tagName.toLowerCase();
        const type = htmlEl.getAttribute('type') ?? undefined;
        const role = htmlEl.getAttribute('role') ?? undefined;
        const name = htmlEl.getAttribute('name') ?? undefined;
        const placeholder = htmlEl.getAttribute('placeholder') ?? undefined;
        const disabled =
          (htmlEl as HTMLInputElement).disabled === true ||
          htmlEl.getAttribute('disabled') !== null ||
          htmlEl.getAttribute('aria-disabled') === 'true';

        let value: string | undefined;
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          value = (htmlEl as HTMLInputElement).value || undefined;
        }

        // Generate a unique selector for this element (ID-based only; no DOM mutation)
        const selector: string | undefined = id ? `#${CSS.escape(id)}` : undefined;

        return {
          ref: `e${i + 1}`,
          tag,
          type,
          role,
          text,
          label: labelText,
          placeholder,
          name,
          value,
          disabled,
          selector,
        };
      }).filter((el): el is NonNullable<typeof el> => el !== null);
    }, INTERACTIVE_SELECTOR);

    // Assign ref and scanIndex after filtering (ref must be sequential after null removal)
    const withIndex = elements.map((el, idx) => ({ ...el, ref: `e${idx + 1}`, scanIndex: idx }));

    return withIndex as InteractiveElement[];
  }

  resolveByText(
    query: string,
    elements: InteractiveElement[],
    zone?: string,
    index?: number,
    role?: string,
  ): InteractiveElement | AmbiguousMatch | null {
    const normalized = normalize(query);
    const pool = zone ? elements.filter((e) => e.zone === zone) : elements;

    // Priority: exact match > prefix match > partial match
    const exact = pool.filter((e) => normalize(e.text) === normalized);
    const prefix = pool.filter((e) => normalize(e.text).startsWith(normalized));
    const partial = pool.filter((e) => normalize(e.text).includes(normalized));

    let candidates = pickBestMatches(exact, prefix, partial);

    if (role) {
      // Filter by role: match role attribute or tag via ROLE_TAG_MAP
      const roleFiltered = candidates.filter(
        (e) => e.role === role || e.tag === ROLE_TAG_MAP[role],
      );
      if (roleFiltered.length > 0) candidates = roleFiltered;
    } else {
      // No role specified: prioritize native interactive elements over ARIA-role elements
      candidates = prioritizeInteractive(candidates);
    }

    return resolveFromCandidates(query, candidates, index);
  }

  resolveByLabel(
    label: string,
    elements: InteractiveElement[],
    index?: number,
  ): InteractiveElement | AmbiguousMatch | null {
    const normalized = normalize(label);

    // Label match priority: label field > text field > placeholder > name field
    function matchScore(e: InteractiveElement): number | null {
      if (e.label && normalize(e.label) === normalized) return 0;
      if (normalize(e.text) === normalized) return 1;
      if (e.placeholder && normalize(e.placeholder) === normalized) return 2;
      if (e.name && normalize(e.name) === normalized) return 3;

      if (e.label && normalize(e.label).startsWith(normalized)) return 4;
      if (normalize(e.text).startsWith(normalized)) return 5;
      if (e.placeholder && normalize(e.placeholder).startsWith(normalized)) return 6;
      if (e.name && normalize(e.name).startsWith(normalized)) return 7;

      if (e.label && normalize(e.label).includes(normalized)) return 8;
      if (normalize(e.text).includes(normalized)) return 9;
      if (e.placeholder && normalize(e.placeholder).includes(normalized)) return 10;
      if (e.name && normalize(e.name).includes(normalized)) return 11;

      return null;
    }

    const scored = elements
      .map((e) => ({ e, score: matchScore(e) }))
      .filter((x): x is { e: InteractiveElement; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score);

    if (scored.length === 0) return null;

    // Extract the best-scoring candidates
    const bestScore = scored[0].score;
    const candidates = scored.filter((x) => x.score === bestScore).map((x) => x.e);

    return resolveFromCandidates(label, candidates, index);
  }
}

// Map from role name to corresponding native HTML tag
const ROLE_TAG_MAP: Record<string, string> = { button: 'button', link: 'a', menuitem: 'li' };

// Priority score for interactive elements: lower is higher priority
function interactivePriority(e: InteractiveElement): number {
  if (e.tag === 'a' || e.tag === 'button') return 1;
  if (e.tag === 'input' || e.tag === 'select' || e.tag === 'textarea') return 2;
  if (e.role === 'button' || e.role === 'link') return 3;
  return 4;
}

// Return only the highest-priority candidates; returns original array if single element
function prioritizeInteractive(candidates: InteractiveElement[]): InteractiveElement[] {
  if (candidates.length <= 1) return candidates;
  const sorted = [...candidates].sort((a, b) => interactivePriority(a) - interactivePriority(b));
  const best = interactivePriority(sorted[0]);
  return sorted.filter((e) => interactivePriority(e) === best);
}

// Normalize text: collapse whitespace, trim, and lowercase
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Return the best match group: exact > prefix > partial
function pickBestMatches(
  exact: InteractiveElement[],
  prefix: InteractiveElement[],
  partial: InteractiveElement[],
): InteractiveElement[] {
  if (exact.length > 0) return exact;
  if (prefix.length > 0) return prefix;
  return partial;
}

// Return a single element, AmbiguousMatch, or null from candidates
function resolveFromCandidates(
  query: string,
  candidates: InteractiveElement[],
  index?: number,
): InteractiveElement | AmbiguousMatch | null {
  if (candidates.length === 0) return null;

  if (index !== undefined) {
    const target = candidates[index];
    return target ?? null;
  }

  if (candidates.length === 1) return candidates[0];

  // Multiple candidates → return AmbiguousMatch
  return {
    query,
    candidates: candidates.map((e, i) => ({
      text: e.text,
      tag: e.tag,
      zone: e.zone,
      index: i,
    })),
    message: `Multiple elements match "${query}". Use the index parameter to specify the intended candidate.`,
  };
}

export function createElementRegistry(): ElementRegistry {
  return new ElementRegistryImpl();
}

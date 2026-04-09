import type { Page } from 'playwright';
import type { ZoneDefinition, ZoneSnapshot, ZoneManager, InteractiveElement } from '../types.js';

// djb2 hash (same algorithm as state-differ)
function djb2Hash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

class ZoneManagerImpl implements ZoneManager {
  private zones: ZoneDefinition[] = [];

  async autoDetect(page: Page): Promise<ZoneDefinition[]> {
    // Run all heuristics in a single page.evaluate() call
    const detected = await page.evaluate((): Array<{ name: string; selector: string }> => {
      const results: Array<{ name: string; selector: string }> = [];
      const seenElements = new Set<Element>();

      // Helper to build a unique CSS selector for an element
      function buildSelector(el: Element): string {
        // Prefer ID if available
        if (el.id) {
          return `#${CSS.escape(el.id)}`;
        }
        // Use semantic tag names directly (works even when not a direct child of body)
        const tag = el.tagName.toLowerCase();
        const semanticTags = new Set(['header', 'nav', 'main', 'aside', 'footer']);
        if (semanticTags.has(tag)) {
          // Use nth-of-type to disambiguate when the same tag appears multiple times
          const parent = el.parentElement ?? document.documentElement;
          const siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === tag);
          if (siblings.length === 1) return tag;
          const idx = siblings.indexOf(el as HTMLElement);
          return `${tag}:nth-of-type(${idx + 1})`;
        }
        // Use class names if they uniquely identify the element
        if (el.classList.length > 0) {
          const cls = Array.from(el.classList).map(c => `.${CSS.escape(c)}`).join('');
          const candidates = document.querySelectorAll(cls);
          if (candidates.length === 1) return cls;
          const tagCls = `${tag}${cls}`;
          const tagCandidates = document.querySelectorAll(tagCls);
          if (tagCandidates.length === 1) return tagCls;
        }
        // Use role attribute
        const role = el.getAttribute('role');
        if (role) {
          const roleSel = `[role="${role}"]`;
          const roleCandidates = document.querySelectorAll(roleSel);
          if (roleCandidates.length === 1) return roleSel;
          const tagRoleSel = `${tag}[role="${role}"]`;
          const tagRoleCandidates = document.querySelectorAll(tagRoleSel);
          if (tagRoleCandidates.length === 1) return tagRoleSel;
        }
        // Fallback: build path by traversing parent elements
        const parent = el.parentElement;
        if (parent && parent !== document.documentElement) {
          const parentSel = buildSelector(parent);
          const children = Array.from(parent.children).filter(c => c.tagName === el.tagName);
          if (children.length === 1) return `${parentSel} > ${tag}`;
          const idx = children.indexOf(el as HTMLElement);
          return `${parentSel} > ${tag}:nth-of-type(${idx + 1})`;
        }
        return tag;
      }

      function addZone(name: string, el: Element | null) {
        if (!el || seenElements.has(el)) return;
        seenElements.add(el);
        results.push({ name, selector: buildSelector(el) });
      }

      // 1. Semantic HTML elements
      addZone('header', document.querySelector('header'));
      addZone('nav', document.querySelector('nav'));
      addZone('main', document.querySelector('main'));
      addZone('aside', document.querySelector('aside'));
      addZone('footer', document.querySelector('footer'));

      // 2. ARIA landmark roles
      addZone('header', document.querySelector('[role="banner"]'));
      addZone('nav', document.querySelector('[role="navigation"]'));
      addZone('main', document.querySelector('[role="main"]'));
      addZone('aside', document.querySelector('[role="complementary"]'));
      addZone('footer', document.querySelector('[role="contentinfo"]'));

      // 3. Common CSS class/ID patterns
      const cssPatterns: Array<[string, string]> = [
        ['header', '#header'],
        ['nav', '.navbar'],
        ['nav', '#nav'],
        ['sidebar', '.sidebar'],
        ['sidebar', '#sidebar'],
        ['main', '.main-content'],
        ['main', '.page-content'],
        ['main', '.content'],
        ['main', '#content'],
        ['main', '#main'],
        ['header', '.app-bar'],
        ['nav', '.drawer'],
        ['footer', '.footer'],
      ];

      for (const [name, selector] of cssPatterns) {
        addZone(name, document.querySelector(selector));
      }

      // 4. Final fallback: if no zones detected, use the entire body as 'main'
      if (results.length === 0) {
        results.push({ name: 'main', selector: 'body' });
      }

      return results;
    });

    // Deduplicate: keep only the first entry for each zone name (highest priority)
    const seenNames = new Set<string>();
    const zones: ZoneDefinition[] = [];
    for (const z of detected) {
      if (!seenNames.has(z.name)) {
        seenNames.add(z.name);
        zones.push(z);
      }
    }

    // Cache the detected zones
    this.zones = zones;
    return zones;
  }

  setZones(zones: ZoneDefinition[]): void {
    this.zones = zones;
  }

  getZones(): ZoneDefinition[] {
    return this.zones;
  }

  async getZoneSnapshot(page: Page, zoneName: string): Promise<ZoneSnapshot> {
    const zone = this.zones.find(z => z.name === zoneName);
    if (!zone) {
      throw new Error(`Zone "${zoneName}" not found. Available zones: ${this.zones.map(z => z.name).join(', ')}`);
    }

    const { textContent, elements } = await page.evaluate((selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return { textContent: '', elements: [] as Array<Record<string, unknown>> };

      const text = (el as HTMLElement).innerText ?? el.textContent ?? '';

      // Collect interactive elements within the zone
      const interactiveSels = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"]';
      const elems = Array.from(el.querySelectorAll(interactiveSels)).map((node, idx) => {
        const tag = node.tagName.toLowerCase();
        const inputType = node.getAttribute('type') ?? undefined;
        const role = node.getAttribute('role') ?? undefined;
        const ariaLabel = node.getAttribute('aria-label') ?? '';
        const placeholder = node.getAttribute('placeholder') ?? undefined;
        const name = node.getAttribute('name') ?? undefined;
        const value = (node as HTMLInputElement).value ?? undefined;
        const disabled = (node as HTMLButtonElement).disabled ?? false;
        const nodeText = (node as HTMLElement).innerText?.trim() ?? node.textContent?.trim() ?? ariaLabel;

        // Resolve label text
        let labelText: string | undefined;
        const id = node.getAttribute('id');
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) labelText = labelEl.textContent?.trim();
        }
        if (!labelText) {
          const closestLabel = node.closest('label');
          if (closestLabel) {
            // Get label text excluding the text of nested input elements
            const clone = closestLabel.cloneNode(true) as HTMLElement;
            const inputs = clone.querySelectorAll('input, select, textarea');
            inputs.forEach(i => i.remove());
            labelText = clone.textContent?.trim();
          }
        }

        return {
          ref: `zone-${selector}-${idx}`,
          tag,
          type: inputType,
          role,
          text: nodeText,
          label: labelText,
          placeholder,
          name,
          value,
          disabled,
        };
      });

      return { textContent: text, elements: elems };
    }, zone.selector);

    return {
      name: zoneName,
      textContent,
      contentHash: djb2Hash(textContent),
      interactiveElements: elements as InteractiveElement[],
    };
  }
}

export function createZoneManager(): ZoneManager {
  return new ZoneManagerImpl();
}

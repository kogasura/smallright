import { type Page, type Locator } from 'playwright';
import type { InteractiveElement } from '../types.js';
import { INTERACTIVE_SELECTOR } from './element-registry.js';

export function escapeAttrValue(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

export function resolveLocator(page: Page, resolved: InteractiveElement): Locator {
  // 1. ID selector (most reliable)
  if (resolved.selector) {
    return page.locator(resolved.selector);
  }
  // 2. scanIndex (position-based, guaranteed unique from scan results)
  // Preferred over text/role because getByText/getByRole re-searches the page
  // and may find duplicates that scan() already filtered out.
  if (resolved.scanIndex !== undefined) {
    return page.locator(INTERACTIVE_SELECTOR).nth(resolved.scanIndex);
  }
  // 3. label (for input elements)
  if (resolved.label) {
    return page.getByLabel(resolved.label);
  }
  // 4. name attribute
  if (resolved.name) {
    return page.locator(`[name="${escapeAttrValue(resolved.name)}"]`);
  }
  // 5. placeholder
  if (resolved.placeholder) {
    return page.getByPlaceholder(resolved.placeholder);
  }
  // 6. role + text (fallback)
  if (resolved.role && resolved.text && resolved.text.trim()) {
    return page.getByRole(resolved.role as Parameters<Page['getByRole']>[0], { name: resolved.text });
  }
  // 7. text (fallback)
  if (resolved.text && resolved.text.trim()) {
    return page.getByText(resolved.text, { exact: true });
  }
  // 8. none available
  throw new Error(`Cannot resolve locator for element: ${resolved.text ?? resolved.tag}`);
}

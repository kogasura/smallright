import { type Page, type Locator } from 'playwright';
import type { InteractiveElement } from '../types.js';
import { INTERACTIVE_SELECTOR } from './element-registry.js';

export function escapeAttrValue(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

export function resolveLocator(page: Page, resolved: InteractiveElement): Locator {
  // 1. IDセレクタ
  if (resolved.selector) {
    return page.locator(resolved.selector);
  }
  // 2. role + text
  if (resolved.role && resolved.text && resolved.text.trim()) {
    return page.getByRole(resolved.role as Parameters<Page['getByRole']>[0], { name: resolved.text });
  }
  // 3. text (クリック系)
  if (resolved.text && resolved.text.trim()) {
    return page.getByText(resolved.text, { exact: true });
  }
  // 4. label (入力系)
  if (resolved.label) {
    return page.getByLabel(resolved.label);
  }
  // 5. name 属性
  if (resolved.name) {
    return page.locator(`[name="${escapeAttrValue(resolved.name)}"]`);
  }
  // 6. placeholder
  if (resolved.placeholder) {
    return page.getByPlaceholder(resolved.placeholder);
  }
  // 7. scanIndex フォールバック
  if (resolved.scanIndex !== undefined) {
    return page.locator(INTERACTIVE_SELECTOR).nth(resolved.scanIndex);
  }
  // 8. いずれもない
  throw new Error(`Cannot resolve locator for element: ${resolved.text ?? resolved.tag}`);
}

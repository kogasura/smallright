import type { Page } from "playwright";
import type {
  ActionModeState,
  InteractiveElement,
  PublicElement,
  StateBuilder,
  VisualModeState,
  ZoneSnapshot,
} from "../types.js";

const ACTION_TAGS = new Set(["button", "a"]);
const ACTION_ROLES = new Set(["button", "link", "menuitem"]);
const FORM_TAGS = new Set(["input", "select", "textarea"]);
const FORM_ROLES = new Set(["textbox", "combobox", "listbox", "searchbox"]);

function toPublicElement(el: InteractiveElement): PublicElement {
  const { ref: _ref, selector: _sel, scanIndex: _idx, context: _ctx, ...rest } = el;
  return rest;
}

function isActionElement(el: InteractiveElement): boolean {
  if (ACTION_TAGS.has(el.tag)) return true;
  if (el.role && ACTION_ROLES.has(el.role)) return true;
  return false;
}

function isFormElement(el: InteractiveElement): boolean {
  if (FORM_TAGS.has(el.tag)) return true;
  if (el.role && FORM_ROLES.has(el.role)) return true;
  return false;
}

function classifyTextPattern(text: string | undefined): string {
  if (!text || text.trim() === '') return 'repetitive';
  // Short text composed only of digits, date chars, weekday chars → repetitive
  if (text.length <= 20 && /^[\d年月日曜火水木金土\s:\/\-.]+$/.test(text)) return 'repetitive';
  // Everything else is unique
  return `unique:${text}`;
}

// Collapse groups of 10+ similar elements (same tag/role/type/disabled) into summary (U3/P3)
function collapseSimilar(elements: PublicElement[]): PublicElement[] {
  if (elements.length < 10) return elements;

  // Group by tag + role + type + disabled + text pattern
  const groups = new Map<string, { items: PublicElement[]; indices: number[] }>();
  elements.forEach((el, i) => {
    const key = `${el.tag}|${el.role ?? ''}|${el.type ?? ''}|${el.disabled}|${classifyTextPattern(el.text)}`;
    const group = groups.get(key);
    if (group) { group.items.push(el); group.indices.push(i); }
    else { groups.set(key, { items: [el], indices: [i] }); }
  });

  // Build result: keep non-collapsible elements, collapse large groups
  const result: PublicElement[] = [];
  const collapsed = new Set<number>();
  for (const [, group] of groups) {
    if (group.items.length >= 10) {
      // Keep first 3, add summary
      for (let j = 0; j < 3; j++) {
        result.push(group.items[j]);
      }
      result.push({
        tag: group.items[0].tag,
        text: `...and ${group.items.length - 3} more similar elements`,
        disabled: false,
      } as PublicElement);
      group.indices.forEach(i => collapsed.add(i));
    }
  }

  // Add non-collapsed elements in original order
  elements.forEach((el, i) => {
    if (!collapsed.has(i)) result.push(el);
  });

  return result;
}

function buildZoneSummary(zone: ZoneSnapshot): { name: string; summary: string } {
  const summary = zone.textContent.trim().slice(0, 100);
  return { name: zone.name, summary };
}

async function buildActionModeState(
  page: Page,
  elements: InteractiveElement[],
  zones?: ZoneSnapshot[]
): Promise<ActionModeState> {
  const url = page.url();
  const title = await page.title();

  const zoneList =
    zones && zones.length > 0 ? zones.map(buildZoneSummary) : [];

  const actions: PublicElement[] = collapseSimilar(
    elements.filter(isActionElement).map(toPublicElement)
  );

  const formFields: PublicElement[] = collapseSimilar(
    elements.filter(isFormElement).map(toPublicElement)
  );

  return { url, title, zones: zoneList, actions, formFields };
}

async function buildVisualModeState(page: Page): Promise<VisualModeState> {
  const url = page.url();
  const title = await page.title();

  let dom: string;
  try {
    dom = await page.locator('body').ariaSnapshot();
  } catch {
    dom = await page.content();
  }

  return { url, title, dom };
}

export function createStateBuilder(): StateBuilder {
  return {
    buildActionModeState,
    buildVisualModeState,
  };
}

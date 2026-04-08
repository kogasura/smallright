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
  const { ref: _ref, ...rest } = el;
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

  const actions: PublicElement[] = elements
    .filter(isActionElement)
    .map(toPublicElement);

  const formFields: PublicElement[] = elements
    .filter(isFormElement)
    .map(toPublicElement);

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

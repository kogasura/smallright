// Zone
export interface ZoneDefinition {
  name: string;           // "header", "main", "sidebar", etc.
  selector: string;       // CSS selector (internal use only, not exposed to AI)
  description?: string;
}

export interface ZoneSnapshot {
  name: string;
  textContent: string;
  contentHash: string;    // used for change detection
  interactiveElements: InteractiveElement[];
}

// Element (ref ID is internal. Use PublicElement in AI responses)
export interface InteractiveElement {
  ref: string;            // internal use only (not exposed to AI)
  tag: string;            // "button", "a", "input", etc.
  type?: string;          // input type
  role?: string;          // role attribute
  text: string;           // display text or aria-label
  label?: string;         // associated label text (for inputs)
  placeholder?: string;
  name?: string;          // name attribute
  value?: string;         // current value (for inputs)
  disabled: boolean;
  zone?: string;
  selector?: string;      // CSS selector that uniquely identifies this element (internal use only)
  scanIndex?: number;     // index in scan result array (internal use only, nth-based fallback)
  context?: string;       // Nearby heading or landmark label for disambiguation
}

export type PublicElement = Omit<InteractiveElement, "ref" | "selector" | "scanIndex" | "context">;

// Page state
export interface ActionModeState {
  url: string;
  title: string;
  zones: Array<{ name: string; summary: string }>;
  actions: PublicElement[];      // buttons and links
  formFields: PublicElement[];   // input, select, textarea
}

export interface VisualModeState {
  url: string;
  title: string;
  dom: string;          // full aria snapshot
  screenshot?: string;  // Base64 image (optional)
}

export interface StateDiff {
  url: { changed: boolean; from?: string; to?: string };
  changedZones: ZoneSnapshot[];
  unchangedZones: string[];
}

// Profile (~/.config/smallright/profiles/{domain}.json)
export interface SiteProfile {
  domain: string;
  zones: ZoneDefinition[];
  createdAt: string;
  updatedAt: string;
}

// Batch (AI specifies elements by text/label, not by ref or selector)
export interface BatchStep {
  action: "click" | "fill" | "fill_form" | "select" | "navigate" | "wait";
  text?: string;
  label?: string;
  value?: string;
  fields?: Record<string, string>;
  url?: string;
  ms?: number;
}

export interface BatchResult {
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  finalState?: ActionModeState;
  diff: StateDiff;
  error?: { stepIndex: number; message: string; stateAtError: ActionModeState };
}

// Returned when a query matches multiple elements
export interface AmbiguousMatch {
  query: string;
  candidates: Array<{ text: string; tag: string; zone?: string; context?: string; index: number }>;
  message: string;
}

// Core layer interfaces
export interface BrowserManager {
  getPage(): Promise<import('playwright').Page>;
  navigateTo(url: string): Promise<void>;
  waitForSpaReady(page: import('playwright').Page): Promise<void>;
  consumeDialogMessages(): Array<{ type: string; message: string }>;
  close(): Promise<void>;
}

export interface ElementRegistry {
  scan(page: import('playwright').Page): Promise<InteractiveElement[]>;
  resolveByText(query: string, elements: InteractiveElement[], zone?: string, index?: number, role?: string): InteractiveElement | AmbiguousMatch | null;
  resolveByLabel(label: string, elements: InteractiveElement[], index?: number): InteractiveElement | AmbiguousMatch | null;
}

export interface StateBuilder {
  buildActionModeState(page: import('playwright').Page, elements: InteractiveElement[], zones?: ZoneSnapshot[]): Promise<ActionModeState>;
  buildVisualModeState(page: import('playwright').Page): Promise<VisualModeState>;
}

export interface ZoneManager {
  autoDetect(page: import('playwright').Page): Promise<ZoneDefinition[]>;
  setZones(zones: ZoneDefinition[]): void;
  getZones(): ZoneDefinition[];
  getZoneSnapshot(page: import('playwright').Page, zoneName: string): Promise<ZoneSnapshot>;
}

export interface StateDiffer {
  takeSnapshot(page: import('playwright').Page, zones: ZoneDefinition[]): Promise<ZoneSnapshot[]>;
  computeDiff(before: ZoneSnapshot[], after: ZoneSnapshot[], urlBefore: string, urlAfter: string): StateDiff;
}

export interface ProfileManager {
  load(domain: string): Promise<SiteProfile | null>;
  save(domain: string, zones: ZoneDefinition[]): Promise<void>;
  list(): Promise<SiteProfile[]>;
  delete(domain: string): Promise<boolean>;
}

export interface BatchExecutor {
  execute(s: Services, steps: BatchStep[]): Promise<BatchResult>;
}

// Services bag pattern: aggregates all core service instances
export interface Services {
  browser: BrowserManager;
  elements: ElementRegistry;
  state: StateBuilder;
  zones: ZoneManager;
  differ: StateDiffer;
  profiles: ProfileManager;
  batch: BatchExecutor;
}

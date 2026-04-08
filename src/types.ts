// ゾーン
export interface ZoneDefinition {
  name: string;           // "header", "main", "sidebar" 等
  selector: string;       // CSSセレクタ（内部用、AIには見せない）
  description?: string;
}

export interface ZoneSnapshot {
  name: string;
  textContent: string;
  contentHash: string;    // 差分検出用
  interactiveElements: InteractiveElement[];
}

// 要素（ref IDは内部用。AIへのレスポンスには PublicElement を使う）
export interface InteractiveElement {
  ref: string;            // 内部用（AIには非公開）
  tag: string;            // "button", "a", "input" 等
  type?: string;          // input type
  role?: string;          // role属性
  text: string;           // 表示テキスト or aria-label
  label?: string;         // 関連するlabelのテキスト（input用）
  placeholder?: string;
  name?: string;          // name属性
  value?: string;         // 現在値（input用）
  disabled: boolean;
  zone?: string;
  selector?: string;      // 要素を一意に特定するCSSセレクタ（内部用）
}

export type PublicElement = Omit<InteractiveElement, "ref">;

// ページ状態
export interface ActionModeState {
  url: string;
  title: string;
  zones: Array<{ name: string; summary: string }>;
  actions: PublicElement[];      // ボタン・リンク
  formFields: PublicElement[];   // input・select・textarea
}

export interface VisualModeState {
  url: string;
  title: string;
  dom: string;          // フルariaSnapshot
  screenshot?: string;  // Base64画像（オプション）
}

export interface StateDiff {
  url: { changed: boolean; from?: string; to?: string };
  changedZones: ZoneSnapshot[];
  unchangedZones: string[];
}

// プロファイル（~/.config/smallright/profiles/{domain}.json）
export interface SiteProfile {
  domain: string;
  zones: ZoneDefinition[];
  createdAt: string;
  updatedAt: string;
}

// バッチ（AIはテキスト/ラベルで要素を指定）
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
  finalState: ActionModeState;
  diff: StateDiff;
  error?: { stepIndex: number; message: string; stateAtError: ActionModeState };
}

// 曖昧マッチ時の候補返却
export interface AmbiguousMatch {
  query: string;
  candidates: Array<{ text: string; tag: string; zone?: string; index: number }>;
  message: string;
}

// コア層のインターフェース（実装は各Phaseで追加）
export interface BrowserManager {
  getPage(): Promise<import('playwright').Page>;
  navigateTo(url: string): Promise<void>;
  close(): Promise<void>;
}

export interface ElementRegistry {
  scan(page: import('playwright').Page): Promise<InteractiveElement[]>;
  resolveByText(query: string, elements: InteractiveElement[], zone?: string, index?: number): InteractiveElement | AmbiguousMatch | null;
  resolveByLabel(label: string, elements: InteractiveElement[], index?: number): InteractiveElement | AmbiguousMatch | null;
}

export interface StateBuilder {
  buildActionModeState(page: import('playwright').Page, elements: InteractiveElement[], zones?: ZoneSnapshot[]): Promise<ActionModeState>;
  buildVisualModeState(page: import('playwright').Page): Promise<VisualModeState>;
}

// 以下はPhase 2以降で実装するため、最小限のインターフェースのみ
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

// サービス集約（server.tsで生成し、各ツールに渡す）
// freee-mcp-soloでは依存が2つ(client, cache)なので個別引数で済むが、
// smallrightは依存が多いためサービスバッグパターンを採用する
export interface Services {
  browser: BrowserManager;
  elements: ElementRegistry;
  state: StateBuilder;
  zones: ZoneManager;        // Phase 3で本実装、それ以前はスタブ
  differ: StateDiffer;       // Phase 2で本実装、それ以前はスタブ
  profiles: ProfileManager;  // Phase 4で本実装、それ以前はスタブ
  batch: BatchExecutor;      // Phase 5で本実装、それ以前はスタブ
}

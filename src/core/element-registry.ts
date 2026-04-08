import type { Page } from 'playwright';
import type { ElementRegistry, InteractiveElement, AmbiguousMatch } from '../types.js';

const INTERACTIVE_SELECTOR = [
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

      // 重複排除（同一ノードが複数セレクタにマッチする場合）
      const seen = new Set<Element>();
      const unique: Element[] = [];
      for (const node of nodes) {
        if (unique.length >= ELEMENT_LIMIT) break;
        if (!seen.has(node)) {
          seen.add(node);
          unique.push(node);
        }
      }

      return unique.map((el, i) => {
        const htmlEl = el as HTMLElement;

        // hidden要素の除外（offsetParent === null かつ position !== 'fixed'）
        const style = window.getComputedStyle(htmlEl);
        if (htmlEl.offsetParent === null && style.position !== 'fixed') {
          return null;
        }

        // label 解決
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

        // text: aria-label 優先、なければ innerText
        const ariaLabel = htmlEl.getAttribute('aria-label');
        const innerText = htmlEl.innerText?.trim();
        const text = ariaLabel?.trim() || innerText || '';

        // input の type / value / placeholder / disabled
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

        // ユニークセレクタの生成
        let selector: string;
        if (id) {
          selector = `#${CSS.escape(id)}`;
        } else {
          // tagName + :nth-of-type でユニークなセレクタを構築
          const tagName = htmlEl.tagName.toLowerCase();
          const parent = htmlEl.parentElement;
          if (parent) {
            const siblings = Array.from(parent.querySelectorAll(`:scope > ${tagName}`));
            const nthIndex = siblings.indexOf(htmlEl) + 1;
            // 親のセレクタを再帰的に構築するのではなく、ページ全体でのインデックスを使う
            selector = `${tagName}:nth-of-type(${nthIndex})`;
          } else {
            selector = tagName;
          }
          // グローバルにユニークでない場合は要素全体のインデックスをデータ属性として使う
          // （インデックスをデータ属性に設定し、それで選択する）
          const dataRef = `e${i + 1}`;
          htmlEl.setAttribute('data-smallright-ref', dataRef);
          selector = `[data-smallright-ref="${dataRef}"]`;
        }

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

    return elements as InteractiveElement[];
  }

  resolveByText(
    query: string,
    elements: InteractiveElement[],
    zone?: string,
    index?: number,
  ): InteractiveElement | AmbiguousMatch | null {
    const normalized = normalize(query);
    const pool = zone ? elements.filter((e) => e.zone === zone) : elements;

    // 優先順位: 完全一致 > 前方一致 > 部分一致
    const exact = pool.filter((e) => normalize(e.text) === normalized);
    const prefix = pool.filter((e) => normalize(e.text).startsWith(normalized));
    const partial = pool.filter((e) => normalize(e.text).includes(normalized));

    const candidates = pickBestMatches(exact, prefix, partial);

    return resolveFromCandidates(query, candidates, index);
  }

  resolveByLabel(
    label: string,
    elements: InteractiveElement[],
    index?: number,
  ): InteractiveElement | AmbiguousMatch | null {
    const normalized = normalize(label);

    // ラベルマッチ優先順位: label フィールド > text フィールド > placeholder > name フィールド
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

    // 最良スコアの候補群を取り出す
    const bestScore = scored[0].score;
    const candidates = scored.filter((x) => x.score === bestScore).map((x) => x.e);

    return resolveFromCandidates(label, candidates, index);
  }
}

// テキスト正規化: 連続空白→1つ、前後トリム、小文字化
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// 完全一致 > 前方一致 > 部分一致 の優先順位で最良グループを返す
function pickBestMatches(
  exact: InteractiveElement[],
  prefix: InteractiveElement[],
  partial: InteractiveElement[],
): InteractiveElement[] {
  if (exact.length > 0) return exact;
  if (prefix.length > 0) return prefix;
  return partial;
}

// 候補から1件 / AmbiguousMatch / null を返す
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

  // 複数候補 → AmbiguousMatch
  return {
    query,
    candidates: candidates.map((e, i) => ({
      text: e.text,
      tag: e.tag,
      zone: e.zone,
      index: i,
    })),
    message: `"${query}" に複数の要素がマッチしました。index パラメータで候補を指定してください。`,
  };
}

export function createElementRegistry(): ElementRegistry {
  return new ElementRegistryImpl();
}

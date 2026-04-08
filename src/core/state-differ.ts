import type { Page } from 'playwright';
import type { StateDiffer, StateDiff, ZoneDefinition, ZoneSnapshot } from '../types.js';

// djb2ハッシュ（軽量な差分検出用）
function djb2Hash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash = hash >>> 0; // 符号なし32bit
  }
  return hash.toString(16);
}

class StateDifferImpl implements StateDiffer {
  async takeSnapshot(page: Page, zones: ZoneDefinition[]): Promise<ZoneSnapshot[]> {
    // ゾーンが未設定の場合はページ全体を1ゾーンとして扱う
    const effectiveZones: ZoneDefinition[] =
      zones.length > 0 ? zones : [{ name: '_page', selector: 'body' }];

    const textContents = await page.evaluate((selectors: string[]) => {
      return selectors.map((selector) => {
        const el = document.querySelector(selector);
        return el ? (el as HTMLElement).innerText ?? el.textContent ?? '' : '';
      });
    }, effectiveZones.map((z) => z.selector));

    const snapshots: ZoneSnapshot[] = effectiveZones.map((zone, i) => {
      const textContent = textContents[i];
      return {
        name: zone.name,
        textContent,
        contentHash: djb2Hash(textContent),
        interactiveElements: [], // 差分検出にはtextContentのハッシュのみ使用
      };
    });
    return snapshots;
  }

  computeDiff(
    before: ZoneSnapshot[],
    after: ZoneSnapshot[],
    urlBefore: string,
    urlAfter: string,
  ): StateDiff {
    const urlChanged = urlBefore !== urlAfter;

    const beforeMap = new Map<string, ZoneSnapshot>(before.map((z) => [z.name, z]));
    const afterMap = new Map<string, ZoneSnapshot>(after.map((z) => [z.name, z]));

    const changedZones: ZoneSnapshot[] = [];
    const unchangedZones: string[] = [];

    for (const [name, afterZone] of afterMap) {
      const beforeZone = beforeMap.get(name);
      if (!beforeZone || beforeZone.contentHash !== afterZone.contentHash) {
        changedZones.push(afterZone);
      } else {
        unchangedZones.push(name);
      }
    }

    // before にあって after にない場合は変更扱い（削除されたゾーン）
    for (const [name, beforeZone] of beforeMap) {
      if (!afterMap.has(name)) {
        changedZones.push({ ...beforeZone, textContent: '', contentHash: '' });
      }
    }

    return {
      url: urlChanged
        ? { changed: true, from: urlBefore, to: urlAfter }
        : { changed: false },
      changedZones,
      unchangedZones,
    };
  }
}

export function createStateDiffer(): StateDiffer {
  return new StateDifferImpl();
}

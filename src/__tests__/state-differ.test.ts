import { describe, it, expect } from 'vitest';
import { createStateDiffer } from '../core/state-differ.js';
import type { ZoneSnapshot } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(name: string, textContent: string): ZoneSnapshot {
  // Simple hash: use the text itself as hash for predictable test data
  return {
    name,
    textContent,
    contentHash: textContent,
    interactiveElements: [],
  };
}

const differ = createStateDiffer();

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

describe('computeDiff', () => {
  it('変化なし → changedZones が空で unchangedZones に名前が含まれる', () => {
    const before = [makeSnapshot('main', 'Hello')];
    const after = [makeSnapshot('main', 'Hello')];
    const diff = differ.computeDiff(before, after, 'http://example.com/', 'http://example.com/');

    expect(diff.url.changed).toBe(false);
    expect(diff.changedZones).toHaveLength(0);
    expect(diff.unchangedZones).toContain('main');
  });

  it('1ゾーン変化 → changedZones に含まれる', () => {
    const before = [makeSnapshot('main', 'Before')];
    const after = [makeSnapshot('main', 'After')];
    const diff = differ.computeDiff(before, after, 'http://example.com/', 'http://example.com/');

    expect(diff.url.changed).toBe(false);
    expect(diff.changedZones).toHaveLength(1);
    expect(diff.changedZones[0].name).toBe('main');
    expect(diff.unchangedZones).toHaveLength(0);
  });

  it('URL 変化 → url.changed が true で from/to が正しい', () => {
    const before = [makeSnapshot('main', 'content')];
    const after = [makeSnapshot('main', 'content')];
    const diff = differ.computeDiff(
      before,
      after,
      'http://example.com/page1',
      'http://example.com/page2',
    );

    expect(diff.url.changed).toBe(true);
    expect(diff.url.from).toBe('http://example.com/page1');
    expect(diff.url.to).toBe('http://example.com/page2');
  });

  it('URL 変化なし → url.changed が false', () => {
    const before = [makeSnapshot('main', 'x')];
    const after = [makeSnapshot('main', 'x')];
    const diff = differ.computeDiff(
      before,
      after,
      'http://example.com/',
      'http://example.com/',
    );

    expect(diff.url.changed).toBe(false);
    expect(diff.url.from).toBeUndefined();
    expect(diff.url.to).toBeUndefined();
  });

  it('before にあって after にないゾーン → changedZones に空コンテンツで含まれる', () => {
    const before = [makeSnapshot('sidebar', 'Side content'), makeSnapshot('main', 'Main')];
    const after = [makeSnapshot('main', 'Main')];
    const diff = differ.computeDiff(before, after, 'http://example.com/', 'http://example.com/');

    const removedZone = diff.changedZones.find((z) => z.name === 'sidebar');
    expect(removedZone).toBeDefined();
    expect(removedZone!.textContent).toBe('');
    expect(removedZone!.contentHash).toBe('');
  });

  it('複数ゾーン: 一部変化・一部同一', () => {
    const before = [
      makeSnapshot('header', 'Header'),
      makeSnapshot('main', 'Old main'),
      makeSnapshot('footer', 'Footer'),
    ];
    const after = [
      makeSnapshot('header', 'Header'),
      makeSnapshot('main', 'New main'),
      makeSnapshot('footer', 'Footer'),
    ];
    const diff = differ.computeDiff(before, after, 'http://example.com/', 'http://example.com/');

    expect(diff.changedZones).toHaveLength(1);
    expect(diff.changedZones[0].name).toBe('main');
    expect(diff.unchangedZones).toContain('header');
    expect(diff.unchangedZones).toContain('footer');
  });
});

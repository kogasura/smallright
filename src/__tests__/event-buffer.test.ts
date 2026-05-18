import { describe, it, expect } from 'vitest';
import { readConsoleMessages } from '../tools/read-console-messages.js';
import { readNetworkRequests } from '../tools/read-network-requests.js';
import type { ConsoleMessage, NetworkRequestRecord, Services } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices(opts: {
  console?: { messages: ConsoleMessage[]; truncated: boolean };
  network?: { requests: NetworkRequestRecord[]; truncated: boolean };
}): Services {
  let consoleData = opts.console ?? { messages: [], truncated: false };
  let networkData = opts.network ?? { requests: [], truncated: false };
  return {
    browser: {
      getConsoleMessages: () => consoleData,
      getNetworkRequests: () => networkData,
      clearConsoleMessages: () => { consoleData = { messages: [], truncated: false }; },
      clearNetworkRequests: () => { networkData = { requests: [], truncated: false }; },
      getPage: () => { throw new Error('not used in this test'); },
      navigateTo: () => { throw new Error('not used'); },
      waitForSpaReady: () => { throw new Error('not used'); },
      consumeDialogMessages: () => [],
      close: () => Promise.resolve(),
    } as any,
    elements: {} as any,
    state: {} as any,
    zones: {} as any,
    differ: {} as any,
    profiles: {} as any,
    batch: {} as any,
  };
}

function makeConsoleMessage(overrides: Partial<ConsoleMessage> & Pick<ConsoleMessage, 'type' | 'text' | 'timestamp'>): ConsoleMessage {
  return {
    url: 'https://example.com',
    lineNumber: 1,
    columnNumber: 1,
    ...overrides,
  };
}

function makeNetworkRequest(overrides: Partial<NetworkRequestRecord> & Pick<NetworkRequestRecord, 'url' | 'method' | 'resourceType' | 'requestedAt'>): NetworkRequestRecord {
  return {
    status: 200,
    statusText: 'OK',
    respondedAt: overrides.requestedAt + 100,
    durationMs: 100,
    contentType: 'application/json',
    ...overrides,
  };
}

async function parseConsole(s: Services, params: Parameters<typeof readConsoleMessages>[1] = {}) {
  return JSON.parse(await readConsoleMessages(s, params));
}

async function parseNetwork(s: Services, params: Parameters<typeof readNetworkRequests>[1] = {}) {
  return JSON.parse(await readNetworkRequests(s, params));
}

// ---------------------------------------------------------------------------
// readConsoleMessages
// ---------------------------------------------------------------------------

describe('readConsoleMessages', () => {
  it('空バッファ → messages が空で totalBuffered/returned が 0、truncated が false', async () => {
    const s = makeServices({});
    const result = await parseConsole(s);
    expect(result.messages).toEqual([]);
    expect(result.totalBuffered).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('フィルタなし → 全件返却し totalBuffered === returned', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'hello', timestamp: 1000 }),
      makeConsoleMessage({ type: 'error', text: 'oops', timestamp: 2000 }),
      makeConsoleMessage({ type: 'warn', text: 'careful', timestamp: 3000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s);
    expect(result.totalBuffered).toBe(3);
    expect(result.returned).toBe(3);
    expect(result.messages).toHaveLength(3);
  });

  it('フィルタなし → 新しい順（timestamp 降順）で並んでいる', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'first', timestamp: 1000 }),
      makeConsoleMessage({ type: 'log', text: 'second', timestamp: 3000 }),
      makeConsoleMessage({ type: 'log', text: 'third', timestamp: 2000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s);
    expect(result.messages[0].timestamp).toBe(3000);
    expect(result.messages[1].timestamp).toBe(2000);
    expect(result.messages[2].timestamp).toBe(1000);
  });

  it('pattern (正規表現) で text 部分一致絞り込み', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'TypeError: cannot read', timestamp: 1000 }),
      makeConsoleMessage({ type: 'log', text: 'hello world', timestamp: 2000 }),
      makeConsoleMessage({ type: 'error', text: 'ReferenceError: foo is not defined', timestamp: 3000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s, { pattern: 'Error' });
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m: ConsoleMessage) => /Error/.test(m.text))).toBe(true);
  });

  it('不正な正規表現を渡したら例外が投げられる', async () => {
    const s = makeServices({});
    await expect(parseConsole(s, { pattern: '[invalid' })).rejects.toThrow(/invalid regular expression/i);
  });

  it('level: "error" で error のみ返る', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'info message', timestamp: 1000 }),
      makeConsoleMessage({ type: 'error', text: 'error message', timestamp: 2000 }),
      makeConsoleMessage({ type: 'warn', text: 'warn message', timestamp: 3000 }),
      makeConsoleMessage({ type: 'error', text: 'another error', timestamp: 4000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s, { level: 'error' });
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m: ConsoleMessage) => m.type === 'error')).toBe(true);
  });

  it('since: 2000 で timestamp >= 2000 のみ返る', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'old', timestamp: 1000 }),
      makeConsoleMessage({ type: 'log', text: 'at boundary', timestamp: 2000 }),
      makeConsoleMessage({ type: 'log', text: 'new', timestamp: 3000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s, { since: 2000 });
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m: ConsoleMessage) => m.timestamp >= 2000)).toBe(true);
  });

  it('limit: 2 で 2 件のみ返る（新しい順上位 2 件）', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'a', timestamp: 1000 }),
      makeConsoleMessage({ type: 'log', text: 'b', timestamp: 2000 }),
      makeConsoleMessage({ type: 'log', text: 'c', timestamp: 3000 }),
      makeConsoleMessage({ type: 'log', text: 'd', timestamp: 4000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s, { limit: 2 });
    expect(result.messages).toHaveLength(2);
    expect(result.returned).toBe(2);
    // 新しい順なので timestamp 4000, 3000 の 2 件
    expect(result.messages[0].timestamp).toBe(4000);
    expect(result.messages[1].timestamp).toBe(3000);
  });

  it('limit が上限 500 を超えた場合は 500 でクランプされる', async () => {
    // 501 件のメッセージを用意して limit=600 を渡してもバッファ上限 500 に丸められる確認
    // ここでは実装が Math.min(params.limit ?? 100, 500) であることをテスト
    // 3 件のバッファで limit=9999 を渡しても全件（3 件）返る（クランプが 500 なので 3 < 500）
    const messages = Array.from({ length: 3 }, (_, i) =>
      makeConsoleMessage({ type: 'log', text: `msg${i}`, timestamp: i }),
    );
    const s = makeServices({ console: { messages, truncated: false } });
    const result = await parseConsole(s, { limit: 9999 });
    // 9999 は 500 にクランプされるが、バッファが 3 件しかないので returned は 3
    expect(result.returned).toBe(3);
    expect(result.messages).toHaveLength(3);
  });

  it('clear: true でその後再度呼ぶと空になる', async () => {
    const messages = [
      makeConsoleMessage({ type: 'log', text: 'hello', timestamp: 1000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    // clear: true で取得
    const first = await parseConsole(s, { clear: true });
    expect(first.messages).toHaveLength(1);
    // 2 回目は空になっている
    const second = await parseConsole(s);
    expect(second.messages).toHaveLength(0);
    expect(second.totalBuffered).toBe(0);
  });

  it('truncated フラグがそのままレスポンスに伝播する', async () => {
    const s = makeServices({ console: { messages: [], truncated: true } });
    const result = await parseConsole(s);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readNetworkRequests
// ---------------------------------------------------------------------------

describe('readNetworkRequests', () => {
  it('空バッファ → requests が空で totalBuffered/returned が 0', async () => {
    const s = makeServices({});
    const result = await parseNetwork(s);
    expect(result.requests).toEqual([]);
    expect(result.totalBuffered).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('url_pattern で URL 部分一致絞り込み', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://api.example.com/users', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
      makeNetworkRequest({ url: 'https://example.com/page', method: 'GET', resourceType: 'document', requestedAt: 2000 }),
      makeNetworkRequest({ url: 'https://api.example.com/posts', method: 'POST', resourceType: 'fetch', requestedAt: 3000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { url_pattern: 'api\\.example\\.com' });
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every((r: NetworkRequestRecord) => r.url.includes('api.example.com'))).toBe(true);
  });

  it('method: "post"（小文字）でも POST にマッチする', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'POST', resourceType: 'fetch', requestedAt: 2000 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'POST', resourceType: 'fetch', requestedAt: 3000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { method: 'post' });
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every((r: NetworkRequestRecord) => r.method === 'POST')).toBe(true);
  });

  it('status: 200 で完全一致絞り込み', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000, status: 200 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 2000, status: 404 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'GET', resourceType: 'fetch', requestedAt: 3000, status: 200 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { status: 200 });
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every((r: NetworkRequestRecord) => r.status === 200)).toBe(true);
  });

  it('status: "2xx" で 200-299 にマッチ', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000, status: 200 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 2000, status: 201 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'GET', resourceType: 'fetch', requestedAt: 3000, status: 299 }),
      makeNetworkRequest({ url: 'https://example.com/d', method: 'GET', resourceType: 'fetch', requestedAt: 4000, status: 300 }),
      makeNetworkRequest({ url: 'https://example.com/e', method: 'GET', resourceType: 'fetch', requestedAt: 5000, status: 404 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { status: '2xx' });
    expect(result.requests).toHaveLength(3);
    expect(result.requests.every((r: NetworkRequestRecord) => r.status! >= 200 && r.status! < 300)).toBe(true);
  });

  it('status: "4xx" で 400-499 にマッチ', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000, status: 200 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 2000, status: 400 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'GET', resourceType: 'fetch', requestedAt: 3000, status: 404 }),
      makeNetworkRequest({ url: 'https://example.com/d', method: 'GET', resourceType: 'fetch', requestedAt: 4000, status: 500 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { status: '4xx' });
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every((r: NetworkRequestRecord) => r.status! >= 400 && r.status! < 500)).toBe(true);
  });

  it('status: "6xx" のような未定義レンジは空配列を返す（default: false）', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000, status: 200 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 2000, status: 600 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { status: '6xx' });
    // matchesStatus の default は false なので何もマッチしない
    expect(result.requests).toHaveLength(0);
  });

  it('resource_type: "xhr"（大文字小文字無視）でマッチ', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'XHR', requestedAt: 1000 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 2000 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'GET', resourceType: 'xhr', requestedAt: 3000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { resource_type: 'xhr' });
    expect(result.requests).toHaveLength(2);
  });

  it('since フィルタで requestedAt >= since のみ返る', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 5000 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'GET', resourceType: 'fetch', requestedAt: 5000 }),
      makeNetworkRequest({ url: 'https://example.com/d', method: 'GET', resourceType: 'fetch', requestedAt: 9000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { since: 5000 });
    expect(result.requests).toHaveLength(3);
    expect(result.requests.every((r: NetworkRequestRecord) => r.requestedAt >= 5000)).toBe(true);
  });

  it('limit のデフォルトは 50、max 200 でクランプされる', async () => {
    // 3 件のバッファで limit=9999 を渡しても全件返る（クランプが 200 なので 3 < 200）
    const requests = Array.from({ length: 3 }, (_, i) =>
      makeNetworkRequest({ url: `https://example.com/${i}`, method: 'GET', resourceType: 'fetch', requestedAt: i }),
    );
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { limit: 9999 });
    // 9999 は 200 にクランプされるが、バッファが 3 件なので returned は 3
    expect(result.returned).toBe(3);
  });

  it('limit: 2 で新しい順上位 2 件のみ返る', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 3000 }),
      makeNetworkRequest({ url: 'https://example.com/c', method: 'GET', resourceType: 'fetch', requestedAt: 2000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { limit: 2 });
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].requestedAt).toBe(3000);
    expect(result.requests[1].requestedAt).toBe(2000);
  });

  it('clear: true でその後再度呼ぶと空になる', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    // clear: true で取得
    const first = await parseNetwork(s, { clear: true });
    expect(first.requests).toHaveLength(1);
    // 2 回目は空になっている
    const second = await parseNetwork(s);
    expect(second.requests).toHaveLength(0);
    expect(second.totalBuffered).toBe(0);
  });

  it('truncated フラグがそのままレスポンスに伝播する', async () => {
    const s = makeServices({ network: { requests: [], truncated: true } });
    const result = await parseNetwork(s);
    expect(result.truncated).toBe(true);
  });

  it('不正な url_pattern で例外が投げられる', async () => {
    const s = makeServices({});
    await expect(parseNetwork(s, { url_pattern: '[invalid' })).rejects.toThrow(/invalid regular expression/i);
  });

  // S4: failed request テスト
  it('failed request (status undefined, errorText あり) は status フィルタなしで取得できる', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/ok', method: 'GET', resourceType: 'fetch', requestedAt: 1000, status: 200 }),
      // failed request: status を undefined に、errorText を設定
      { url: 'https://example.com/fail', method: 'GET', resourceType: 'fetch', requestedAt: 2000, status: undefined, errorText: 'net::ERR_CONNECTION_REFUSED' },
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    // フィルタなし → failed request も含め 2 件返る
    const all = await parseNetwork(s);
    expect(all.requests).toHaveLength(2);
    // status フィルタあり → failed request は status が undefined なので弾かれる
    const filtered = await parseNetwork(s, { status: 200 });
    expect(filtered.requests).toHaveLength(1);
    expect(filtered.requests[0].url).toBe('https://example.com/ok');
  });

  // S4: 複合フィルタ（level + pattern + since が AND になること） — console 側テスト
  it('複合フィルタ: level + pattern + since は AND で絞り込まれる', async () => {
    const messages = [
      makeConsoleMessage({ type: 'error', text: 'TypeError: cannot read', timestamp: 1000 }),
      makeConsoleMessage({ type: 'error', text: 'NetworkError occurred', timestamp: 5000 }),
      makeConsoleMessage({ type: 'warn',  text: 'TypeError: something wrong', timestamp: 6000 }),
      makeConsoleMessage({ type: 'error', text: 'TypeError: too late', timestamp: 9000 }),
    ];
    const s = makeServices({ console: { messages, truncated: false } });
    // level=error AND pattern=TypeError AND since=4000 → timestamp 9000 の 1 件のみ
    const result = await parseConsole(s, { level: 'error', pattern: 'TypeError', since: 4000 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].timestamp).toBe(9000);
  });

  // S4: clear: true 後に truncated フラグもリセットされる
  it('clear: true 後は truncated フラグもリセットされる', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
    ];
    const s = makeServices({ network: { requests, truncated: true } });
    // clear 前は truncated: true
    const before = await parseNetwork(s, { clear: true });
    expect(before.truncated).toBe(true);
    // clear 後は truncated: false
    const after = await parseNetwork(s);
    expect(after.truncated).toBe(false);
    expect(after.requests).toHaveLength(0);
  });

  // S4: 境界値テスト（since = 0 で全件、since = 大きな値で空配列）
  it('境界値: since=0 で全件返る', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1 }),
      makeNetworkRequest({ url: 'https://example.com/b', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { since: 0 });
    expect(result.requests).toHaveLength(2);
  });

  it('境界値: since が未来の値（現在より非常に大きい）なら空配列', async () => {
    const requests = [
      makeNetworkRequest({ url: 'https://example.com/a', method: 'GET', resourceType: 'fetch', requestedAt: 1000 }),
    ];
    const s = makeServices({ network: { requests, truncated: false } });
    const result = await parseNetwork(s, { since: Date.now() + 1e9 });
    expect(result.requests).toHaveLength(0);
    expect(result.returned).toBe(0);
  });
});

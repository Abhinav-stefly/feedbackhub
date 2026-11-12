import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';

const KEY = 'pk_' + 'A'.repeat(22);
const config = { apiUrl: 'https://api.example.com', projectKey: KEY };
const VOTER = 'voter-abcdefghijklmnop';

function reply(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return Promise.resolve(new Response(text, { status }));
}

function setup(responder: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(responder);
  const api = createApi(config, VOTER, {
    fetch: fetchMock as unknown as typeof fetch,
    timeoutMs: 1000,
  });
  return { api, fetchMock };
}

const input = { type: 'BUG' as const, title: 'Broken', description: 'The page is broken.' };

describe('submit', () => {
  it('POSTs JSON to the project URL, without cookies or referrer', async () => {
    const { api, fetchMock } = setup(() => reply(201, { feedback: { id: 'x' } }));
    await api.submit(input);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.example.com/api/public/projects/${KEY}/feedback`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it.each([
    [429, { error: { code: 'RATE_LIMITED' } }, 'rate_limited'],
    [404, { error: { code: 'NOT_FOUND' } }, 'not_found'],
    [413, { error: { code: 'PAYLOAD_TOO_LARGE' } }, 'too_large'],
    [500, { error: { code: 'INTERNAL_ERROR' } }, 'server'],
    [502, '<html>Bad gateway</html>', 'server'],
  ])('turns HTTP %i into %s', async (status, body, kind) => {
    const { api } = setup(() => reply(status, body));
    await expect(api.submit(input)).rejects.toMatchObject({ kind });
  });

  it('reports which fields the server rejected, ignoring unknown ones', async () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ field: 'title' }, { field: 'evil' }, { field: 'description' }],
      },
    };
    const { api } = setup(() => reply(400, body));
    await expect(api.submit(input)).rejects.toMatchObject({
      kind: 'validation',
      fields: ['title', 'description'],
    });
  });

  it('reports a network failure', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.submit(input)).rejects.toMatchObject({ kind: 'network' });
  });

  it('gives up after the timeout', async () => {
    const { api } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const error = await api.submit(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'timeout' });
  });
});

describe('board and votes', () => {
  it('lists items with the voter header, and coerces untrusted data defensively', async () => {
    const body = {
      items: [
        {
          id: 'a',
          type: 'BUG',
          title: 'T',
          description: 'D',
          status: 'PLANNED',
          voteCount: 3,
          hasVoted: true,
        },
        { id: 'b', type: 'WEIRD', title: 5, status: 'NOPE', voteCount: 'lots', hasVoted: 'yes' },
        { title: 'no id, dropped' },
        'garbage',
      ],
    };
    const { api, fetchMock } = setup(() => reply(200, body));
    const items = await api.listBoard();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('?sort=votes&pageSize=20');
    expect(init.headers).toEqual({ 'X-Voter-Id': VOTER });
    expect(items).toEqual([
      {
        id: 'a',
        type: 'BUG',
        title: 'T',
        description: 'D',
        status: 'PLANNED',
        voteCount: 3,
        hasVoted: true,
      },
      {
        id: 'b',
        type: 'OTHER',
        title: '5',
        description: '',
        status: 'UNDER_REVIEW',
        voteCount: 0,
        hasVoted: false,
      },
    ]);
  });

  it('votes with PUT and un-votes with DELETE, always sending the voter id', async () => {
    const { api, fetchMock } = setup(() => reply(200, { voted: true, voteCount: 2 }));
    expect(await api.vote('item/1')).toEqual({ voted: true, voteCount: 2 });
    await api.unvote('item-2');
    const [putUrl, putInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, delInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putInit.method).toBe('PUT');
    expect(putUrl).toContain('/item%2F1/vote'); // ids are URL-encoded
    expect(delInit.method).toBe('DELETE');
    expect(putInit.headers).toEqual({ 'X-Voter-Id': VOTER });
  });

  it('rejects a malformed vote reply instead of guessing', async () => {
    const { api } = setup(() => reply(200, { nonsense: true }));
    await expect(api.vote('x')).rejects.toMatchObject({ kind: 'server' });
  });
});

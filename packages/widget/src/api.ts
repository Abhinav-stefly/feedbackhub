import type { WidgetConfig } from './config';

export type FeedbackType = 'BUG' | 'FEATURE' | 'OTHER';
export type FeedbackStatus = 'UNDER_REVIEW' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
export type FieldName = 'type' | 'title' | 'description';

export interface SubmitInput {
  type: FeedbackType;
  title: string;
  description: string;
}

export interface PublicItem {
  id: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  voteCount: number;
  hasVoted: boolean;
}

export interface VoteResult {
  voted: boolean;
  voteCount: number;
}

export type ApiErrorKind =
  'validation' | 'rate_limited' | 'not_found' | 'too_large' | 'network' | 'timeout' | 'server';

/** Everything that can go wrong, reduced to a few kinds the UI knows how to explain. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly fields: FieldName[] = [],
  ) {
    super(message);
  }
}

export interface Api {
  submit(input: SubmitInput): Promise<void>;
  listBoard(): Promise<PublicItem[]>;
  vote(id: string): Promise<VoteResult>;
  unvote(id: string): Promise<VoteResult>;
}

const FIELD_NAMES: readonly string[] = ['type', 'title', 'description'];
const TYPES: readonly string[] = ['BUG', 'FEATURE', 'OTHER'];
const STATUSES: readonly string[] = [
  'UNDER_REVIEW',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'DECLINED',
];

// The server may be a free-tier host that is waking up from sleep, which can take a minute.
export const DEFAULT_TIMEOUT_MS = 45_000;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

function errorFromResponse(status: number, data: unknown): ApiError {
  const error = isObject(data) && isObject(data.error) ? data.error : {};
  if (status === 400) {
    const details = Array.isArray(error.details) ? error.details : [];
    const fields = details
      .map((d) => (isObject(d) ? d.field : undefined))
      .filter((f): f is FieldName => typeof f === 'string' && FIELD_NAMES.includes(f));
    return new ApiError('validation', 'The server rejected some fields', fields);
  }
  if (status === 429) return new ApiError('rate_limited', 'Too many requests');
  if (status === 404) return new ApiError('not_found', 'Project not found');
  if (status === 413) return new ApiError('too_large', 'Message too large');
  return new ApiError('server', `Server error (${status})`);
}

function parseItems(data: unknown): PublicItem[] {
  const items = isObject(data) && Array.isArray(data.items) ? data.items : [];
  const result: PublicItem[] = [];
  for (const raw of items) {
    if (!isObject(raw) || typeof raw.id !== 'string') continue;
    result.push({
      id: raw.id,
      type: TYPES.includes(String(raw.type)) ? (raw.type as FeedbackType) : 'OTHER',
      title: String(raw.title ?? ''),
      description: String(raw.description ?? ''),
      status: STATUSES.includes(String(raw.status))
        ? (raw.status as FeedbackStatus)
        : 'UNDER_REVIEW',
      voteCount: Number.isFinite(Number(raw.voteCount)) ? Number(raw.voteCount) : 0,
      hasVoted: raw.hasVoted === true,
    });
  }
  return result;
}

function parseVote(data: unknown): VoteResult {
  if (!isObject(data) || typeof data.voted !== 'boolean') throw new ApiError('server', 'Bad reply');
  const count = Number(data.voteCount);
  return { voted: data.voted, voteCount: Number.isFinite(count) ? count : 0 };
}

export function createApi(
  config: Pick<WidgetConfig, 'apiUrl' | 'projectKey'>,
  voterId: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Api {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = `${config.apiUrl}/api/public/projects/${config.projectKey}/feedback`;

  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    init: { body?: unknown; voter?: boolean } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.voter) headers['X-Voter-Id'] = voterId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: init.body === undefined ? null : JSON.stringify(init.body),
          signal: controller.signal,
          mode: 'cors',
          credentials: 'omit', // never send the host site's cookies to our API
          referrerPolicy: 'no-referrer', // never tell our API which page the visitor is on
          cache: 'no-store',
        });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        throw new ApiError(
          aborted ? 'timeout' : 'network',
          aborted ? 'Timed out' : 'Network error',
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(await response.text());
      } catch {
        data = undefined; // e.g. an HTML error page from a proxy
      }
      if (!response.ok) throw errorFromResponse(response.status, data);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async submit(input) {
      await request('POST', base, { body: input });
    },
    async listBoard() {
      return parseItems(await request('GET', `${base}?sort=votes&pageSize=20`, { voter: true }));
    },
    async vote(id) {
      return parseVote(
        await request('PUT', `${base}/${encodeURIComponent(id)}/vote`, { voter: true }),
      );
    },
    async unvote(id) {
      return parseVote(
        await request('DELETE', `${base}/${encodeURIComponent(id)}/vote`, { voter: true }),
      );
    },
  };
}

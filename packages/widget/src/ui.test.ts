import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type PublicItem } from './api';
import type { WidgetConfig } from './config';
import { SLOW_HINT_AFTER_MS, mountWidget, type WidgetHandle } from './ui';

const config: WidgetConfig = {
  projectKey: 'pk_' + 'A'.repeat(22),
  apiUrl: 'https://api.example.com',
  position: 'bottom-right',
  color: '#4f46e5',
  label: 'Feedback',
};

const item = (overrides: Partial<PublicItem> = {}): PublicItem => ({
  id: 'i1',
  type: 'FEATURE',
  title: 'Dark mode',
  description: 'A dark theme please',
  status: 'PLANNED',
  voteCount: 2,
  hasVoted: false,
  ...overrides,
});

function fakeApi(overrides: Partial<Api> = {}) {
  return {
    submit: vi.fn(async () => {}),
    listBoard: vi.fn(async () => [] as PublicItem[]),
    vote: vi.fn(async () => ({ voted: true, voteCount: 3 })),
    unvote: vi.fn(async () => ({ voted: false, voteCount: 1 })),
    ...overrides,
  } satisfies Api;
}

let handle: WidgetHandle | undefined;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(api: Api = fakeApi(), cfg: WidgetConfig = config) {
  handle = mountWidget(cfg, api);
  return handle;
}
const shadow = () => {
  const root = handle?.host.shadowRoot;
  if (!root) throw new Error('widget not mounted');
  return root;
};
function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = shadow().querySelector<T>(selector);
  if (!el) throw new Error(`not found: ${selector}`);
  return el;
}
const launcher = () => q<HTMLButtonElement>('.fh-launcher');
const panel = () => q('#fh-panel');
const titleInput = () => q<HTMLInputElement>('#fh-title');
const descInput = () => q<HTMLTextAreaElement>('#fh-desc');
const submitBtn = () => q<HTMLButtonElement>('button[type="submit"]');

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function fillValid() {
  type(titleInput(), '  Add dark mode  ');
  type(descInput(), '  It would be great at night.  ');
}
function key(target: Element, k: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  vi.useRealTimers();
});

describe('mounting and isolation', () => {
  it('adds exactly one element to the host page; everything else lives in the shadow root', () => {
    mount();
    expect(document.body.children).toHaveLength(1);
    expect(document.body.firstElementChild?.id).toBe('feedbackhub-widget');
    expect(handle?.host.children).toHaveLength(0); // no light-DOM children
    expect(shadow().querySelector('.fh-launcher')).not.toBeNull();
  });

  it('applies a stylesheet inside the shadow root', () => {
    mount();
    const hasStyle =
      shadow().querySelector('style') !== null || shadow().adoptedStyleSheets.length > 0;
    expect(hasStyle).toBe(true);
  });

  it('uses the configured label, position and accent colour', () => {
    mount(fakeApi(), { ...config, label: 'Help us', position: 'bottom-left', color: '#facc15' });
    expect(launcher().textContent).toBe('Help us');
    expect(q('.fh-root').classList.contains('fh-left')).toBe(true);
    expect(q('.fh-root').style.getPropertyValue('--fh-accent')).toBe('#facc15');
    expect(q('.fh-root').style.getPropertyValue('--fh-accent-text')).toBe('#111827'); // dark text on yellow
  });

  it('can be removed completely', () => {
    mount();
    handle?.destroy();
    expect(document.body.children).toHaveLength(0);
  });
});

describe('opening, closing and the keyboard', () => {
  it('opens from the button, moves focus into the form, and reports state to assistive tech', () => {
    mount();
    expect(panel().hidden).toBe(true);
    expect(launcher().getAttribute('aria-expanded')).toBe('false');
    launcher().click();
    expect(panel().hidden).toBe(false);
    expect(launcher().getAttribute('aria-expanded')).toBe('true');
    expect(shadow().activeElement).toBe(titleInput());
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
  });

  it('closes with Escape and puts focus back on the launcher', () => {
    mount();
    launcher().click();
    key(titleInput(), 'Escape');
    expect(panel().hidden).toBe(true);
    expect(shadow().activeElement).toBe(launcher());
  });

  it('closes with the close button', () => {
    mount();
    launcher().click();
    q('.fh-close').click();
    expect(panel().hidden).toBe(true);
  });

  it('keeps Tab focus trapped inside the open dialog', () => {
    mount();
    launcher().click();
    const first = q('.fh-close');
    const last = submitBtn();
    last.focus();
    key(last, 'Tab');
    expect(shadow().activeElement).toBe(first);
    key(first, 'Tab', { shiftKey: true });
    expect(shadow().activeElement).toBe(last);
  });

  it('exposes open() and close() for developers', () => {
    mount();
    handle?.open();
    expect(panel().hidden).toBe(false);
    handle?.close();
    expect(panel().hidden).toBe(true);
  });
});

describe('the feedback form', () => {
  it('explains problems, marks fields invalid, focuses the first one, and sends nothing', async () => {
    const api = fakeApi();
    mount(api);
    launcher().click();
    type(titleInput(), 'Hi');
    type(descInput(), 'short');
    submitBtn().click();
    await flush();
    expect(api.submit).not.toHaveBeenCalled();
    expect(titleInput().getAttribute('aria-invalid')).toBe('true');
    expect(q('#fh-title-error').hidden).toBe(false);
    expect(q('#fh-title-error').textContent).toMatch(/3 to 120/);
    expect(q('#fh-desc-error').textContent).toMatch(/10 to 2000/);
    expect(shadow().activeElement).toBe(titleInput());
  });

  it('clears an error as soon as the person starts fixing the field', () => {
    mount();
    launcher().click();
    submitBtn().click();
    type(titleInput(), 'A better title');
    expect(q('#fh-title-error').hidden).toBe(true);
    expect(titleInput().hasAttribute('aria-invalid')).toBe(false);
  });

  it('sends trimmed values, then shows a thank-you and clears the form', async () => {
    const api = fakeApi();
    mount(api);
    launcher().click();
    fillValid();
    submitBtn().click();
    await flush();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.submit).toHaveBeenCalledWith({
      type: 'FEATURE',
      title: 'Add dark mode',
      description: 'It would be great at night.',
    });
    expect(q('.fh-success').hidden).toBe(false);
    expect(q('form').hidden).toBe(true);
    expect(titleInput().value).toBe('');
    expect(shadow().activeElement?.textContent).toBe('Thank you!');
  });

  it('lets the person send more feedback afterwards', async () => {
    mount();
    launcher().click();
    fillValid();
    submitBtn().click();
    await flush();
    q<HTMLButtonElement>('.fh-success .fh-secondary').click();
    expect(q('form').hidden).toBe(false);
    expect(shadow().activeElement).toBe(titleInput());
  });

  it('shows a live character counter', () => {
    mount();
    launcher().click();
    type(descInput(), 'x'.repeat(42));
    expect(q('#fh-desc-count').textContent).toBe('42 / 2000');
  });

  it('ignores a double click: one request, button disabled while sending', async () => {
    let finish: () => void = () => {};
    const api = fakeApi({
      submit: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    mount(api);
    launcher().click();
    fillValid();
    submitBtn().click();
    submitBtn().click();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(submitBtn().disabled).toBe(true);
    expect(submitBtn().textContent).toBe('Sending\u2026');
    finish();
    await flush();
    expect(api.submit).toHaveBeenCalledTimes(1);
  });

  it('also ignores a second submit that bypasses the button (Enter key, requestSubmit)', async () => {
    let finish: () => void = () => {};
    const api = fakeApi({
      submit: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    mount(api);
    launcher().click();
    fillValid();
    const form = q<HTMLFormElement>('form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(api.submit).toHaveBeenCalledTimes(1);
    finish();
    await flush();
  });

  it('warns the person if sending is slow (a sleeping free-tier server)', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    mount(fakeApi({ submit: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) }));
    launcher().click();
    fillValid();
    submitBtn().click();
    const hint = q('.fh-slow');
    expect(hint.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(SLOW_HINT_AFTER_MS + 10);
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toMatch(/waking up/);
    finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(hint.hidden).toBe(true);
  });

  it.each([
    ['network', /couldn't reach the server/i],
    ['timeout', /took too long/i],
    ['rate_limited', /several messages recently/i],
    ['not_found', /isn't set up correctly/i],
    ['too_large', /too long to send/i],
    ['server', /went wrong on our side/i],
  ] as const)(
    'on a %s error: explains it, KEEPS what was typed, and allows a retry',
    async (kind, message) => {
      const api = fakeApi({
        submit: vi.fn(async () => {
          throw new ApiError(kind, kind);
        }),
      });
      mount(api);
      launcher().click();
      fillValid();
      submitBtn().click();
      await flush();
      expect(q('.fh-form-error').hidden).toBe(false);
      expect(q('.fh-form-error').textContent).toMatch(message);
      expect(titleInput().value).toBe('  Add dark mode  ');
      expect(submitBtn().disabled).toBe(false);
      expect(q('.fh-success').hidden).toBe(true);
    },
  );

  it('maps server-side field errors onto the right fields', async () => {
    const api = fakeApi({
      submit: vi.fn(async () => {
        throw new ApiError('validation', 'bad', ['description']);
      }),
    });
    mount(api);
    launcher().click();
    fillValid();
    submitBtn().click();
    await flush();
    expect(descInput().getAttribute('aria-invalid')).toBe('true');
    expect(shadow().activeElement).toBe(descInput());
  });

  it('retries successfully after a failure', async () => {
    const submit = vi
      .fn<Api['submit']>()
      .mockRejectedValueOnce(new ApiError('network', 'down'))
      .mockResolvedValueOnce(undefined);
    mount(fakeApi({ submit }));
    launcher().click();
    fillValid();
    submitBtn().click();
    await flush();
    submitBtn().click();
    await flush();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(q('.fh-success').hidden).toBe(false);
  });
});

describe('the ideas board', () => {
  it('shows no tabs when the team has not switched the public board on', async () => {
    const api = fakeApi({
      listBoard: vi.fn(async () => {
        throw new ApiError('not_found', 'x');
      }),
    });
    mount(api);
    launcher().click();
    await flush();
    expect(q('.fh-tabs').hidden).toBe(true);
  });

  it('shows no tabs, and no noise, if the board cannot be reached', async () => {
    mount(
      fakeApi({
        listBoard: vi.fn(async () => {
          throw new ApiError('network', 'x');
        }),
      }),
    );
    launcher().click();
    await flush();
    expect(q('.fh-tabs').hidden).toBe(true);
    expect(q('form').hidden).toBe(false);
  });

  it('shows tabs and lists ideas with their type, status and votes', async () => {
    mount(fakeApi({ listBoard: vi.fn(async () => [item()]) }));
    launcher().click();
    await flush();
    expect(q('.fh-tabs').hidden).toBe(false);
    q('#fh-tab-ideas').click();
    await flush();
    const text = q('#fh-view-ideas').textContent ?? '';
    expect(text).toContain('Dark mode');
    expect(text).toContain('Feature request');
    expect(text).toContain('Planned');
    expect(q('.fh-vote').getAttribute('aria-pressed')).toBe('false');
    expect(q('.fh-vote').textContent).toBe('2 votes. Vote for: Dark mode');
  });

  it('says so when there is nothing to vote on', async () => {
    mount(fakeApi({ listBoard: vi.fn(async () => []) }));
    launcher().click();
    await flush();
    q('#fh-tab-ideas').click();
    await flush();
    expect(q('#fh-view-ideas').textContent).toMatch(/No ideas to vote on yet/);
  });

  it('renders hostile text as harmless text, never as HTML', async () => {
    const evil = item({
      title: '<img src=x onerror="window.__pwned=1">',
      description: '<script>window.__pwned=2</script><b>bold?</b>',
    });
    mount(fakeApi({ listBoard: vi.fn(async () => [evil]) }));
    launcher().click();
    await flush();
    q('#fh-tab-ideas').click();
    await flush();
    expect(shadow().querySelectorAll('img, script, b')).toHaveLength(0);
    expect(q('.fh-item-title').textContent).toBe('<img src=x onerror="window.__pwned=1">');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('switches tabs with the arrow keys', async () => {
    mount(fakeApi({ listBoard: vi.fn(async () => [item()]) }));
    launcher().click();
    await flush();
    key(q('#fh-tab-send'), 'ArrowRight');
    expect(q('#fh-tab-ideas').getAttribute('aria-selected')).toBe('true');
    expect(q('#fh-view-ideas').hidden).toBe(false);
    expect(shadow().activeElement).toBe(q('#fh-tab-ideas'));
    key(q('#fh-tab-ideas'), 'ArrowLeft');
    expect(q('#fh-tab-send').getAttribute('aria-selected')).toBe('true');
  });
});

describe('voting', () => {
  async function openIdeas(api: Api) {
    mount(api);
    launcher().click();
    await flush();
    q('#fh-tab-ideas').click();
    await flush();
  }

  it('adds a vote, updates the count, and can take it back', async () => {
    const api = fakeApi({ listBoard: vi.fn(async () => [item()]) });
    await openIdeas(api);
    q('.fh-vote').click();
    await flush();
    expect(api.vote).toHaveBeenCalledWith('i1');
    expect(q('.fh-vote').getAttribute('aria-pressed')).toBe('true');
    expect(q('.fh-vote').textContent).toContain('3');

    q('.fh-vote').click();
    await flush();
    expect(api.unvote).toHaveBeenCalledWith('i1');
    expect(q('.fh-vote').getAttribute('aria-pressed')).toBe('false');
    expect(q('.fh-vote').textContent).toContain('1');
  });

  it('keeps keyboard focus on the vote button after voting', async () => {
    await openIdeas(fakeApi({ listBoard: vi.fn(async () => [item()]) }));
    q('.fh-vote').click();
    await flush();
    expect(shadow().activeElement).toBe(q('.fh-vote'));
  });

  it('is disabled while the vote is in flight (no double votes from double clicks)', async () => {
    let finish: () => void = () => {};
    const api = fakeApi({
      listBoard: vi.fn(async () => [item()]),
      vote: vi.fn(
        () =>
          new Promise<{ voted: boolean; voteCount: number }>(
            (resolve) => (finish = () => resolve({ voted: true, voteCount: 3 })),
          ),
      ),
    });
    await openIdeas(api);
    q('.fh-vote').click();
    expect(q<HTMLButtonElement>('.fh-vote').disabled).toBe(true);
    finish();
    await flush();
    expect(q<HTMLButtonElement>('.fh-vote').disabled).toBe(false);
    expect(api.vote).toHaveBeenCalledTimes(1);
  });

  it('tells the person when a vote fails, and leaves the count alone', async () => {
    const api = fakeApi({
      listBoard: vi.fn(async () => [item()]),
      vote: vi.fn(async () => {
        throw new ApiError('network', 'down');
      }),
    });
    await openIdeas(api);
    q('.fh-vote').click();
    await flush();
    expect(q('#fh-view-ideas').textContent).toMatch(/Couldn't save your vote/);
    expect(q('.fh-vote').getAttribute('aria-pressed')).toBe('false');
    expect(q('.fh-vote').textContent).toContain('2');
  });
});

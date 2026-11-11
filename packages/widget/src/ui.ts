import {
  ApiError,
  type Api,
  type FeedbackType,
  type FieldName,
  type PublicItem,
  type SubmitInput,
} from './api';
import { readableTextColor, type WidgetConfig } from './config';
import { append, clear, h } from './dom';
import { CSS } from './styles';

export const HOST_ID = 'feedbackhub-widget';
export const SLOW_HINT_AFTER_MS = 6000;

export interface WidgetHandle {
  open(): void;
  close(): void;
  destroy(): void;
  readonly host: HTMLElement;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  BUG: 'Bug',
  FEATURE: 'Feature request',
  OTHER: 'Other',
};
const STATUS_LABELS: Record<PublicItem['status'], string> = {
  UNDER_REVIEW: 'Under review',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
};

const FIELD_MESSAGES: Record<FieldName, string> = {
  type: 'Please choose a type.',
  title: 'Please enter a title of 3 to 120 characters.',
  description: 'Please describe it in 10 to 2000 characters.',
};

const ERROR_MESSAGES = {
  validation: 'Please check the highlighted fields.',
  rate_limited: "You've sent several messages recently. Please wait a few minutes and try again.",
  not_found: "This feedback form isn't set up correctly. Please let the site owner know.",
  too_large: 'Your message is too long to send. Please shorten it.',
  network:
    "We couldn't reach the server. Your message is still here. Check your connection and try again.",
  timeout: 'The server took too long to answer. Your message is still here. Please try again.',
  server: 'Something went wrong on our side. Please try again in a moment.',
} as const;

type Tab = 'send' | 'ideas';

function applyStyles(shadow: ShadowRoot): void {
  // Constructable stylesheets are not blocked by a host page's strict Content-Security-Policy;
  // an inline <style> element can be. We prefer the former and fall back to the latter.
  try {
    if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet !== 'undefined') {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
      return;
    }
  } catch {
    /* fall through to <style> */
  }
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
}

/** Adapts a keyboard handler to the generic event hook (and ignores non-keyboard events). */
function onKey(handler: (event: KeyboardEvent) => void): (event: Event) => void {
  return (event) => {
    if (event instanceof KeyboardEvent) handler(event);
  };
}

/** The server rejects the NUL character (it cannot be stored), so remove it before sending. */
function stripNul(value: string): string {
  return value.split('\u0000').join('');
}

function validate(input: SubmitInput): Partial<Record<FieldName, string>> {
  const problems: Partial<Record<FieldName, string>> = {};
  if (input.title.length < 3 || input.title.length > 120) problems.title = FIELD_MESSAGES.title;
  if (input.description.length < 10 || input.description.length > 2000) {
    problems.description = FIELD_MESSAGES.description;
  }
  return problems;
}

export function mountWidget(config: WidgetConfig, api: Api): WidgetHandle {
  // ------------------------------------------------------------------ skeleton
  const host = h('div', { id: HOST_ID });
  const shadow = host.attachShadow({ mode: 'open' });
  applyStyles(shadow);

  const root = h('div', {
    class: config.position === 'bottom-left' ? 'fh-root fh-left' : 'fh-root',
  });
  root.style.setProperty('--fh-accent', config.color);
  root.style.setProperty('--fh-accent-text', readableTextColor(config.color));

  const launcher = h(
    'button',
    {
      type: 'button',
      class: 'fh-launcher',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': 'fh-panel',
      onclick: () => (isOpen ? close() : open()),
    },
    config.label,
  );

  const live = h('div', { class: 'fh-sr-only', role: 'status', 'aria-live': 'polite' });

  // ---- form (send tab)
  const typeSelect = h(
    'select',
    { id: 'fh-type', class: 'fh-select', 'aria-describedby': 'fh-type-error' },
    ...(Object.keys(TYPE_LABELS) as FeedbackType[]).map((t) =>
      h('option', { value: t }, TYPE_LABELS[t]),
    ),
  );
  typeSelect.value = 'FEATURE';
  const titleInput = h('input', {
    id: 'fh-title',
    class: 'fh-input',
    type: 'text',
    maxlength: 120,
    autocomplete: 'off',
    'aria-describedby': 'fh-title-error',
    oninput: () => clearFieldError('title'),
  });
  const descInput = h('textarea', {
    id: 'fh-desc',
    class: 'fh-textarea',
    maxlength: 2000,
    rows: 5,
    'aria-describedby': 'fh-desc-error fh-desc-count',
    oninput: onDescInput,
  });
  const fieldErrors: Record<FieldName, HTMLElement> = {
    type: h('p', { id: 'fh-type-error', class: 'fh-error', hidden: true }),
    title: h('p', { id: 'fh-title-error', class: 'fh-error', hidden: true }),
    description: h('p', { id: 'fh-desc-error', class: 'fh-error', hidden: true }),
  };
  const fieldInputs: Record<FieldName, HTMLElement> = {
    type: typeSelect,
    title: titleInput,
    description: descInput,
  };
  const counter = h('p', { id: 'fh-desc-count', class: 'fh-hint' }, '0 / 2000');
  const formError = h('p', { class: 'fh-form-error', hidden: true });
  const slowHint = h('p', { class: 'fh-slow', hidden: true });
  const submitButton = h('button', { type: 'submit', class: 'fh-primary' }, 'Send feedback');

  const form = h(
    'form',
    { novalidate: true, onsubmit: onSubmit },
    h(
      'div',
      { class: 'fh-field' },
      h('label', { class: 'fh-label', for: 'fh-type' }, 'What kind of feedback is this?'),
      typeSelect,
      fieldErrors.type,
    ),
    h(
      'div',
      { class: 'fh-field' },
      h('label', { class: 'fh-label', for: 'fh-title' }, 'Title'),
      titleInput,
      fieldErrors.title,
    ),
    h(
      'div',
      { class: 'fh-field' },
      h('label', { class: 'fh-label', for: 'fh-desc' }, 'Details'),
      descInput,
      fieldErrors.description,
      counter,
    ),
    formError,
    slowHint,
    submitButton,
  );

  const successHeading = h('h3', { tabindex: -1 }, 'Thank you!');
  const success = h(
    'div',
    { class: 'fh-success', hidden: true },
    successHeading,
    h('p', {}, 'Your feedback was sent to the team.'),
    h(
      'button',
      { type: 'button', class: 'fh-secondary', onclick: showFormAgain },
      'Send more feedback',
    ),
    h('button', { type: 'button', class: 'fh-secondary', onclick: () => close() }, 'Close'),
  );
  const sendView = h(
    'div',
    { id: 'fh-view-send', role: 'tabpanel', 'aria-labelledby': 'fh-tab-send' },
    form,
    success,
  );

  // ---- ideas (vote tab)
  const ideasView = h('div', {
    id: 'fh-view-ideas',
    role: 'tabpanel',
    'aria-labelledby': 'fh-tab-ideas',
    hidden: true,
  });

  // ---- tabs (only shown when the team has switched the public board on)
  const tabSend = h(
    'button',
    {
      type: 'button',
      role: 'tab',
      class: 'fh-tab',
      id: 'fh-tab-send',
      'aria-controls': 'fh-view-send',
      'aria-selected': 'true',
      tabindex: 0,
      onclick: () => selectTab('send'),
    },
    'Send feedback',
  );
  const tabIdeas = h(
    'button',
    {
      type: 'button',
      role: 'tab',
      class: 'fh-tab',
      id: 'fh-tab-ideas',
      'aria-controls': 'fh-view-ideas',
      'aria-selected': 'false',
      tabindex: -1,
      onclick: () => selectTab('ideas'),
    },
    'Vote on ideas',
  );
  const tabs = h(
    'div',
    {
      class: 'fh-tabs',
      role: 'tablist',
      'aria-label': 'Feedback options',
      hidden: true,
      onkeydown: onKey(onTabKeys),
    },
    tabSend,
    tabIdeas,
  );

  const closeButton = h(
    'button',
    {
      type: 'button',
      class: 'fh-close',
      'aria-label': 'Close feedback form',
      onclick: () => close(),
    },
    '\u00d7',
  );
  const panel = h(
    'div',
    {
      id: 'fh-panel',
      class: 'fh-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'fh-title-heading',
      hidden: true,
      onkeydown: onKey(onPanelKeys),
    },
    h(
      'div',
      { class: 'fh-header' },
      h('h2', { id: 'fh-title-heading', class: 'fh-title' }, 'Share your feedback'),
      closeButton,
    ),
    tabs,
    h('div', { class: 'fh-body' }, sendView, ideasView),
  );

  append(root, [launcher, panel, live]);
  shadow.appendChild(root);
  document.body.appendChild(host);

  // ------------------------------------------------------------------ state
  let isOpen = false;
  let currentTab: Tab = 'send';
  let submitting = false;
  let boardReady = false;
  let boardLoading = false;
  let boardLoaded = false;
  let boardNote = '';
  let items: PublicItem[] = [];
  const pendingVotes = new Set<string>();
  let slowTimer: number | undefined;

  // ------------------------------------------------------------------ helpers
  function announce(message: string): void {
    live.textContent = '';
    window.setTimeout(() => {
      live.textContent = message;
    }, 20);
  }

  function active(): Element | null {
    return shadow.activeElement;
  }

  function focusables(): HTMLElement[] {
    const all = panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]');
    return Array.from(all).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.closest('[hidden]') === null,
    );
  }

  function clearFieldError(field: FieldName): void {
    fieldErrors[field].hidden = true;
    fieldErrors[field].textContent = '';
    fieldInputs[field].removeAttribute('aria-invalid');
  }

  function setFieldError(field: FieldName): void {
    fieldErrors[field].textContent = FIELD_MESSAGES[field];
    fieldErrors[field].hidden = false;
    fieldInputs[field].setAttribute('aria-invalid', 'true');
  }

  function clearAllErrors(): void {
    (['type', 'title', 'description'] as FieldName[]).forEach(clearFieldError);
    formError.hidden = true;
    formError.textContent = '';
  }

  function onDescInput(): void {
    counter.textContent = `${descInput.value.length} / 2000`;
    clearFieldError('description');
  }

  function setSubmitting(value: boolean): void {
    submitting = value;
    submitButton.disabled = value;
    submitButton.textContent = value ? 'Sending\u2026' : 'Send feedback';
    form.setAttribute('aria-busy', String(value));
  }

  // ------------------------------------------------------------------ open / close
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (!boardLoaded) void loadBoard();
    if (currentTab === 'send' && !form.hidden) titleInput.focus();
    else if (!success.hidden) successHeading.focus();
    else tabIdeas.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  function onPanelKeys(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog while it is open.
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const current = active();
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ------------------------------------------------------------------ tabs
  function selectTab(next: Tab, moveFocus = false): void {
    currentTab = next;
    const send = next === 'send';
    tabSend.setAttribute('aria-selected', String(send));
    tabIdeas.setAttribute('aria-selected', String(!send));
    tabSend.tabIndex = send ? 0 : -1;
    tabIdeas.tabIndex = send ? -1 : 0;
    sendView.hidden = !send;
    ideasView.hidden = send;
    if (moveFocus) (send ? tabSend : tabIdeas).focus();
    if (!send) void loadBoard();
  }

  function onTabKeys(event: KeyboardEvent): void {
    const order: Tab[] = ['send', 'ideas'];
    const index = order.indexOf(currentTab);
    if (event.key === 'ArrowRight') selectTab(order[(index + 1) % 2] ?? 'send', true);
    else if (event.key === 'ArrowLeft') selectTab(order[(index + 1) % 2] ?? 'send', true);
    else if (event.key === 'Home') selectTab('send', true);
    else if (event.key === 'End') selectTab('ideas', true);
    else return;
    event.preventDefault();
  }

  // ------------------------------------------------------------------ sending
  function showFormAgain(): void {
    success.hidden = true;
    form.hidden = false;
    titleInput.focus();
  }

  function showSuccess(): void {
    titleInput.value = '';
    descInput.value = '';
    counter.textContent = '0 / 2000';
    typeSelect.value = 'FEATURE';
    form.hidden = true;
    success.hidden = false;
    successHeading.focus();
    announce('Thank you! Your feedback was sent to the team.');
  }

  function handleSubmitError(err: unknown): void {
    const error = err instanceof ApiError ? err : new ApiError('server', 'Unexpected error');
    if (error.kind === 'validation') error.fields.forEach(setFieldError);
    formError.textContent = ERROR_MESSAGES[error.kind];
    formError.hidden = false;
    announce(ERROR_MESSAGES[error.kind]);
    const firstInvalid = error.fields[0];
    if (firstInvalid) fieldInputs[firstInvalid].focus();
    else submitButton.focus();
  }

  async function onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (submitting) return; // ignore double clicks
    clearAllErrors();

    const input: SubmitInput = {
      type: typeSelect.value as FeedbackType,
      title: stripNul(titleInput.value).trim(),
      description: stripNul(descInput.value).trim(),
    };
    const problems = validate(input);
    const invalid = Object.keys(problems) as FieldName[];
    if (invalid.length > 0) {
      invalid.forEach(setFieldError);
      announce(`${invalid.length === 1 ? 'One field needs' : 'Some fields need'} your attention.`);
      const first = invalid[0];
      if (first) fieldInputs[first].focus();
      return;
    }

    setSubmitting(true);
    slowTimer = window.setTimeout(() => {
      slowHint.textContent =
        'Still sending. The server may be waking up, so please keep this window open.';
      slowHint.hidden = false;
    }, SLOW_HINT_AFTER_MS);
    try {
      await api.submit(input);
      showSuccess();
    } catch (err) {
      handleSubmitError(err);
    } finally {
      window.clearTimeout(slowTimer);
      slowHint.hidden = true;
      slowHint.textContent = '';
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------------ ideas board
  async function loadBoard(): Promise<void> {
    if (boardLoading) return;
    boardLoading = true;
    boardNote = '';
    renderIdeas();
    try {
      items = await api.listBoard();
      boardLoaded = true;
      if (!boardReady) {
        boardReady = true;
        tabs.hidden = false;
      }
    } catch (err) {
      // Board switched off (404) or unreachable: keep the plain form, no tabs, no noise.
      // If we already have a list, keep showing it and add a small note.
      if (boardReady) boardNote = "Couldn't refresh the list. Showing the last version.";
      if (err instanceof ApiError && err.kind === 'not_found') boardLoaded = true;
    } finally {
      boardLoading = false;
      renderIdeas();
    }
  }

  async function toggleVote(item: PublicItem): Promise<void> {
    if (pendingVotes.has(item.id)) return;
    pendingVotes.add(item.id);
    boardNote = '';
    renderIdeas(item.id);
    try {
      const result = item.hasVoted ? await api.unvote(item.id) : await api.vote(item.id);
      item.hasVoted = result.voted;
      item.voteCount = result.voteCount;
      announce(
        result.voted
          ? `Vote added. ${result.voteCount} votes.`
          : `Vote removed. ${result.voteCount} votes.`,
      );
    } catch (err) {
      boardNote =
        err instanceof ApiError && err.kind === 'rate_limited'
          ? 'You are voting too quickly. Please wait a moment.'
          : "Couldn't save your vote. Please try again.";
      announce(boardNote);
    } finally {
      pendingVotes.delete(item.id);
      renderIdeas(item.id);
    }
  }

  function renderIdeas(focusId?: string): void {
    clear(ideasView);
    if (boardLoading && items.length === 0) {
      ideasView.appendChild(
        h('p', { class: 'fh-note', 'aria-busy': 'true' }, 'Loading ideas\u2026'),
      );
      return;
    }
    if (boardNote) ideasView.appendChild(h('p', { class: 'fh-form-error' }, boardNote));
    if (items.length === 0) {
      ideasView.appendChild(
        h('p', { class: 'fh-note' }, 'No ideas to vote on yet. Check back soon!'),
      );
      return;
    }
    const list = h('ul', { class: 'fh-items' });
    for (const item of items) {
      const count = String(item.voteCount);
      const voteButton = h(
        'button',
        {
          type: 'button',
          class: 'fh-vote',
          'data-id': item.id,
          'aria-pressed': String(item.hasVoted),
          disabled: pendingVotes.has(item.id),
          onclick: () => void toggleVote(item),
        },
        // The button's accessible name is built from its CONTENT: the visible count plus
        // screen-reader-only words. What people see and what assistive tech reads cannot drift apart.
        h('span', {}, count),
        h('span', { class: 'fh-sr-only' }, ` votes. Vote for: ${item.title}`),
      );
      list.appendChild(
        h(
          'li',
          { class: 'fh-item' },
          voteButton,
          h(
            'div',
            {},
            h('p', { class: 'fh-item-title' }, item.title),
            h(
              'p',
              { class: 'fh-item-meta' },
              h('span', { class: 'fh-badge' }, TYPE_LABELS[item.type]),
              h('span', { class: 'fh-badge' }, STATUS_LABELS[item.status]),
            ),
            item.description ? h('p', { class: 'fh-item-desc' }, item.description) : null,
          ),
        ),
      );
    }
    ideasView.appendChild(list);
    if (focusId) {
      const again = Array.from(ideasView.querySelectorAll<HTMLElement>('.fh-vote')).find(
        (b) => b.dataset.id === focusId,
      );
      again?.focus();
    }
  }

  // ------------------------------------------------------------------ handle
  return {
    host,
    open,
    close,
    destroy() {
      window.clearTimeout(slowTimer);
      host.remove();
    },
  };
}

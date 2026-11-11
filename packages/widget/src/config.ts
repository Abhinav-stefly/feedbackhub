export type Position = 'bottom-right' | 'bottom-left';

export interface WidgetConfig {
  projectKey: string;
  /** Where the FeedbackHub API lives, without a trailing slash. */
  apiUrl: string;
  position: Position;
  /** Accent colour as #rrggbb */
  color: string;
  /** Text on the floating button. */
  label: string;
}

/** A mistake in how the site owner installed the widget. */
export class ConfigError extends Error {}

const KEY_PATTERN = /^pk_[A-Za-z0-9_-]{22}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_COLOR = '#4f46e5';
const DEFAULT_LABEL = 'Feedback';
const MAX_LABEL_LENGTH = 24;

/** Accepts only plain http(s) URLs without embedded passwords. */
export function normalizeApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('data-api-url is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('data-api-url must start with https:// (or http:// for local testing)');
  }
  if (url.username || url.password) {
    throw new ConfigError('data-api-url must not contain a username or password');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Reads the settings from the <script> tag's data-* attributes. Every value comes from
 * the page, so every value is validated. Bad optional values fall back to safe defaults.
 */
export function readConfig(
  script: HTMLScriptElement | null,
  pageOrigin: string = window.location.origin,
): WidgetConfig {
  const data = script?.dataset ?? {};

  const projectKey = (data.projectKey ?? '').trim();
  if (!KEY_PATTERN.test(projectKey)) {
    throw new ConfigError(
      'Missing or invalid data-project-key. Copy the exact key from your FeedbackHub project settings.',
    );
  }

  let apiUrl: string;
  if (data.apiUrl) {
    apiUrl = normalizeApiUrl(data.apiUrl);
  } else if (script?.src) {
    apiUrl = new URL(script.src, pageOrigin).origin; // default: the server that served widget.js
  } else {
    apiUrl = pageOrigin;
  }

  const color = (data.color ?? '').trim();
  const label = (data.label ?? '').trim();

  return {
    projectKey,
    apiUrl,
    position: data.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    color: COLOR_PATTERN.test(color) ? color.toLowerCase() : DEFAULT_COLOR,
    label: label.length > 0 && label.length <= MAX_LABEL_LENGTH ? label : DEFAULT_LABEL,
  };
}

/** White or near-black, whichever is easier to read on top of the given #rrggbb colour. */
export function readableTextColor(hex: string): string {
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#111827';
}

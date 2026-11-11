import { createApi } from './api';
import { ConfigError, readConfig } from './config';
import { HOST_ID, mountWidget, type WidgetHandle } from './ui';
import { getVoterId } from './voter';

/** Public API: window.FeedbackHub.open() / .close() / .destroy() / .version */
export const version = '0.1.0';

let handle: WidgetHandle | undefined;

// Read the <script> tag NOW. document.currentScript only exists while the script is running.
const script =
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>('script[data-project-key]');

export function open(): void {
  handle?.open();
}
export function close(): void {
  handle?.close();
}
export function destroy(): void {
  handle?.destroy();
  handle = undefined;
}

function boot(): void {
  if (handle || document.getElementById(HOST_ID)) return; // already installed (e.g. script included twice)
  try {
    const config = readConfig(script);
    handle = mountWidget(config, createApi(config, getVoterId()));
  } catch (err) {
    // A broken widget must NEVER break the customer's website: log and stop.
    console.error('[FeedbackHub]', err instanceof ConfigError ? err.message : err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

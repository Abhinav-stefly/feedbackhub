/**
 * All widget styles. They live INSIDE the Shadow DOM, so the host website's CSS cannot
 * break the widget, and ours cannot leak out and change the host website.
 */
export const CSS = `
/* Reset everything the host page might have set on our container. The !important matters:
   it beats the host page's own !important rules (inside a shadow tree, the shadow's
   !important declarations win over the outer document's). */
:host { all: initial !important; }

[hidden] { display: none !important; }

.fh-root {
  --fh-bg: #ffffff;
  --fh-text: #111827;
  --fh-muted: #4b5563;
  --fh-border: #d1d5db;
  --fh-field: #ffffff;
  --fh-surface: #f3f4f6;
  --fh-error: #b91c1c;
  --fh-focus: #1d4ed8;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--fh-text);
  text-align: left;
}
@media (prefers-color-scheme: dark) {
  .fh-root {
    --fh-bg: #111827;
    --fh-text: #f9fafb;
    --fh-muted: #d1d5db;
    --fh-border: #4b5563;
    --fh-field: #1f2937;
    --fh-surface: #1f2937;
    --fh-error: #fca5a5;
    --fh-focus: #93c5fd;
  }
}

/* Resets use :where(), which has ZERO specificity, so every component rule below can
   override them. (Without it, ".fh-root button { color: inherit }" would silently beat
   ".fh-launcher { color: ... }", leaving dark text on the accent colour.) */
:where(.fh-root) *, :where(.fh-root) *::before, :where(.fh-root) *::after { box-sizing: border-box; }
:where(.fh-root) h2, :where(.fh-root) h3, :where(.fh-root) p, :where(.fh-root) ul { margin: 0; padding: 0; }
:where(.fh-root) ul { list-style: none; }
:where(.fh-root) button, :where(.fh-root) input, :where(.fh-root) select, :where(.fh-root) textarea {
  font: inherit;
  color: inherit;
}

.fh-launcher {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483000;
  min-height: 44px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: var(--fh-accent);
  color: var(--fh-accent-text);
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.fh-left .fh-launcher { right: auto; left: 20px; }

.fh-panel {
  position: fixed;
  bottom: 76px;
  right: 20px;
  z-index: 2147483000;
  width: min(380px, calc(100vw - 32px));
  max-height: min(640px, calc(100vh - 100px));
  max-height: min(640px, calc(100dvh - 100px));
  display: flex;
  flex-direction: column;
  background: var(--fh-bg);
  color: var(--fh-text);
  border: 1px solid var(--fh-border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.fh-left .fh-panel { right: auto; left: 20px; }
@media (max-width: 480px) {
  .fh-panel, .fh-left .fh-panel { left: 16px; right: 16px; width: auto; bottom: 72px; }
}

.fh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--fh-border);
}
.fh-title { font-size: 16px; font-weight: 700; }
.fh-close {
  width: 44px; height: 44px; margin: -10px -10px -10px 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; background: transparent; border-radius: 8px; font-size: 22px; line-height: 1; cursor: pointer;
}

.fh-tabs { display: flex; border-bottom: 1px solid var(--fh-border); }
.fh-tab {
  flex: 1; min-height: 44px; padding: 0 12px; border: 0; background: transparent;
  border-bottom: 3px solid transparent; font-weight: 600; color: var(--fh-muted); cursor: pointer;
}
.fh-tab[aria-selected="true"] { color: var(--fh-text); border-bottom-color: var(--fh-accent); }

.fh-body { padding: 16px; overflow-y: auto; }

.fh-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.fh-label { font-weight: 600; }
.fh-input, .fh-select, .fh-textarea {
  width: 100%; min-height: 44px; padding: 10px 12px;
  background: var(--fh-field); border: 1px solid var(--fh-border); border-radius: 8px;
}
.fh-textarea { min-height: 110px; resize: vertical; }
.fh-input[aria-invalid="true"], .fh-textarea[aria-invalid="true"], .fh-select[aria-invalid="true"] {
  border-color: var(--fh-error);
}
.fh-hint { color: var(--fh-muted); font-size: 12px; text-align: right; }
.fh-error { color: var(--fh-error); font-size: 13px; font-weight: 600; }
.fh-form-error { color: var(--fh-error); font-weight: 600; margin-bottom: 12px; }
.fh-slow { color: var(--fh-muted); margin-bottom: 12px; }

.fh-primary, .fh-secondary {
  min-height: 44px; padding: 0 18px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%;
}
.fh-primary { border: 0; background: var(--fh-accent); color: var(--fh-accent-text); }
.fh-secondary { border: 1px solid var(--fh-border); background: transparent; margin-top: 10px; }
.fh-primary:disabled { opacity: 0.7; cursor: progress; }

.fh-success { text-align: center; padding: 12px 0 4px; }
.fh-success h3 { margin: 0 0 8px; font-size: 18px; }
.fh-success p { color: var(--fh-muted); }

.fh-items { display: flex; flex-direction: column; gap: 12px; }
.fh-item { display: flex; gap: 12px; align-items: flex-start; padding-bottom: 12px; border-bottom: 1px solid var(--fh-border); }
.fh-item:last-child { border-bottom: 0; padding-bottom: 0; }
.fh-vote {
  flex: none; width: 52px; min-height: 52px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
  background: transparent; border: 1px solid var(--fh-border); border-radius: 10px; cursor: pointer; font-weight: 700;
}
/* The arrow is decoration drawn by CSS, so the button's visible text is just the count,
   which the button's accessible name contains. */
.fh-vote::before { content: "\u25b2"; font-size: 11px; line-height: 1; }
.fh-vote[aria-pressed="true"] { background: var(--fh-accent); border-color: var(--fh-accent); color: var(--fh-accent-text); }
.fh-vote:disabled { opacity: 0.6; cursor: progress; }
.fh-item-title { font-weight: 700; overflow-wrap: anywhere; }
.fh-item-meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
.fh-badge { background: var(--fh-surface); color: var(--fh-muted); border-radius: 999px; padding: 1px 8px; font-size: 12px; font-weight: 600; }
.fh-item-desc {
  color: var(--fh-muted); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.fh-note { color: var(--fh-muted); text-align: center; padding: 16px 0; }

.fh-launcher:focus-visible, .fh-close:focus-visible, .fh-tab:focus-visible, .fh-input:focus-visible,
.fh-select:focus-visible, .fh-textarea:focus-visible, .fh-primary:focus-visible,
.fh-secondary:focus-visible, .fh-vote:focus-visible, .fh-success h3:focus-visible {
  outline: 3px solid var(--fh-focus); outline-offset: 2px;
}

.fh-sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .fh-panel { animation: fh-pop 140ms ease-out; }
  @keyframes fh-pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
}
`;

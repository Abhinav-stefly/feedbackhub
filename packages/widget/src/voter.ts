const STORAGE_KEY = 'feedbackhub:voter-id';
const VALID = /^[A-Za-z0-9_-]{16,64}$/;

let memoryFallback: string | undefined;

function generate(): string {
  const bytes = new Uint8Array(18);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // base64url without padding: 18 bytes -> 24 URL-safe characters
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * An anonymous, random ID for this browser, remembered in localStorage so a visitor's
 * votes stay recognisable. It identifies a BROWSER, not a person: no name, no email.
 * If storage is blocked (private mode, strict settings) we keep it in memory instead.
 */
export function getVoterId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.test(stored)) return stored;
    const id = generate();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memoryFallback ??= generate();
    return memoryFallback;
  }
}

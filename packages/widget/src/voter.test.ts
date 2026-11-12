import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVoterId } from './voter';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('getVoterId', () => {
  it('creates a random, valid id and remembers it', () => {
    const first = getVoterId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(getVoterId()).toBe(first);
    expect(window.localStorage.getItem('feedbackhub:voter-id')).toBe(first);
  });

  it('makes a different id for a different browser', () => {
    const a = getVoterId();
    window.localStorage.clear();
    expect(getVoterId()).not.toBe(a);
  });

  it('replaces a corrupted stored value', () => {
    window.localStorage.setItem('feedbackhub:voter-id', 'bad value!!');
    expect(getVoterId()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('keeps working (stable for the session) when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const id = getVoterId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(getVoterId()).toBe(id);
  });
});

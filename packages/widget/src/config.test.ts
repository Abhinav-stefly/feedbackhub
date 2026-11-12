import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeApiUrl, readConfig, readableTextColor } from './config';

const KEY = 'pk_' + 'A'.repeat(22);

function scriptTag(attrs: Record<string, string>, src = 'https://cdn.example.com/widget.js') {
  const script = document.createElement('script');
  script.src = src;
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  return script;
}

describe('readConfig', () => {
  it('reads a minimal install and defaults the API to the server that served widget.js', () => {
    const config = readConfig(scriptTag({ 'data-project-key': KEY }), 'https://shop.example');
    expect(config).toEqual({
      projectKey: KEY,
      apiUrl: 'https://cdn.example.com',
      position: 'bottom-right',
      color: '#4f46e5',
      label: 'Feedback',
    });
  });

  it('applies and normalises every option', () => {
    const config = readConfig(
      scriptTag({
        'data-project-key': KEY,
        'data-api-url': 'https://api.example.com/base///',
        'data-position': 'bottom-left',
        'data-color': '#AABBCC',
        'data-label': '  Help us  ',
      }),
    );
    expect(config).toMatchObject({
      apiUrl: 'https://api.example.com/base',
      position: 'bottom-left',
      color: '#aabbcc',
      label: 'Help us',
    });
  });

  it.each([
    ['missing', {}],
    ['too short', { 'data-project-key': 'pk_short' }],
    ['wrong prefix', { 'data-project-key': 'xx_' + 'A'.repeat(22) }],
    ['with HTML in it', { 'data-project-key': `${KEY}"><script>` }],
  ])('refuses a %s project key', (_label, attrs) => {
    expect(() => readConfig(scriptTag(attrs))).toThrow(ConfigError);
  });

  it('falls back to safe defaults for bad optional values', () => {
    const config = readConfig(
      scriptTag({
        'data-project-key': KEY,
        'data-color': 'red; background:url(javascript:alert(1))',
        'data-position': 'top-middle',
        'data-label': 'x'.repeat(25),
      }),
    );
    expect(config).toMatchObject({ color: '#4f46e5', position: 'bottom-right', label: 'Feedback' });
  });

  it('works with no script element at all, using the page origin', () => {
    expect(() => readConfig(null)).toThrow(ConfigError);
  });
});

describe('normalizeApiUrl', () => {
  it.each([
    'javascript:alert(1)',
    'ftp://example.com',
    'not a url',
    'https://user:pass@example.com',
  ])('rejects %s', (bad) => {
    expect(() => normalizeApiUrl(bad)).toThrow(ConfigError);
  });

  it('allows http for local testing and strips trailing slashes', () => {
    expect(normalizeApiUrl('http://localhost:4000/')).toBe('http://localhost:4000');
  });
});

describe('readableTextColor', () => {
  it('picks white on dark colours and near-black on light colours', () => {
    expect(readableTextColor('#4f46e5')).toBe('#ffffff');
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#facc15')).toBe('#111827');
    expect(readableTextColor('#ffffff')).toBe('#111827');
  });
});

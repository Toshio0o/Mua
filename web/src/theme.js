export const THEME_KEY = 'xm_theme';

export function readTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export function resolveTheme(mode = readTheme()) {
  if (mode === 'dark' || mode === 'light') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode = readTheme()) {
  const pref = mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
  const resolved = resolveTheme(pref);
  localStorage.setItem(THEME_KEY, pref);
  document.documentElement.dataset.theme = pref;
  document.documentElement.dataset.resolved = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0D1118' : '#F3F4F8');
  return pref;
}

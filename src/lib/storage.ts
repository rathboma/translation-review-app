// What survives a reload: who the reviewer is, their queue of notes and the
// last page they were on. localStorage can throw (a private window, blocked
// site data, a full disk), and the app works without it.
const PREFIX = "translation-review:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Nowhere to keep it: the notes live until the tab closes.
  }
}

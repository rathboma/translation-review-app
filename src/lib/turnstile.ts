// Cloudflare Turnstile's widget, loaded when the submit dialog first needs it.
export interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
}

export interface Turnstile {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widget?: string): void;
  remove(widget?: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Turnstile> | null = null;

export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((ok, fail) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? ok(window.turnstile) : fail(new Error("The human check did not load.")));
    script.onerror = () => {
      loading = null;
      fail(new Error("The human check did not load. Check your connection and try again."));
    };
    document.head.append(script);
  });
  return loading;
}

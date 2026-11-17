import type { SuggestedChecks, SuggestRequest } from "../shared/suggest";
import type { AppState } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError("Could not reach the local server. Is `npm run dev` still running?", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Config {
  judgeReady: boolean;
  hasKey: boolean;
  model: string;
}

export const api = {
  config: () => call<Config>("GET", "/api/config"),
  load: () => call<{ state: AppState; rev: number }>("GET", "/api/state"),
  save: (state: AppState, baseRev: number, keepalive = false) =>
    call<{ rev: number }>("PUT", "/api/state", { state, baseRev }, { keepalive }),
  judge: (prompt: string) => call<{ text: string }>("POST", "/api/judge", { prompt }),
  suggest: (req: SuggestRequest) => call<{ draft: SuggestedChecks }>("POST", "/api/suggest", req),
};

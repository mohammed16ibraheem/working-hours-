const KEY = "wh_session";

export type WhSession = {
  user: string;
  at: number;
};

export function saveSession(user: string) {
  const session: WhSession = { user, at: Date.now() };
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function readSession(): WhSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as WhSession;
    if (!data?.user) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
}

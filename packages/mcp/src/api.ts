export const API_URL = process.env.DELOC_API_URL ?? "https://api.deloc.dev";

const tokenRef = { value: "" };

export function setToken(token: string): void {
  tokenRef.value = token;
}

export function getToken(): string {
  return tokenRef.value;
}

export function requireToken(): string | null {
  if (!tokenRef.value) return null;
  return tokenRef.value;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${tokenRef.value}`, ...options.headers },
    });
  } catch {
    throw new Error("Could not connect to Deloc API. Check your internet connection and DELOC_API_URL setting.");
  }
}

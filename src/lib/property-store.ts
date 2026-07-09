// Client-only: active property id lives in localStorage
const KEY = "iti-active-property";

export function getActivePropertyId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setActivePropertyId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, id);
}

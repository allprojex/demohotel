import { UAParser } from "ua-parser-js";

const KEY = "iti-session-key";
const FP_KEY = "iti-device-fingerprint";

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function getSessionKey(): string {
  if (typeof sessionStorage === "undefined") return "server";
  let k = sessionStorage.getItem(KEY);
  if (!k) { k = uuid(); sessionStorage.setItem(KEY, k); }
  return k;
}

export function getDeviceFingerprint(): string {
  if (typeof localStorage === "undefined") return "unknown";
  let f = localStorage.getItem(FP_KEY);
  if (!f) {
    // lightweight stable id (no external lib) — MAC unavailable in browsers.
    const parts = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      new Date().getTimezoneOffset(),
    ].join("|");
    let hash = 0;
    for (let i = 0; i < parts.length; i++) hash = (hash * 31 + parts.charCodeAt(i)) | 0;
    f = "fp_" + Math.abs(hash).toString(36) + "_" + uuid().slice(0, 6);
    localStorage.setItem(FP_KEY, f);
  }
  return f;
}

export function getDeviceContext() {
  if (typeof navigator === "undefined") {
    return { userAgent: "", os: "", browser: "", sessionKey: "server", fingerprint: "server" };
  }
  const p = new UAParser(navigator.userAgent);
  const os = p.getOS();
  const br = p.getBrowser();
  return {
    userAgent: navigator.userAgent,
    os: [os.name, os.version].filter(Boolean).join(" ") || "unknown",
    browser: [br.name, br.version].filter(Boolean).join(" ") || "unknown",
    sessionKey: getSessionKey(),
    fingerprint: getDeviceFingerprint(),
  };
}

export const APP_VERSION = "1.3.0";
export const APP_BUILD_DATE = new Date().toISOString().slice(0, 10);
export const APP_CHANNEL = "stable";

export const RELEASE_NOTES: { version: string; date: string; notes: string[] }[] = [
  {
    version: "1.3.0",
    date: "2026-07-05",
    notes: [
      "Enterprise Notification Center with real-time polling and filters.",
      "Live Online Users dashboard with idle/offline detection.",
      "Excel & CSV upload management with preview, validation, approval workflow.",
      "Role Permission Matrix with 9 actions per module and custom roles.",
      "Extended audit trail with device fingerprint, OS, browser, IP.",
      "Ghana identification types, 16 regions with auto-mapped capitals.",
      "Searchable nationality selector (ECOWAS-first).",
      "POS Menu bulk import via Excel/CSV.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-01",
    notes: [
      "Ghana cedi (GHS) as default currency.",
      "Per-property currency selector.",
      "RBAC route guards and access-denied UX.",
      "AI insights auto-refresh.",
    ],
  },
];

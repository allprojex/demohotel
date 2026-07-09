import { useEffect, useState } from "react";
import logoAsset from "@/assets/logo.asset.json";
import { useBrandSettings } from "@/hooks/use-brand-settings";

export function BrandMark({ className = "h-8" }: { className?: string }) {
  const { data } = useBrandSettings();

  // Detect dark class on <html> so we can pick logo_dark_url when set.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const obs = new MutationObserver(() =>
      setIsDark(el.classList.contains("dark")),
    );
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const src =
    (isDark && data?.logo_dark_url) ||
    data?.logo_url ||
    logoAsset.url;
  const alt = data?.app_name || "Infinity Techub Intelligence";

  return <img src={src} alt={alt} className={className} />;
}

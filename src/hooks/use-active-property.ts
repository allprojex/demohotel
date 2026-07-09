import { useEffect, useState } from "react";
import { getActivePropertyId } from "@/lib/property-store";

export function useActiveProperty(): string | null {
  const [id, setId] = useState<string | null>(() => getActivePropertyId());
  useEffect(() => {
    const handler = () => setId(getActivePropertyId());
    window.addEventListener("iti-property-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("iti-property-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return id;
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";

export type BrandSettings = {
  app_name: string;
  app_short_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  support_email: string | null;
  support_phone: string | null;
};

const DEFAULTS: BrandSettings = {
  app_name: "Infinity Grand Hotel",
  app_short_name: "Infinity Grand Hotel",
  tagline: null,
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  primary_color: null,
  support_email: null,
  support_phone: null,
};

export function useBrandSettings() {
  const propertyId = useActiveProperty();
  return useQuery({
    queryKey: ["brand-settings", propertyId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BrandSettings> => {
      const { data, error } = await (supabase.rpc as any)("get_brand_settings");
      if (error || !data) return DEFAULTS;
      const row = Array.isArray(data) ? data[0] : data;
      const globalBrand = row ? { ...DEFAULTS, ...(row as Partial<BrandSettings>) } : DEFAULTS;
      if (!propertyId) return globalBrand;
      const property = await (supabase.from("properties") as any)
        .select("name,brand_name,brand_tagline,brand_primary_color,brand_logo_url,email,phone")
        .eq("id", propertyId)
        .maybeSingle();
      if (property.error || !property.data) return globalBrand;
      const p = property.data;
      return {
        ...globalBrand,
        app_name: p.brand_name || p.name || globalBrand.app_name,
        app_short_name: p.brand_name || p.name || globalBrand.app_short_name,
        tagline: p.brand_tagline || globalBrand.tagline,
        primary_color: p.brand_primary_color || globalBrand.primary_color,
        logo_url: p.brand_logo_url || globalBrand.logo_url,
        logo_dark_url: p.brand_logo_url || globalBrand.logo_dark_url,
        favicon_url: p.brand_logo_url || globalBrand.favicon_url,
        support_email: p.email || globalBrand.support_email,
        support_phone: p.phone || globalBrand.support_phone,
      };
    },
  });
}

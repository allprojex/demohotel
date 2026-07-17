import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Upload, ShieldAlert, Palette, ImagePlus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBrandSettings, type BrandSettings } from "@/hooks/use-brand-settings";
import { useHasAnyRole } from "@/hooks/use-user-roles";

const ACCEPT = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"];
const MAX_BYTES = 2 * 1024 * 1024;

type BrandFormState = BrandSettings;

const BLANK: BrandFormState = {
  app_name: "",
  app_short_name: "",
  tagline: "",
  logo_url: "",
  logo_dark_url: "",
  favicon_url: "",
  primary_color: "",
  support_email: "",
  support_phone: "",
};

export function BrandModule() {
  // Brand settings are global (not property-scoped) — pass null so the hook
  // checks for a super_admin grant that spans all properties.
  const superOnly = useHasAnyRole(["super_admin"], null);
  const brand = useBrandSettings();
  const qc = useQueryClient();
  const [form, setForm] = useState<BrandFormState>(BLANK);
  const [uploading, setUploading] = useState<null | "logo" | "logo_dark" | "favicon">(null);

  useEffect(() => {
    if (brand.data) {
      setForm({
        app_name: brand.data.app_name ?? "",
        app_short_name: brand.data.app_short_name ?? "",
        tagline: brand.data.tagline ?? "",
        logo_url: brand.data.logo_url ?? "",
        logo_dark_url: brand.data.logo_dark_url ?? "",
        favicon_url: brand.data.favicon_url ?? "",
        primary_color: brand.data.primary_color ?? "",
        support_email: brand.data.support_email ?? "",
        support_phone: brand.data.support_phone ?? "",
      });
    }
  }, [brand.data]);

  const save = useMutation({
    mutationFn: async (values: BrandFormState) => {
      // RLS on system_settings restricts writes to super_admin.
      const payload: Record<string, unknown> = {
        app_name: values.app_name || "Infinity Grand Hotel",
        app_short_name: nullify(values.app_short_name),
        tagline: nullify(values.tagline),
        logo_url: nullify(values.logo_url),
        logo_dark_url: nullify(values.logo_dark_url),
        favicon_url: nullify(values.favicon_url),
        primary_color: nullify(values.primary_color),
        support_email: nullify(values.support_email),
        support_phone: nullify(values.support_phone),
      };
      const { error } = await supabase
        .from("system_settings")
        .update(payload as any)
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Brand settings saved");
      qc.invalidateQueries({ queryKey: ["brand-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save brand settings"),
  });

  async function upload(kind: "logo" | "logo_dark" | "favicon", file: File) {
    if (!ACCEPT.includes(file.type)) {
      toast.error("Unsupported file type — use PNG, JPG, SVG, WEBP, or ICO");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large — max 2 MB");
      return;
    }
    setUploading(kind);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const path = `${kind}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("brand-assets")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      // Bucket is private (workspace blocks public buckets), so mint a
      // long-lived signed URL that safely renders in <img src>.
      const TEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 10;
      const { data, error: signErr } = await supabase.storage
        .from("brand-assets")
        .createSignedUrl(path, TEN_YEARS_SECONDS);
      if (signErr || !data?.signedUrl) throw signErr ?? new Error("Could not sign asset URL");
      const url = data.signedUrl;
      const key: keyof BrandFormState =
        kind === "logo" ? "logo_url" : kind === "logo_dark" ? "logo_dark_url" : "favicon_url";
      setForm((f) => ({ ...f, [key]: url }));
      toast.success(`${labelFor(kind)} uploaded — click Save to apply`);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  const previewPrimary = form.primary_color || "var(--primary)";

  if (superOnly.loading) {
    return <div className="p-6 text-muted-foreground">Checking access…</div>;
  }
  if (!superOnly.allowed) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Restricted</AlertTitle>
        <AlertDescription>
          Only a System Super Admin can change brand settings. Contact your administrator to request changes.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-primary" /> Identity
            </CardTitle>
            <CardDescription>Shown across the app: sidebar header, browser tab, emails, exports.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Application name" required>
              <Input
                value={form.app_name ?? ""}
                onChange={(e) => setForm({ ...form, app_name: e.target.value })}
                placeholder="Infinity Grand Hotel"
              />
            </Field>
            <Field label="Short name (sidebar)">
              <Input
                value={form.app_short_name ?? ""}
                onChange={(e) => setForm({ ...form, app_short_name: e.target.value })}
                placeholder="Infinity Grand Hotel"
              />
            </Field>
            <Field label="Tagline" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.tagline ?? ""}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                placeholder="Enterprise cloud hotel property management"
              />
            </Field>
            <Field label="Primary color (optional)">
              <div className="flex items-center gap-2">
                <Input
                  value={form.primary_color ?? ""}
                  onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  placeholder="oklch(0.55 0.14 160) or #10b981"
                />
                <span
                  className="h-9 w-9 rounded-md border"
                  style={{ backgroundColor: previewPrimary }}
                  aria-label="Primary color preview"
                />
              </div>
            </Field>
            <Field label="Support email">
              <Input
                type="email"
                value={form.support_email ?? ""}
                onChange={(e) => setForm({ ...form, support_email: e.target.value })}
                placeholder="support@example.com"
              />
            </Field>
            <Field label="Support phone">
              <Input
                value={form.support_phone ?? ""}
                onChange={(e) => setForm({ ...form, support_phone: e.target.value })}
                placeholder="+233…"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImagePlus className="h-4 w-4 text-primary" /> Logos & favicon
            </CardTitle>
            <CardDescription>PNG, JPG, SVG, WEBP, or ICO up to 2 MB. Public URLs are safe to share.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AssetSlot
              label="Logo (light theme)"
              hint="Displayed in the sidebar header when the app is in light mode."
              url={form.logo_url}
              uploading={uploading === "logo"}
              onFile={(f) => upload("logo", f)}
              onClear={() => setForm({ ...form, logo_url: "" })}
            />
            <AssetSlot
              label="Logo (dark theme, optional)"
              hint="Falls back to the light logo when unset."
              url={form.logo_dark_url}
              uploading={uploading === "logo_dark"}
              onFile={(f) => upload("logo_dark", f)}
              onClear={() => setForm({ ...form, logo_dark_url: "" })}
              dark
            />
            <AssetSlot
              label="Favicon"
              hint="Shown in the browser tab. Square, 32×32 or larger recommended."
              url={form.favicon_url}
              uploading={uploading === "favicon"}
              onFile={(f) => upload("favicon", f)}
              onClear={() => setForm({ ...form, favicon_url: "" })}
            />
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => brand.refetch()} disabled={save.isPending}>
            Reset
          </Button>
          <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.app_name.trim()}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live preview</CardTitle>
            <CardDescription>How the brand appears across the app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <BrowserTabPreview title={form.app_name || "Infinity Grand Hotel"} favicon={form.favicon_url} />
            <Separator />
            <SidebarHeaderPreview
              name={form.app_short_name || form.app_name || "Infinity Grand Hotel"}
              logo={form.logo_url}
            />
            <Separator />
            <div>
              <Label className="text-xs text-muted-foreground">Sample primary button</Label>
              <div className="mt-2">
                <button
                  className="rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: previewPrimary }}
                >
                  {form.app_short_name || "Continue"}
                </button>
              </div>
            </div>
            {form.tagline ? (
              <>
                <Separator />
                <p className="text-sm italic text-muted-foreground">"{form.tagline}"</p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function nullify(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length === 0 ? null : s;
}

function labelFor(kind: "logo" | "logo_dark" | "favicon") {
  return kind === "logo" ? "Light logo" : kind === "logo_dark" ? "Dark logo" : "Favicon";
}

function Field({
  label,
  children,
  required,
  className,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function AssetSlot({
  label,
  hint,
  url,
  uploading,
  onFile,
  onClear,
  dark,
}: {
  label: string;
  hint: string;
  url: string | null | undefined;
  uploading: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
  dark?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapCls = useMemo(
    () =>
      `flex items-center justify-center rounded-md border ${dark ? "bg-slate-900" : "bg-muted/40"} min-h-24 p-3`,
    [dark],
  );
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {url ? (
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{url}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <div className={wrapCls} style={{ width: 96, height: 64 }}>
          {url ? (
            <img
              src={url}
              alt={`${label} preview`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-[10px] text-muted-foreground">No image</span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Upload
          </Button>
          {url ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BrowserTabPreview({ title, favicon }: { title: string; favicon: string | null | undefined }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">Browser tab</Label>
      <div className="mt-2 flex max-w-[280px] items-center gap-2 rounded-t-md border border-b-0 bg-background px-3 py-2 text-xs">
        {favicon ? (
          <img src={favicon} alt="favicon" className="h-4 w-4 rounded-sm object-contain" />
        ) : (
          <div className="h-4 w-4 rounded-sm bg-muted" />
        )}
        <span className="truncate">{title}</span>
      </div>
    </div>
  );
}

function SidebarHeaderPreview({ name, logo }: { name: string; logo: string | null | undefined }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">Sidebar header</Label>
      <div className="mt-2 flex items-center gap-2 rounded-md border bg-[var(--sidebar)] p-3 text-[var(--sidebar-foreground)]">
        {logo ? (
          <img src={logo} alt="logo" className="h-7 w-auto object-contain" />
        ) : (
          <div className="h-7 w-7 rounded-md bg-[var(--sidebar-primary)]/20" />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="text-[10px] uppercase tracking-widest opacity-70">PMS</div>
        </div>
      </div>
    </div>
  );
}

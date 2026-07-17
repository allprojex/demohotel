import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createDemoWorkspace, identifierSignIn } from "@/lib/auth.functions";
import type { LoginAccountType } from "@/lib/auth-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/brand-mark";
import { Eye, EyeOff, Shield, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Staff & Admin Sign In — Infinity Grand Hotel" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const signIn = useServerFn(identifierSignIn);
  const createDemo = useServerFn(createDemoWorkspace);
  const [mode, setMode] = useState<"signin" | "demo">("signin");
  const [accountType, setAccountType] = useState<LoginAccountType>("staff");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hotelName, setHotelName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#0f766e");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn({ data: { accountType, identifier, password } });
      const session = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (session.error) throw session.error;
      navigate({
        to: result.mustChangePassword ? "/change-password" : "/dashboard",
        replace: true,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid ID or password");
    } finally {
      setLoading(false);
    }
  }

  async function startDemo(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await createDemo({ data: { hotelName, fullName, email, password, primaryColor, acceptedTerms } });
      const session = await supabase.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken });
      if (session.error) throw session.error;
      localStorage.setItem("iti-active-property", result.propertyId);
      window.dispatchEvent(new Event("iti-property-changed"));
      toast.success("Your 14-day hotel demo is ready");
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create your demo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: "var(--gradient-surface)" }}
    >
      <main className="w-full max-w-md">
        <header className="mb-7 text-center">
          <BrandMark className="mx-auto h-12" />
          <h1 className="mt-4 text-2xl font-semibold">Infinity Grand Hotel</h1>
          <p className="mt-1 text-sm text-muted-foreground">Property Management System</p>
        </header>
        <section className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-elegant)] sm:p-6">
          <div
            className="mb-5 grid grid-cols-2 rounded-lg border p-1"
            role="tablist"
            aria-label="Demo access"
          >
            <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => setMode("signin")} className={cn("rounded-md px-3 py-2 text-sm font-medium", mode === "signin" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "demo"} onClick={() => setMode("demo")} className={cn("rounded-md px-3 py-2 text-sm font-medium", mode === "demo" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Start hotel demo</button>
          </div>
          {mode === "signin" ? <>
          <div
            className="mb-6 grid grid-cols-2 rounded-lg bg-muted p-1"
            role="tablist"
            aria-label="Account type"
          >
            <Tab
              active={accountType === "staff"}
              onClick={() => setAccountType("staff")}
              icon={<Users className="h-4 w-4" />}
              label="Staff"
            />
            <Tab
              active={accountType === "admin"}
              onClick={() => setAccountType("admin")}
              icon={<Shield className="h-4 w-4" />}
              label="Admin"
            />
          </div>
          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="identifier">
                {accountType === "staff" ? "Username / Staff ID" : "Admin ID"}
              </Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  accountType === "staff"
                    ? "Enter your username or Staff ID"
                    : "Enter your Admin ID"
                }
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  autoComplete="current-password"
                  className="pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {capsLock && (
                <p role="status" className="text-xs text-amber-600">
                  Caps Lock is on
                </p>
              )}
            </div>
            <Button className="w-full" size="lg" disabled={loading}>
              {loading ? "Signing in…" : accountType === "admin" ? "Admin Sign In" : "Sign In"}
            </Button>
          </form>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Contact your system administrator to reset your password.
          </p>
          </> : <form className="space-y-4" onSubmit={startDemo}>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              Create a private 14-day workspace. Customize your hotel and test every feature; the software platform remains owned and managed by Infinity Tech Hub.
            </div>
            <div className="space-y-2"><Label htmlFor="hotel-name">Hotel name</Label><Input id="hotel-name" value={hotelName} onChange={(e) => setHotelName(e.target.value)} required maxLength={100} /></div>
            <div className="space-y-2"><Label htmlFor="full-name">Your full name</Label><Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={100} /></div>
            <div className="space-y-2"><Label htmlFor="demo-email">Work email</Label><Input id="demo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="space-y-2"><Label htmlFor="demo-password">Password</Label><Input id="demo-password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" /></div>
              <Button type="button" variant="outline" size="icon" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Use 10+ characters with uppercase, lowercase, a number and a symbol.</p>
            <div className="space-y-2"><Label htmlFor="brand-color">Brand colour</Label><div className="flex gap-2"><Input id="brand-color" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-16 p-1" /><Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} pattern="#[0-9A-Fa-f]{6}" /></div></div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} required /><span>I accept that this is a temporary evaluation workspace. I receive no ownership, resale, source-code, or permanent hosting rights.</span></label>
            <Button className="w-full" size="lg" disabled={loading}>{loading ? "Creating your demo…" : "Create my hotel demo"}</Button>
          </form>}
        </section>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          {mode === "signin" ? "Accounts are created by an authorised administrator." : "Demo data may be reset or removed after the evaluation period."}
        </p>
      </main>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

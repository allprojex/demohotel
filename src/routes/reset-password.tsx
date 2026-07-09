import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand-mark";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password" }] }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"request" | "update">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      setMode("update");
    }
  }, []);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) toast.error(error.message); else toast.success("Password reset email sent.");
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated.");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--gradient-surface)" }}>
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center"><BrandMark className="h-12" /></div>
        <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-elegant)]">
          <h1 className="text-xl font-semibold">{mode === "request" ? "Reset your password" : "Set a new password"}</h1>
          {mode === "request" ? (
            <form className="mt-4 space-y-3" onSubmit={requestReset}>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <Button className="w-full" disabled={loading}>Send reset link</Button>
            </form>
          ) : (
            <form className="mt-4 space-y-3" onSubmit={updatePassword}>
              <div className="space-y-1.5"><Label>New password</Label><Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
              <Button className="w-full" disabled={loading}>Update password</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

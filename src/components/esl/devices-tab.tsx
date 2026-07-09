import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  listEslDevices, upsertEslDevice, deleteEslDevice, markEslDeviceSeen,
  createEslPairingCode, lookupEslPairingCode,
  type EslDeviceKind, type EslDeviceConnection, type EslPairingCodeRow,
} from "@/lib/esl/devices.functions";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  QrCode, ScanBarcode, Radio, Wifi, Bluetooth, Usb, Cable, Camera, Printer,
  Plus, Trash2, PlayCircle, StopCircle, Copy,
  CheckCircle2, AlertCircle, Clock, Loader2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

const KIND_META: Record<EslDeviceKind, { label: string; icon: any; hint: string }> = {
  qr_scanner:      { label: "QR scanner",       icon: QrCode,      hint: "Handheld or fixed QR reader." },
  barcode_scanner: { label: "Barcode scanner",  icon: ScanBarcode, hint: "1D/2D barcode reader (Zebra, Honeywell, Datalogic)." },
  rfid_reader:     { label: "RFID reader",      icon: Radio,       hint: "UHF or HF RFID for inventory tags." },
  nfc_reader:      { label: "NFC reader",       icon: Wifi,        hint: "NFC for key cards or tap-to-check-in." },
  esl_gateway:     { label: "ESL gateway",      icon: Radio,       hint: "Vendor base station (SES/Pricer/Hanshow/SoluM)." },
  label_printer:   { label: "Label printer",    icon: Printer,     hint: "Thermal / ZPL label printer for backup tags." },
  handheld_pda:    { label: "Handheld PDA",     icon: ScanBarcode, hint: "Warehouse PDA with built-in scanner." },
  kiosk_camera:    { label: "Kiosk camera",     icon: Camera,      hint: "Front-desk webcam used for on-screen QR scanning." },
};

const CONN_META: Record<EslDeviceConnection, { label: string; icon: any }> = {
  usb:       { label: "USB",       icon: Usb },
  bluetooth: { label: "Bluetooth", icon: Bluetooth },
  network:   { label: "Network",   icon: Wifi },
  serial:    { label: "Serial",    icon: Cable },
  webcam:    { label: "Webcam",    icon: Camera },
  cloud:     { label: "Cloud",     icon: Wifi },
};

export function DevicesTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listEslDevices);
  const saveFn = useServerFn(upsertEslDevice);
  const delFn = useServerFn(deleteEslDevice);
  const seenFn = useServerFn(markEslDeviceSeen);

  const devices = useQuery({
    queryKey: ["esl-devices", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string; kind: EslDeviceKind; connection: EslDeviceConnection;
    address: string; vendor: string; model: string; notes: string;
  }>({ name: "", kind: "qr_scanner", connection: "webcam", address: "", vendor: "", model: "", notes: "" });

  const save = useMutation({
    mutationFn: () => saveFn({ data: { propertyId, ...form } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["esl-devices"] });
      setOpen(false);
      setForm({ name: "", kind: "qr_scanner", connection: "webcam", address: "", vendor: "", model: "", notes: "" });
      toast.success("Device saved.");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed."),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["esl-devices"] }); toast.success("Device removed."); },
  });
  const markSeen = useMutation({
    mutationFn: (id: string) => seenFn({ data: { id, status: "online" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["esl-devices"] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Scannable devices</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Register QR scanners, barcode/RFID/NFC readers, ESL gateways, and label printers used across the property.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <QrPairButton propertyId={propertyId} onPaired={() => qc.invalidateQueries({ queryKey: ["esl-devices"] })} />
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />Add device</Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Register a device</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Front-desk QR scanner" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Kind</Label>
                    <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as EslDeviceKind })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(KIND_META) as EslDeviceKind[]).map((k) => (
                          <SelectItem key={k} value={k}>{KIND_META[k].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Connection</Label>
                    <Select value={form.connection} onValueChange={(v) => setForm({ ...form, connection: v as EslDeviceConnection })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CONN_META) as EslDeviceConnection[]).map((k) => (
                          <SelectItem key={k} value={k}>{CONN_META[k].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Vendor</Label><Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Zebra" /></div>
                  <div><Label>Model</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="DS2208" /></div>
                </div>
                <div>
                  <Label>Address / identifier</Label>
                  <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. 192.168.1.42, COM3, BT MAC" />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Tip: choose "Webcam" for camera-based QR scanning — you can test it inline from the device row below.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(devices.data ?? []).map((d) => {
                const Kicon = KIND_META[d.kind].icon;
                const Cicon = CONN_META[d.connection].icon;
                return (
                  <TableRow key={d.id} id={`device-${d.id}`} className="scroll-mt-24 target:bg-primary/5">
                    <TableCell>
                      <div className="text-sm font-medium">{d.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {d.vendor} {d.model}
                        {d.last_seen_at && <> · last seen {formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true })}</>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <Kicon className="h-3.5 w-3.5" />{KIND_META[d.kind].label}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <Cicon className="h-3.5 w-3.5" />{CONN_META[d.connection].label}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{d.address ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "online" ? "default" : d.status === "error" ? "destructive" : "outline"}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {d.connection === "webcam" && d.kind === "qr_scanner" && (
                          <QrScannerTester onScan={() => markSeen.mutate(d.id)} />
                        )}
                        <Button size="icon" variant="ghost" onClick={() => del.mutate(d.id)} title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(devices.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    No devices yet. Add a QR scanner, barcode reader, or ESL gateway to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function QrScannerTester({ onScan }: { onScan: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const detectorSupported = typeof (window as any).BarcodeDetector !== "undefined";
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!detectorSupported) {
          setError("Your browser lacks BarcodeDetector — camera preview only. Use a native scanner over USB or Bluetooth instead.");
          return;
        }
        const detector = new (window as any).BarcodeDetector({
          formats: ["qr_code", "code_128", "ean_13", "upc_a", "data_matrix"],
        });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0) {
              const value = codes[0].rawValue as string;
              setScanned(value);
              onScan(value);
              toast.success(`Scanned: ${value.slice(0, 60)}`);
              stopStream();
              return;
            }
          } catch { /* ignore per-frame decode errors */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e?.message ?? "Camera access denied.");
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stopStream() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { stopStream(); setScanned(null); setError(null); } }}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Test scan">
          <PlayCircle className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>QR / barcode scanner test</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md overflow-hidden bg-black aspect-video flex items-center justify-center">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {scanned && (
            <div className="rounded-md bg-muted p-2 text-xs font-mono break-all">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">Last scan</div>
              {scanned}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Point the camera at a QR or barcode. On unsupported browsers, connect a USB/Bluetooth scanner — they emit keystrokes into any focused input.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { stopStream(); setOpen(false); }}>
            <StopCircle className="h-3.5 w-3.5 mr-1.5" />Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PairStatus =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "paired"; deviceId: string }
  | { kind: "expired" }
  | { kind: "error"; message: string };

function QrPairButton({ propertyId, onPaired }: { propertyId: string; onPaired: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EslDeviceKind>("qr_scanner");
  const [connection, setConnection] = useState<EslDeviceConnection>("bluetooth");
  const [name, setName] = useState("");
  const [pair, setPair] = useState<EslPairingCodeRow | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PairStatus>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const createFn = useServerFn(createEslPairingCode);
  const lookupFn = useServerFn(lookupEslPairingCode);
  const qc = useQueryClient();

  function reset() {
    setPair(null); setQrDataUrl(null); setName(""); setStatus({ kind: "idle" });
  }

  const create = useMutation({
    mutationFn: () => createFn({ data: {
      propertyId, kind, connection, suggestedName: name || null,
    }}),
    onSuccess: async (row) => {
      setPair(row);
      setStatus({ kind: "waiting" });
      const url = `${window.location.origin}/admin/esl/pair?code=${row.code}`;
      try {
        const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 320 });
        setQrDataUrl(dataUrl);
      } catch (e: any) {
        setStatus({ kind: "error", message: `Could not render QR: ${e?.message ?? "unknown error"}` });
      }
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Could not create pairing code.";
      setStatus({ kind: "error", message: msg });
      toast.error(msg);
    },
  });

  // Countdown ticker
  useEffect(() => {
    if (status.kind !== "waiting") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status.kind]);

  // Poll pairing-code status; stops on success, expiry, or terminal error
  useEffect(() => {
    if (!open || !pair || status.kind !== "waiting") return;
    let cancelled = false;
    const poll = async () => {
      // Expiry short-circuit
      if (new Date(pair.expires_at).getTime() <= Date.now()) {
        if (!cancelled) setStatus({ kind: "expired" });
        return;
      }
      try {
        const row = await lookupFn({ data: { code: pair.code } });
        if (cancelled) return;
        if (!row) {
          setStatus({ kind: "error", message: "Pairing code no longer exists — it may have been revoked." });
          return;
        }
        if (row.consumed_at && row.device_id) {
          setStatus({ kind: "paired", deviceId: row.device_id });
          qc.invalidateQueries({ queryKey: ["esl-devices"] });
          onPaired();
          toast.success("Device paired successfully.");
          return;
        }
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          setStatus({ kind: "expired" });
          return;
        }
      } catch (e: any) {
        if (!cancelled) setStatus({ kind: "error", message: e?.message ?? "Lost connection while polling." });
      }
    };
    const iv = setInterval(poll, 3000);
    poll();
    return () => { cancelled = true; clearInterval(iv); };
  }, [open, pair, status.kind, lookupFn, qc, onPaired]);

  const remainingSec = useMemo(() => {
    if (!pair) return 0;
    return Math.max(0, Math.floor((new Date(pair.expires_at).getTime() - now) / 1000));
  }, [pair, now]);
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <QrCode className="h-3.5 w-3.5" />Pair via QR
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Pair a device with QR</DialogTitle></DialogHeader>
        {!pair ? (
          <div className="space-y-3">
            <div>
              <Label>Name (optional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Front-desk QR scanner" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as EslDeviceKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_META) as EslDeviceKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{KIND_META[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Connection</Label>
                <Select value={connection} onValueChange={(v) => setConnection(v as EslDeviceConnection)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONN_META) as EslDeviceConnection[]).map((k) => (
                      <SelectItem key={k} value={k}>{CONN_META[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A single-use code is generated. Scan on the device you're pairing to finish registration.
            </p>
            {status.kind === "error" && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{status.message}</span>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? "Generating…" : "Generate pairing QR"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className={`flex justify-center bg-white p-4 rounded ${status.kind !== "waiting" ? "opacity-40" : ""}`}>
              {qrDataUrl && <img src={qrDataUrl} alt="Pairing QR" className="w-64 h-64" />}
            </div>

            <div className="rounded-md bg-muted p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-lg tracking-widest">{pair.code}</span>
                <Button
                  size="icon" variant="ghost"
                  onClick={() => { navigator.clipboard.writeText(pair.code); toast.success("Copied."); }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>

              {status.kind === "waiting" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Waiting for scan…</span>
                  <span className="ml-auto inline-flex items-center gap-1 font-mono">
                    <Clock className="h-3 w-3" />{mm}:{ss}
                  </span>
                </div>
              )}
              {status.kind === "paired" && (
                <div className="flex items-center gap-2 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Paired successfully.</span>
                </div>
              )}
              {status.kind === "expired" && (
                <div className="flex items-center gap-2 text-xs text-amber-600">
                  <Clock className="h-3.5 w-3.5" />
                  <span>This code expired before it was scanned. Generate a new one.</span>
                </div>
              )}
              {status.kind === "error" && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{status.message}</span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              {status.kind === "paired" && (
                <Button asChild variant="default" className="gap-1.5">
                  <Link
                    to="/admin/esl"
                    hash={`device-${status.deviceId}`}
                    onClick={() => setOpen(false)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open device
                  </Link>
                </Button>
              )}
              {(status.kind === "expired" || status.kind === "error") && (
                <Button
                  variant="default"
                  onClick={() => { reset(); }}
                >
                  Generate new code
                </Button>
              )}
              <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}



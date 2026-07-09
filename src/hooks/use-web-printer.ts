// Browser-native printer bridge: WebUSB + Web Bluetooth + Web Serial.
// Feature-detects at call time; every method returns a helpful message when
// the browser does not support that transport (Safari/iOS especially).

const NAV: any = typeof navigator !== "undefined" ? navigator : {};

export const webPrinterSupport = () => ({
  webusb: !!NAV.usb,
  webbluetooth: !!NAV.bluetooth,
  webserial: !!NAV.serial,
});

// ---- WebUSB ---------------------------------------------------------
// ESC/POS thermal printers use USB class 7 (printer). Users choose the
// device in a Chrome-native permission dialog on first pair.

export async function requestUsbPrinter(): Promise<any> {
  if (!NAV.usb) throw new Error("WebUSB not supported in this browser (use Chrome/Edge desktop).");
  const device: any = await NAV.usb.requestDevice({
    filters: [{ classCode: 7 }], // USB printer class
  });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((i: any) =>
    i.alternate.endpoints.some((e: any) => e.direction === "out" && e.type === "bulk"),
  );
  if (!iface) throw new Error("Printer has no bulk OUT endpoint.");
  await device.claimInterface(iface.interfaceNumber);
  return device;
}

export async function sendUsbBytes(device: any, bytes: Uint8Array) {
  const iface = device.configuration.interfaces.find((i: any) =>
    i.alternate.endpoints.some((e: any) => e.direction === "out" && e.type === "bulk"),
  );
  const ep = iface.alternate.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
  await device.transferOut(ep.endpointNumber, bytes);
}

// ---- Web Bluetooth --------------------------------------------------
// Most thermal BT printers expose the Serial Port Profile via a custom
// service. Common UUIDs cover Xprinter, MPT-II, GOOJPRT, Rongta.

const BT_PRINTER_SERVICES = [
  0x18f0,
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

export async function requestBluetoothPrinter(): Promise<any> {
  if (!NAV.bluetooth) throw new Error("Web Bluetooth not supported in this browser (use Chrome/Edge desktop, Android Chrome).");
  const device: any = await NAV.bluetooth.requestDevice({
    filters: BT_PRINTER_SERVICES.map((s) => ({ services: [s] })),
    optionalServices: BT_PRINTER_SERVICES,
  });
  return device;
}

export async function sendBluetoothBytes(device: any, bytes: Uint8Array) {
  const server = await device.gatt.connect();
  for (const svcUuid of BT_PRINTER_SERVICES) {
    try {
      const svc = await server.getPrimaryService(svcUuid as any);
      const chars = await svc.getCharacteristics();
      const writable = chars.find((c: any) => c.properties.write || c.properties.writeWithoutResponse);
      if (writable) {
        for (let i = 0; i < bytes.length; i += 180) {
          await writable.writeValueWithoutResponse(bytes.slice(i, i + 180));
        }
        return;
      }
    } catch { /* try next service */ }
  }
  throw new Error("No writable characteristic found on device.");
}

// ---- Web Serial (USB serial / RS-232 adapters) ---------------------

export async function requestSerialPrinter(): Promise<any> {
  if (!NAV.serial) throw new Error("Web Serial not supported in this browser (use Chrome/Edge desktop).");
  const port: any = await NAV.serial.requestPort({});
  await port.open({ baudRate: 9600 });
  return port;
}

export async function sendSerialBytes(port: any, bytes: Uint8Array) {
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

// ---- Print via browser's system dialog (fallback for PDFs/docs) ----

export function browserPrint(html: string) {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) throw new Error("Popup blocked — allow popups to print.");
  w.document.write(`<!doctype html><html><head><title>Print</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #ccc; padding: 6px 4px; text-align: left; }
      @media print { .no-print { display: none; } }
    </style>
  </head><body>${html}<script>setTimeout(function(){window.print();},250);</script></body></html>`);
  w.document.close();
}

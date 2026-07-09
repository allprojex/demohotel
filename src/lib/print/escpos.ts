// Minimal ESC/POS command encoder for thermal receipt printers.
// Works with Epson TM-T20/T88, Star TSP, most generic 58/80mm thermal printers.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Align = "left" | "center" | "right";

export class EscPosBuilder {
  private chunks: number[] = [];

  private push(...bytes: number[]) {
    this.chunks.push(...bytes);
    return this;
  }

  init() { return this.push(ESC, 0x40); }
  feed(n = 1) { return this.push(ESC, 0x64, n); }
  cut() { return this.push(GS, 0x56, 0x00); }

  align(a: Align) {
    const map = { left: 0, center: 1, right: 2 } as const;
    return this.push(ESC, 0x61, map[a]);
  }

  bold(on: boolean) { return this.push(ESC, 0x45, on ? 1 : 0); }
  underline(on: boolean) { return this.push(ESC, 0x2d, on ? 1 : 0); }
  doubleSize(on: boolean) { return this.push(GS, 0x21, on ? 0x11 : 0x00); }

  text(s: string) {
    const bytes = new TextEncoder().encode(s);
    this.chunks.push(...bytes);
    return this;
  }
  line(s = "") { return this.text(s).push(LF); }
  hr(char = "-", width = 32) { return this.line(char.repeat(width)); }

  // Two-column: label on left, value on right, padded to width
  kv(label: string, value: string, width = 32) {
    const space = Math.max(1, width - label.length - value.length);
    return this.line(label + " ".repeat(space) + value);
  }

  // Common barcode (CODE128)
  barcode(data: string) {
    this.push(GS, 0x68, 80);           // height
    this.push(GS, 0x77, 2);             // width
    this.push(GS, 0x48, 2);             // HRI below
    this.push(GS, 0x6b, 73, data.length); // CODE128
    const bytes = new TextEncoder().encode(data);
    this.chunks.push(...bytes);
    return this.push(LF);
  }

  qr(data: string, size = 6) {
    // Model
    this.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Size
    this.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    // Error correction
    this.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30);
    // Store data
    const bytes = new TextEncoder().encode(data);
    const len = bytes.length + 3;
    this.push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.chunks.push(...bytes);
    // Print
    return this.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  }

  build(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

export type ReceiptLine =
  | { type: "text"; text: string; align?: Align; bold?: boolean; large?: boolean }
  | { type: "kv"; label: string; value: string }
  | { type: "hr" }
  | { type: "barcode"; data: string }
  | { type: "qr"; data: string }
  | { type: "feed"; n?: number };

export function buildReceipt(header: string, lines: ReceiptLine[], width = 32): Uint8Array {
  const b = new EscPosBuilder().init();
  if (header) b.align("center").bold(true).doubleSize(true).line(header).doubleSize(false).bold(false).feed(1);
  b.align("left");
  for (const l of lines) {
    switch (l.type) {
      case "text":
        b.align(l.align ?? "left");
        if (l.bold) b.bold(true);
        if (l.large) b.doubleSize(true);
        b.line(l.text);
        if (l.large) b.doubleSize(false);
        if (l.bold) b.bold(false);
        break;
      case "kv": b.kv(l.label, l.value, width); break;
      case "hr": b.hr("-", width); break;
      case "barcode": b.align("center").barcode(l.data).align("left"); break;
      case "qr": b.align("center").qr(l.data).align("left"); break;
      case "feed": b.feed(l.n ?? 1); break;
    }
  }
  b.feed(3).cut();
  return b.build();
}

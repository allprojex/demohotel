// Minimal ZPL (Zebra Programming Language) label builder.
// Works with Zebra ZD, GK, ZT series and most ZPL-II compatible label printers.

export type ZplLabelSpec = {
  widthDots?: number;   // 8 dots/mm at 203dpi. 400 = 50mm
  heightDots?: number;
  title?: string;
  price?: string;
  subtitle?: string;
  barcode?: string;
  barcodeType?: "CODE128" | "EAN13" | "UPC-A" | "QR";
};

export function buildZplLabel(spec: ZplLabelSpec): Uint8Array {
  const w = spec.widthDots ?? 400;
  const h = spec.heightDots ?? 240;
  const parts: string[] = [
    "^XA",
    `^PW${w}`,
    `^LL${h}`,
    "^CI28", // UTF-8
  ];

  let y = 20;
  if (spec.title) {
    parts.push(`^FO20,${y}^A0N,36,36^FD${escape(spec.title)}^FS`);
    y += 45;
  }
  if (spec.subtitle) {
    parts.push(`^FO20,${y}^A0N,24,24^FD${escape(spec.subtitle)}^FS`);
    y += 32;
  }
  if (spec.price) {
    parts.push(`^FO20,${y}^A0N,60,60^FB${w - 40},1,0,R^FD${escape(spec.price)}^FS`);
    y += 70;
  }
  if (spec.barcode) {
    const bc = spec.barcode;
    switch (spec.barcodeType) {
      case "EAN13":
        parts.push(`^FO40,${y}^BEN,60,Y,N^FD${escape(bc)}^FS`);
        break;
      case "UPC-A":
        parts.push(`^FO40,${y}^BUN,60,Y,N^FD${escape(bc)}^FS`);
        break;
      case "QR":
        parts.push(`^FO40,${y}^BQN,2,6^FDLA,${escape(bc)}^FS`);
        break;
      case "CODE128":
      default:
        parts.push(`^FO40,${y}^BCN,60,Y,N,N^FD${escape(bc)}^FS`);
    }
  }
  parts.push("^XZ");
  return new TextEncoder().encode(parts.join("\n"));
}

function escape(s: string) {
  return s.replace(/[\^~]/g, "");
}

// PrintNode cloud-print adapter.
// Requires PRINTNODE_API_KEY runtime secret; when absent, all calls return
// { available: false } and the UI degrades to browser-native printers only.

import { useQuery } from "@tanstack/react-query";
import { listPrintNodePrinters, sendPrintNodeJob } from "@/lib/printer/printnode.functions";

export type PrintNodePrinter = {
  id: number;
  name: string;
  description?: string;
  state: string;
  computer?: { name: string };
};

export function usePrintNodePrinters() {
  return useQuery({
    queryKey: ["printnode-printers"],
    queryFn: async () => {
      const res = await listPrintNodePrinters();
      return res as { available: boolean; printers: PrintNodePrinter[]; error?: string };
    },
    staleTime: 30_000,
    retry: false,
  });
}

export async function submitCloudJob(input: {
  printnodeId: number;
  title: string;
  contentType: "pdf_uri" | "pdf_base64" | "raw_base64";
  content: string;
  copies?: number;
}) {
  return sendPrintNodeJob({ data: input });
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGeminiAiStudio } from "./google-ai.server";

const FIELD_KEYS = [
  "itemName",
  "hsn",
  "qty",
  "unitPrice",
  "discount",
  "taxableValue",
  "cgst",
  "sgst",
  "igst",
  "total",
] as const;
export type PurchaseFieldKey = (typeof FIELD_KEYS)[number];

const Input = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
  fields: z.array(z.enum(FIELD_KEYS)).min(1),
  allowedCategories: z.array(z.string()).optional(),
});

export type PurchaseLine = {
  itemName: string;
  hsn: string | null;
  qty: number | null;
  unitPrice: number | null;
  discount: number | null;
  taxableValue: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total: number | null;
  itemCode: string | null; // matched inventory
  category: string | null;
};

export type ProcessPurchaseError = {
  code: "GOOGLE_RATE_LIMIT" | "GOOGLE_API_KEY_INVALID" | "AI_UNAVAILABLE";
  message: string;
  retryable: boolean;
};

export type ProcessPurchaseResult = {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  items: PurchaseLine[];
  error?: ProcessPurchaseError;
};

const asAiError = (err: unknown) => err as { message?: string };
const googleErrorCode = (message: string): ProcessPurchaseError["code"] => {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("quota")) return "GOOGLE_RATE_LIMIT";
  if (lower.includes("api key") || lower.includes("invalid") || lower.includes("lacks access"))
    return "GOOGLE_API_KEY_INVALID";
  return "AI_UNAVAILABLE";
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export const processPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ProcessPurchaseResult> => {
    const googleKey = process.env.GOOGLE_AI_API_KEY;
    if (!googleKey) {
      return {
        supplierName: "",
        invoiceNumber: "",
        invoiceDate: "",
        items: [],
        error: {
          code: "GOOGLE_API_KEY_INVALID",
          message: "GOOGLE_AI_API_KEY is not configured.",
          retryable: false,
        },
      };
    }

    const supabase = context.supabase;

    // Fetch inventory (scoped to allowed categories if provided).
    const fetchAllInventory = async () => {
      const rows: { item_code: string; item_name: string; category: string | null; brand: string | null }[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error } = await supabase
          .from("inventory")
          .select("item_code,item_name,category,brand")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const chunk = data ?? [];
        rows.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      return rows;
    };

    const inventory = await fetchAllInventory();
    const allowed = data.allowedCategories && data.allowedCategories.length
      ? new Set(data.allowedCategories.map((c) => c.trim()).filter(Boolean))
      : null;
    const scopedInventory = allowed
      ? inventory.filter((i) => allowed.has((i.category ?? "").trim()))
      : inventory;

    const invList = scopedInventory
      .slice(0, 4000)
      .map((i) => `${i.item_code} | ${i.item_name} | ${i.category ?? ""} | ${i.brand ?? ""}`)
      .join("\n");

    const fieldList = data.fields.join(", ");

    const systemPrompt = `You are an expert at reading supplier / vendor purchase invoices (GST bills) for an electrical & building-materials shop. Bills may be printed or photographed and can be noisy.

TASK:
1. Extract HEADER info: supplier / vendor name, invoice number, invoice date.
2. Extract each LINE ITEM from the invoice body.
3. For every line item, ONLY populate the fields the user asked for (listed below). Set fields NOT requested to null.
4. Attempt to MATCH each item name to an Item Code from the Master Inventory below by product name + size/spec. If no confident match, set itemCode to null. Never invent codes.
5. Numeric fields must be raw numbers (no currency symbols, no commas). Percentages like "9%" for CGST should be captured as the numeric AMOUNT in rupees on that line, NOT the percent — unless only a percent is shown, in which case return the percent number.
6. Ignore totals rows, subtotals, grand totals, roundoff, and any summary block at the bottom. Only true line items.

REQUESTED FIELDS: ${fieldList}

Return ONLY valid JSON, no markdown fences, shape:
{
  "supplierName": "<string>",
  "invoiceNumber": "<string>",
  "invoiceDate": "<string as shown>",
  "items": [
    {
      "itemName": "<string>",
      "hsn": "<string or null>",
      "qty": <number or null>,
      "unitPrice": <number or null>,
      "discount": <number or null>,
      "taxableValue": <number or null>,
      "cgst": <number or null>,
      "sgst": <number or null>,
      "igst": <number or null>,
      "total": <number or null>,
      "itemCode": "<inventory code or null>",
      "category": "<inventory category or null>"
    }
  ]
}

== MASTER INVENTORY (item_code | item_name | category | brand) ==
${invList || "(empty)"}`;

    const userText = "Extract header + line items from this purchase invoice image per the rules.";

    let rawText: string;
    try {
      rawText = await callGeminiAiStudio({
        apiKey: googleKey,
        systemPrompt,
        userText,
        imageBase64: data.imageBase64,
        mimeType: data.mimeType,
      });
    } catch (err: unknown) {
      const e = asAiError(err);
      const message = e?.message || "Google AI is unavailable.";
      const code = googleErrorCode(message);
      return {
        supplierName: "",
        invoiceNumber: "",
        invoiceDate: "",
        items: [],
        error: { code, message, retryable: code !== "GOOGLE_API_KEY_INVALID" },
      };
    }

    const text = rawText.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { supplierName: "", invoiceNumber: "", invoiceDate: "", items: [] };
    }
    let parsed: {
      supplierName?: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      items?: Array<Record<string, unknown>>;
    };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { supplierName: "", invoiceNumber: "", invoiceDate: "", items: [] };
    }

    const items: PurchaseLine[] = (parsed.items ?? []).map((i) => ({
      itemName: str(i.itemName) ?? "",
      hsn: str(i.hsn),
      qty: num(i.qty),
      unitPrice: num(i.unitPrice),
      discount: num(i.discount),
      taxableValue: num(i.taxableValue),
      cgst: num(i.cgst),
      sgst: num(i.sgst),
      igst: num(i.igst),
      total: num(i.total),
      itemCode: str(i.itemCode),
      category: str(i.category),
    }));

    return {
      supplierName: str(parsed.supplierName) ?? "",
      invoiceNumber: str(parsed.invoiceNumber) ?? "",
      invoiceDate: str(parsed.invoiceDate) ?? "",
      items,
    };
  });

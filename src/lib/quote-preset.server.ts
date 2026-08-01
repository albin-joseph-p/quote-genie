import type { SupabaseClient } from "@supabase/supabase-js";
import { callGeminiAiStudio } from "./google-ai.server";

export type ComparisonRow = {
  extractedText: string;
  customerQty: number | null;
  itemCode: string | null;
  itemName: string | null;
  category: string | null;
  brand: string | null;
  confidence: "high" | "medium" | "low" | "none";
  note: string | null;
};

type InvRow = { item_code: string; item_name: string; category: string | null; brand: string | null };

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchInventoryForCompare(supabase: SupabaseClient<any, any, any>) {
  const rows: InvRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabase
      .from("inventory")
      .select("item_code,item_name,category,brand")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as InvRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export function buildComparePrompt(params: {
  inventory: InvRow[];
  instructions: string;
  measurements: { input_unit: string; mm_value: number }[];
  excelLayout: string;
  categories: string[];
}) {
  const invList = params.inventory
    .map((i) => `${i.item_code} | ${i.item_name} | ${i.category ?? ""} | ${i.brand ?? ""}`)
    .join("\n");
  const measureList = params.measurements.map((m) => `${m.input_unit} => ${m.mm_value} mm`).join("\n");

  return `You are an expert at reading customer quotation documents (often handwritten or messy photos) for an electrical / sanitary / building-materials shop, and at matching each written line to a product in a master inventory.

== GLOBAL USER INSTRUCTIONS — HIGHEST PRIORITY ==
${params.instructions || "(none provided)"}

Task: read EVERY line item in the supplied sample document and produce a COMPARISON LIST that pairs what the customer wrote with the best matching product from the master inventory, so the user can sort and verify the mapping.

Rules:
1. Preserve the customer's text exactly as written, including every size, gauge, class and unit token.
2. Size / dimension / gauge / class / amperage tokens MUST match exactly ("2 1/2" is not "1 1/2", "20A" is not "16A"). Normalize fractions before comparing.
3. Product type and material must match. Never cross a distinction defined in the global instructions.
4. Use the measurement conversion table below as a HARD override before any raw inch->mm math.
5. If no inventory row satisfies the rules, set itemCode to null and confidence to "none", with a short note explaining what is missing.
6. confidence: "high" = exact size + type + name match, "medium" = size and type match but name/brand differ, "low" = plausible but uncertain, "none" = no match.
7. customerQty is the integer quantity requested, or null.
8. Ignore prices, totals, headers, addresses, dates and signatures.

Return ONLY valid JSON:
{"rows":[{"extractedText":"...","customerQty":<number|null>,"itemCode":"<code|null>","confidence":"high|medium|low|none","note":"<short reason or null>"}]}

== DESIRED OUTPUT FORMAT (read off the user's sample Excel sheet; follow its ordering / grouping conventions when listing rows) ==
${params.excelLayout || "(no sample sheet uploaded)"}

== CATEGORIES PRESENT IN INVENTORY ==
${params.categories.join(", ") || "(none)"}

== MEASUREMENT CONVERSIONS (customer size => internal mm standard; HARD overrides) ==
${measureList || "(none defined)"}

== MASTER INVENTORY (item_code | item_name | category | brand) ==
${invList || "(empty)"}`;
}

export async function runCompare(params: {
  apiKey: string;
  systemPrompt: string;
  imageBase64: string;
  mimeType: string;
  inventory: InvRow[];
}): Promise<ComparisonRow[]> {
  const raw = await callGeminiAiStudio({
    apiKey: params.apiKey,
    systemPrompt: params.systemPrompt,
    userText:
      "Read this sample document and return the comparison list mapping each written line to an inventory item_code.",
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
  });
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: {
    rows?: {
      extractedText?: unknown;
      customerQty?: unknown;
      itemCode?: unknown;
      confidence?: unknown;
      note?: unknown;
    }[];
  };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const byCode = new Map(params.inventory.map((i) => [i.item_code, i]));
  const allowed = new Set(["high", "medium", "low", "none"]);
  return (parsed.rows ?? []).map((r) => {
    const code = r.itemCode ? String(r.itemCode) : null;
    const inv = code ? byCode.get(code) : undefined;
    const conf = allowed.has(String(r.confidence)) ? (String(r.confidence) as ComparisonRow["confidence"]) : "low";
    return {
      extractedText: String(r.extractedText ?? ""),
      customerQty: typeof r.customerQty === "number" ? r.customerQty : null,
      itemCode: inv ? inv.item_code : null,
      itemName: inv?.item_name ?? null,
      category: inv?.category ?? null,
      brand: inv?.brand ?? null,
      confidence: inv ? conf : "none",
      note: r.note ? String(r.note) : null,
    };
  });
}

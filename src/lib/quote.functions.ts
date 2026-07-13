import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGeminiAiStudio } from "./google-ai.server";


const Input = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
  allowedCategories: z.array(z.string()).min(1),
});

export type MatchedItem = {
  extractedText: string;
  itemCode: string | null;
  category: string | null;
  customerQty?: number | null;
};

export type ProcessQuotationError = {
  code: "LOVABLE_CREDITS_EXHAUSTED" | "GOOGLE_RATE_LIMIT" | "GOOGLE_API_KEY_INVALID" | "AI_RATE_LIMIT" | "AI_UNAVAILABLE";
  message: string;
  retryable: boolean;
};

export type ProcessQuotationResult = {
  items: MatchedItem[];
  error?: ProcessQuotationError;
};

const asAiError = (err: unknown) => err as { statusCode?: number; status?: number; message?: string };

const googleErrorCode = (message: string): ProcessQuotationError["code"] => {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("quota")) return "GOOGLE_RATE_LIMIT";
  if (lower.includes("api key") || lower.includes("invalid") || lower.includes("lacks access")) return "GOOGLE_API_KEY_INVALID";
  return "AI_UNAVAILABLE";
};

export const processQuotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ProcessQuotationResult> => {
    const googleKey = process.env.GOOGLE_AI_API_KEY;
    if (!googleKey) {
      return {
        items: [],
        error: {
          code: "GOOGLE_API_KEY_INVALID",
          message: "GOOGLE_AI_API_KEY is not configured.",
          retryable: false,
        },
      };
    }


    const supabase = context.supabase;

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

    const [inventory, { data: synonyms }, { data: instructionsRow }] = await Promise.all([
      fetchAllInventory(),
      supabase.from("synonyms").select("customer_term,item_code"),
      supabase.from("ai_instructions").select("instructions").limit(1).maybeSingle(),
    ]);

    // Restrict inventory + categories to the user's selected categories. This is
    // mandatory input, so the AI can only match within the chosen scope.
    const allowedSet = new Set(data.allowedCategories.map((c) => c.trim()).filter(Boolean));
    const scopedInventory = (inventory ?? []).filter((i) =>
      allowedSet.has((i.category ?? "").trim()),
    );

    const invList = scopedInventory
      .map((i) => `${i.item_code} | ${i.item_name} | ${i.category ?? ""} | ${i.brand ?? ""}`)
      .join("\n");
    const synList = (synonyms ?? [])
      .map((s) => `"${s.customer_term}" => ${s.item_code}`)
      .join("\n");
    const categoryNames = Array.from(allowedSet).sort((a, b) => a.localeCompare(b));
    const catList = categoryNames.join(", ");
    const customInstructions = (instructionsRow?.instructions ?? "").trim();


    const systemPrompt = `You are an expert at reading customer quotation images (often handwritten or messy photos) for an electrical/sanitary/building-materials shop.

Your job:
1. Extract each line item the customer is asking for from the image EXACTLY as written, preserving every size, dimension, gauge, class, and unit token (e.g. "2 1/2", "1.5 sqmm", "B CLASS", "20mm", "3 core").
2. Map each extracted line to an Item Code from the Master Inventory.
3. Use the Synonym Map as HARD overrides — if a customer's text matches a synonym, you MUST use the mapped item_code.
4. Otherwise pick the best match from inventory using this STRICT priority:
   a. SIZE / DIMENSION / GAUGE / CLASS tokens MUST match exactly. "2 1/2" ≠ "1 1/2", "2.5" ≠ "1.5", "20mm" ≠ "25mm", "B class" ≠ "A class". If no inventory item shares the exact size, set item_code to null — do NOT substitute a different size.
   b. Product type / material must match (e.g. "GI pipe" must map to a GI pipe, not a PVC pipe).
   c. Only after (a) and (b) are satisfied, use brand / other descriptors as tiebreakers.
5. Normalize fractions before comparing: "2 1/2" = "2.5" = "2-1/2" = "2½". "1 1/2" = "1.5". Treat these as equal to their decimal equivalents when matching inventory names.
6. If multiple inventory items match the exact size and type, pick the closest by name; if none match the exact size, RETURN null rather than a wrong-size item. A null match is better than a wrong-size match.
7. Classify each line into ONE of the ALLOWED CATEGORIES below. The Master Inventory shown to you has ALREADY been filtered to only these categories — you MUST NOT match items outside them. If no inventory item fits an extracted line within these categories, set itemCode to null and category to null.
8. Extract customerQty as the integer quantity the customer wants (the number after the item, often after a dash or "x"). If unclear, set null.
9. Ignore prices, totals, headers, addresses, dates, signatures.

Return ONLY valid JSON, no prose, no markdown fences. Shape:
{"items":[{"extractedText":"<as written by customer>","itemCode":"<code or null>","category":"<one of allowed or null>","customerQty":<number or null>}]}

== ALLOWED CATEGORIES (strict — use one of these or null) ==
${catList || "(none defined yet — set category to null)"}

== MASTER INVENTORY (item_code | item_name | category | brand) ==
${invList || "(empty)"}

== SYNONYM MAP (customer_term => item_code) ==
${synList || "(none)"}

== GLOBAL USER INSTRUCTIONS (highest priority — obey these) ==
${customInstructions || "(none)"}`;


    const userText = "Extract the line items from this quotation image and map them per the rules.";
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
        items: [],
        error: {
          code,
          message,
          retryable: code === "GOOGLE_RATE_LIMIT" || code === "AI_UNAVAILABLE",
        },
      };
    }


    const text = rawText.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { items: [] };


    let parsed: { items?: MatchedItem[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { items: [] };
    }
    const allowedCats = new Set(categoryNames);
    const items = (parsed.items ?? []).map((i) => ({
      extractedText: String(i.extractedText ?? ""),
      itemCode: i.itemCode ? String(i.itemCode) : null,
      category: i.category && allowedCats.has(String(i.category)) ? String(i.category) : null,
      customerQty: typeof i.customerQty === "number" ? i.customerQty : null,
    }));
    return { items };
  });

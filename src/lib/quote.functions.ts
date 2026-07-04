import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { callGeminiAiStudio } from "./google-ai.server";


const Input = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
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
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<ProcessQuotationResult> => {
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


    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
    );

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

    const [inventory, { data: synonyms }, { data: categories }, { data: instructionsRow }] = await Promise.all([
      fetchAllInventory(),
      supabase.from("synonyms").select("customer_term,item_code"),
      supabase.from("categories").select("name").order("name"),
      supabase.from("ai_instructions").select("instructions").limit(1).maybeSingle(),
    ]);

    const invList = (inventory ?? [])
      .map((i) => `${i.item_code} | ${i.item_name} | ${i.category ?? ""} | ${i.brand ?? ""}`)
      .join("\n");
    const synList = (synonyms ?? [])
      .map((s) => `"${s.customer_term}" => ${s.item_code}`)
      .join("\n");
    const catList = (categories ?? []).map((c) => c.name).join(", ");
    const customInstructions = (instructionsRow?.instructions ?? "").trim();

    const gateway = createLovableAiGatewayProvider(apiKey);

    const systemPrompt = `You are an expert at reading customer quotation images (often handwritten or messy photos) for an electrical/sanitary/building-materials shop.

Your job:
1. Extract each line item the customer is asking for from the image.
2. Map each extracted line to an Item Code from the Master Inventory.
3. Use the Synonym Map as HARD overrides — if a customer's text matches a synonym, you MUST use the mapped item_code.
4. Otherwise pick the best fuzzy match from inventory. If nothing reasonably matches, set item_code to null.
5. Classify each line into ONE of the ALLOWED CATEGORIES below. NEVER invent a category. If none fits, set category to null.
6. Ignore prices, totals, headers, addresses, dates, signatures.

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
      const result = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              {
                type: "image",
                image: `data:${data.mimeType};base64,${data.imageBase64}`,
              } as never,
            ],
          },
        ],
      });
      rawText = result.text;
    } catch (err: unknown) {
      const e = asAiError(err);
      const status = e?.statusCode ?? e?.status;
      if (status === 402) {
        // Fallback: user-supplied Google AI Studio key
        const googleKey = process.env.GOOGLE_AI_API_KEY;
        if (!googleKey) {
          return {
            items: [],
            error: {
              code: "LOVABLE_CREDITS_EXHAUSTED",
              message: "AI credits are exhausted, and no Google AI fallback key is configured.",
              retryable: false,
            },
          };
        }
        try {
          const { callGeminiAiStudio } = await import("./google-ai.server");
          rawText = await callGeminiAiStudio({
            apiKey: googleKey,
            systemPrompt,
            userText,
            imageBase64: data.imageBase64,
            mimeType: data.mimeType,
          });
        } catch (gErr: unknown) {
          const g = asAiError(gErr);
          const message = g?.message || "Google AI fallback is unavailable.";
          const code = googleErrorCode(message);
          return {
            items: [],
            error: {
              code,
              message:
                code === "GOOGLE_RATE_LIMIT"
                  ? "Google AI fallback reached its rate limit or free-tier quota. Please try again in a minute."
                  : message,
              retryable: code === "GOOGLE_RATE_LIMIT" || code === "AI_UNAVAILABLE",
            },
          };
        }
      } else if (status === 429) {
        return {
          items: [],
          error: {
            code: "AI_RATE_LIMIT",
            message: "AI rate limit reached. Please wait a moment and try again.",
            retryable: true,
          },
        };
      } else {
        return {
          items: [],
          error: {
            code: "AI_UNAVAILABLE",
            message: e?.message || "AI processing failed. Please try again.",
            retryable: true,
          },
        };
      }
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
    const allowedCats = new Set((categories ?? []).map((c) => c.name));
    const items = (parsed.items ?? []).map((i) => ({
      extractedText: String(i.extractedText ?? ""),
      itemCode: i.itemCode ? String(i.itemCode) : null,
      category: i.category && allowedCats.has(String(i.category)) ? String(i.category) : null,
      customerQty: typeof i.customerQty === "number" ? i.customerQty : null,
    }));
    return { items };
  });

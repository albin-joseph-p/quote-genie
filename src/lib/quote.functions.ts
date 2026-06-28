import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

export type MatchedItem = {
  extractedText: string;
  itemCode: string | null;
  customerQty?: number | null;
};

export const processQuotation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<{ items: MatchedItem[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
    );

    const [{ data: inventory }, { data: synonyms }] = await Promise.all([
      supabase.from("inventory").select("item_code,item_name,category"),
      supabase.from("synonyms").select("customer_term,item_code"),
    ]);

    const invList = (inventory ?? [])
      .map((i) => `${i.item_code} | ${i.item_name} | ${i.category ?? ""}`)
      .join("\n");
    const synList = (synonyms ?? [])
      .map((s) => `"${s.customer_term}" => ${s.item_code}`)
      .join("\n");

    const gateway = createLovableAiGatewayProvider(apiKey);

    const systemPrompt = `You are an expert at reading customer quotation images (often handwritten or messy photos) for an electrical/sanitary/building-materials shop.

Your job:
1. Extract each line item the customer is asking for from the image.
2. Map each extracted line to an Item Code from the Master Inventory.
3. Use the Synonym Map as HARD overrides — if a customer's text matches a synonym, you MUST use the mapped item_code.
4. Otherwise pick the best fuzzy match from inventory. If nothing reasonably matches, set item_code to null.
5. Ignore prices, totals, headers, addresses, dates, signatures.

Return ONLY valid JSON, no prose, no markdown fences. Shape:
{"items":[{"extractedText":"<as written by customer>","itemCode":"<code or null>","customerQty":<number or null>}]}

== MASTER INVENTORY (item_code | item_name | category) ==
${invList || "(empty)"}

== SYNONYM MAP (customer_term => item_code) ==
${synList || "(none)"}`;

    const result = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the line items from this quotation image and map them per the rules." },
            {
              type: "image",
              image: `data:${data.mimeType};base64,${data.imageBase64}`,
            } as never,
          ],
        },
      ],
    });

    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { items: [] };
    }
    let parsed: { items?: MatchedItem[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { items: [] };
    }
    const items = (parsed.items ?? []).map((i) => ({
      extractedText: String(i.extractedText ?? ""),
      itemCode: i.itemCode ? String(i.itemCode) : null,
      customerQty: typeof i.customerQty === "number" ? i.customerQty : null,
    }));
    return { items };
  });

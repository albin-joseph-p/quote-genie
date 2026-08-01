import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildComparePrompt,
  fetchInventoryForCompare,
  runCompare,
  type ComparisonRow,
} from "./quote-preset.server";

export type { ComparisonRow };

export type CompareResult = { rows: ComparisonRow[]; error?: string };

const CompareInput = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
  excelLayout: z.string().optional(),
});

export const compareSampleToInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompareInput.parse(data))
  .handler(async ({ data, context }): Promise<CompareResult> => {
    const apiKey = process.env["GOOGLE_AI_API_KEY"];
    if (!apiKey) return { rows: [], error: "GOOGLE_AI_API_KEY is not configured." };

    const supabase = context.supabase;
    const [inventory, { data: instructionsRow }, { data: measurements }] = await Promise.all([
      fetchInventoryForCompare(supabase),
      supabase.from("ai_instructions").select("instructions").limit(1).maybeSingle(),
      supabase.from("measurement_conversions").select("input_unit,mm_value").order("input_unit"),
    ]);

    const categories = Array.from(
      new Set(inventory.map((i) => (i.category ?? "").trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    const systemPrompt = buildComparePrompt({
      inventory,
      instructions: (instructionsRow?.instructions ?? "").trim(),
      measurements: (measurements ?? []).map((m) => ({
        input_unit: String(m.input_unit),
        mm_value: Number(m.mm_value),
      })),
      excelLayout: (data.excelLayout ?? "").trim(),
      categories,
    });

    try {
      const rows = await runCompare({
        apiKey,
        systemPrompt,
        imageBase64: data.imageBase64,
        mimeType: data.mimeType,
        inventory,
      });
      return { rows };
    } catch (err: unknown) {
      return { rows: [], error: err instanceof Error ? err.message : "AI request failed." };
    }
  });

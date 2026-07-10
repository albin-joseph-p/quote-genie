import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_categories",
  title: "List categories and brands",
  description: "Return the distinct categories and their brands derived from the master inventory.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("inventory")
      .select("category,brand")
      .limit(15000);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const map = new Map<string, Set<string>>();
    for (const row of data ?? []) {
      const cat = (row.category ?? "Uncategorized").trim() || "Uncategorized";
      const brand = (row.brand ?? "").trim();
      if (!map.has(cat)) map.set(cat, new Set());
      if (brand) map.get(cat)!.add(brand);
    }
    const result = Array.from(map.entries())
      .map(([category, brands]) => ({ category, brands: Array.from(brands).sort() }))
      .sort((a, b) => a.category.localeCompare(b.category));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: { categories: result },
    };
  },
});

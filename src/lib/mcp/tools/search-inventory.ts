import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_inventory",
  title: "Search inventory",
  description:
    "Search the Orion Sales master inventory by item name, item code, brand, or category. Returns up to 50 matches.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Text to match against item name, code, brand, or category."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const q = query.replace(/[%_]/g, " ").trim();
    const pattern = `%${q}%`;
    const { data, error } = await sb
      .from("inventory")
      .select("item_code,item_name,category,brand")
      .or(
        `item_name.ilike.${pattern},item_code.ilike.${pattern},brand.ilike.${pattern},category.ilike.${pattern}`,
      )
      .limit(limit ?? 20);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});

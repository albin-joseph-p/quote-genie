import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchInventory from "./tools/search-inventory";
import listCategories from "./tools/list-categories";
import listQuotations from "./tools/list-quotations";
import getQuotation from "./tools/get-quotation";

// The OAuth issuer must be the direct Supabase host, not the `.lovable.cloud` proxy.
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "orion-sales-mcp",
  title: "Orion Sales Corporation",
  version: "0.1.0",
  instructions:
    "Tools for the Orion Sales Corporation quotation processor. Use `search_inventory` to look up items, `list_categories` to see the taxonomy, and `list_quotations` / `get_quotation` to review processed customer quotations.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchInventory, listCategories, listQuotations, getQuotation],
});

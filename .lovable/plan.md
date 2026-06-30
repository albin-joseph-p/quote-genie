## Plan: Category-Driven Quotation Workspace

### 1. Database changes (one migration)

- `inventory`: drop `retail_price`, `contractor_price`, `wholesale_price`. Add `brand text not null default ''`. Keep `item_code` (PK), `item_name`, `category`.
- New `categories` table: `id`, `name` (unique). Seed with current distinct inventory categories.
- New `brands` table: `id`, `category_id` (FK, cascade), `name`. Unique `(category_id, name)`.
- Public read/write policies + grants (matches existing tables, no auth).

After migration runs, regenerate Supabase types are automatic.

### 2. Master Inventory page (`/master`)

- Show only **Item Name** and **Item Code** columns in the table (search + edit still work on those two).
- CSV import still accepts `item_code, item_name, category, brand` (category/brand optional, default empty) — needed so brand resolution works, but hidden from the UI table.
- Edit dialog keeps name + code only.

### 3. New Categories page (`/categories`)

- List user-defined categories with a "Create category" button and per-row delete.
- Each category expands to show its brands list with inline add/delete brand controls.
- This is the master list the AI must classify against.

### 4. AI extraction (`quote.functions.ts`)

- Server fn now also loads `categories` + `brands` and passes the allowed category list to the model.
- Prompt: classify each line into one of the **provided category names only** (no invention); return `{extractedText, itemCode, category, customerQty}`.
- Matching against inventory still happens, but `category` becomes the key downstream.

### 5. Quotation Workspace (`/`)

- **Remove** the Retail/Contractor/Wholesale pricing-mode toggle entirely.
- **Remove** Unit Price + Total columns and Grand Total row.
- Keep columns: Extracted Text · Matched Item (searchable Combobox) · Category · Qty · Status · Delete.
- **New top panel — Global Category Brand Selector**: one row per *category detected in the current quote*. Each row: Category label + Brand dropdown (with inline "Add brand" / "Delete brand" actions that mutate the `brands` table for that category).
- Selecting a brand for a category re-resolves every row in that category: look up `inventory` where `category = X AND brand = Y AND item_name ~ extractedText` (best fuzzy match) → swap that row's `itemCode` + display name.
- Matched Item column becomes a searchable Combobox (cmdk via existing `Command` component) — type to filter all inventory items, click to override.

### 6. Export

- Replace PDF export with CSV and **Excel (.xlsx)** via existing `xlsx`-style write (use SheetJS `xlsx` package — already common; install if missing).
- Columns: `Item Name`, `Product ID`, `Qty`.
- Keep "Copy to clipboard" producing the same 3-column tab-separated text.

### Technical notes

- Combobox: build a small inline component using existing `Popover` + `Command` shadcn primitives — no new dep.
- Brand resolution helper lives client-side in `index.tsx` using the already-loaded inventory list.
- Synonyms page stays untouched.
- Edited-row highlight (yellow) reused when user manually overrides a match or brand-driven swap differs from AI pick.

### Files touched

- migration (new)
- `src/routes/master.tsx` — strip columns, keep CSV with category/brand
- `src/routes/categories.tsx` — new
- `src/routes/__root.tsx` — add Categories nav link
- `src/lib/quote.functions.ts` — feed categories, return category
- `src/routes/index.tsx` — remove pricing, add brand panel, combobox, xlsx export
- `package.json` — add `xlsx` if not present

Proceeding will start with the migration (needs your approval), then code.
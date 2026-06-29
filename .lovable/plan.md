## Master Inventory: Search + Edit with Confirmation

Enhance `src/routes/master.tsx` with search and editable rows.

### 1. Search bar
- Add an `Input` above the inventory table with a `Search` icon.
- Filter `invQ.data` client-side by case-insensitive match on `item_code` OR `item_name` (also `category`).
- Show "X of Y items" counter and a clear button when search is active.

### 2. Inline edit per row
- Add an "Edit" (pencil) action column on the right.
- Clicking Edit switches that row into edit mode: `item_name`, `category`, `retail_price`, `contractor_price`, `wholesale_price` become `Input` fields (item_code stays read-only — it's the primary key).
- Show Save (check) and Cancel (X) icons in the action cell while editing.

### 3. Confirmation dialog
- Clicking Save opens an `AlertDialog` showing a side-by-side diff of changed fields only (Old → New).
- "Confirm" runs an update mutation: `supabase.from("inventory").update({...}).eq("item_code", code)`, then invalidates `["inventory"]` and `["inventory-min"]` queries and toasts success.
- "Cancel" closes the dialog and keeps the row in edit mode so the user can adjust.

### 4. Validation
- Prices must be numeric and ≥ 0; `item_name` required. Block Save with an inline toast if invalid.

### Technical notes
- Local state: `search: string`, `editingCode: string | null`, `draft: Partial<Inv>`, `pendingConfirm: boolean`.
- Reuse existing `AlertDialog` from `@/components/ui/alert-dialog` and `Input` from `@/components/ui/input`.
- No schema changes, no backend changes.

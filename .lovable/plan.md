## Multi-image quotation upload

Enable uploading multiple images at once (or one after another). Each image is sent to the AI in its own parallel call, and extracted line items are appended to the existing quotation table.

### Changes

**`src/routes/index.tsx`**
- File input: add `multiple` attribute; drop zone accepts multiple files.
- Replace `onFile(file)` with `onFiles(files: File[])`:
  - Cap at 10 images per upload; warn via toast if more are dropped.
  - Filter non-images; show toast for any skipped.
  - Show all selected images as a thumbnail strip (small previews with filename) instead of single preview.
  - Convert each file to base64 in parallel.
  - Fire one `processQuotation` call per image with `Promise.allSettled` so a single failure doesn't kill the batch.
  - For each successful result, append rows to existing `rows` state (sequential append behavior).
  - Toast summary: "Extracted N items from X of Y images" + per-image failure toasts.
- Loading indicator becomes a counter: "Processing 2 / 5 images…" using a small `processedCount` state.
- Keep existing manual override, tier toggle, PDF/clipboard export untouched — they already iterate over `rows`.
- Add a "Clear all" button next to Copy/Export to reset rows + previews (useful now that uploads accumulate).

**`src/lib/quote.functions.ts`**
- No structural change required (already accepts one image). Calls are parallelized client-side.

### Out of scope
- No backend/schema changes.
- No change to synonyms or master inventory pages.
- No merging/de-duplication of identical line items across images (kept as separate rows so the user can review).

### Technical notes
- Parallel calls use `Promise.allSettled` so partial failures are visible without aborting others.
- Each image's rows get unique ids via `${Date.now()}-${imgIdx}-${rowIdx}`.
- Thumbnail strip uses `URL.createObjectURL` per file; revoked on clear.

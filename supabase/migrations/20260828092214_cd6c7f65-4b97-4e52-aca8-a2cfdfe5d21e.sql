ALTER TABLE public.quotation_presets ADD COLUMN IF NOT EXISTS sample_paths text[] NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS sample_mimes text[] NOT NULL DEFAULT '{}';

-- backfill arrays from the legacy single columns
UPDATE public.quotation_presets
SET sample_paths = ARRAY[sample_path], sample_mimes = ARRAY[sample_mime]
WHERE sample_path IS NOT NULL AND sample_path <> '' AND cardinality(sample_paths) = 0;
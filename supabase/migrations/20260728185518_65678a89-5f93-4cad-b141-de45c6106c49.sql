ALTER TABLE public.purchase_presets
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT ''::text,
  ADD COLUMN IF NOT EXISTS output_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS output_mimes text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS purchase_presets_category_idx ON public.purchase_presets (category);
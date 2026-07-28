CREATE TABLE public.purchase_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  supplier_hint text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  sample_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  sample_mimes text[] NOT NULL DEFAULT ARRAY[]::text[],
  field_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  output_example jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_presets TO authenticated;
GRANT ALL ON public.purchase_presets TO service_role;

ALTER TABLE public.purchase_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read purchase_presets" ON public.purchase_presets
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth insert purchase_presets" ON public.purchase_presets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update purchase_presets" ON public.purchase_presets
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete purchase_presets" ON public.purchase_presets
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_purchase_presets_updated_at
  BEFORE UPDATE ON public.purchase_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
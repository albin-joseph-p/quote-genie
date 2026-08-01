CREATE TABLE public.quotation_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  sample_path text NOT NULL DEFAULT '',
  sample_mime text NOT NULL DEFAULT '',
  excel_path text NOT NULL DEFAULT '',
  excel_name text NOT NULL DEFAULT '',
  excel_layout text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotation_presets TO authenticated;
GRANT ALL ON public.quotation_presets TO service_role;

ALTER TABLE public.quotation_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read quotation_presets" ON public.quotation_presets FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth insert quotation_presets" ON public.quotation_presets FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update quotation_presets" ON public.quotation_presets FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete quotation_presets" ON public.quotation_presets FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_quotation_presets_updated_at BEFORE UPDATE ON public.quotation_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
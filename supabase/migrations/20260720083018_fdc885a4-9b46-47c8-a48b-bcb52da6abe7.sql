CREATE TABLE public.category_defaults (
  category TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_defaults TO authenticated;
GRANT ALL ON public.category_defaults TO service_role;
ALTER TABLE public.category_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read category defaults" ON public.category_defaults FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert category defaults" ON public.category_defaults FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update category defaults" ON public.category_defaults FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete category defaults" ON public.category_defaults FOR DELETE TO authenticated USING (true);
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_category_defaults_updated_at BEFORE UPDATE ON public.category_defaults FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
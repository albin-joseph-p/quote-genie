
CREATE TABLE public.inventory (
  item_code TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT,
  retail_price NUMERIC NOT NULL DEFAULT 0,
  contractor_price NUMERIC NOT NULL DEFAULT 0,
  wholesale_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO anon, authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read inventory" ON public.inventory FOR SELECT USING (true);
CREATE POLICY "public write inventory" ON public.inventory FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_term TEXT NOT NULL,
  item_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.synonyms TO anon, authenticated;
GRANT ALL ON public.synonyms TO service_role;
ALTER TABLE public.synonyms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read synonyms" ON public.synonyms FOR SELECT USING (true);
CREATE POLICY "public write synonyms" ON public.synonyms FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_synonyms_term ON public.synonyms (lower(customer_term));

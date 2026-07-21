
CREATE TABLE public.purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_name text NOT NULL DEFAULT '',
  invoice_number text NOT NULL DEFAULT '',
  invoice_date text NOT NULL DEFAULT '',
  item_count integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  image_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view purchases"
  ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert purchases"
  ON public.purchases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update purchases"
  ON public.purchases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete purchases"
  ON public.purchases FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_purchases_updated_at
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

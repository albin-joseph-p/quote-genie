
-- Inventory: drop price columns, add brand
ALTER TABLE public.inventory DROP COLUMN IF EXISTS retail_price;
ALTER TABLE public.inventory DROP COLUMN IF EXISTS contractor_price;
ALTER TABLE public.inventory DROP COLUMN IF EXISTS wholesale_price;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT '';

-- Categories table
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "public write categories" ON public.categories FOR ALL USING (true) WITH CHECK (true);

-- Brands table (per category)
CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO anon, authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read brands" ON public.brands FOR SELECT USING (true);
CREATE POLICY "public write brands" ON public.brands FOR ALL USING (true) WITH CHECK (true);

-- Seed categories from existing distinct inventory categories
INSERT INTO public.categories (name)
SELECT DISTINCT category FROM public.inventory
WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (name) DO NOTHING;

-- Tighten RLS: only authenticated users can access app data (was public/anon).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['inventory','synonyms','categories','brands','quotations','ai_instructions'])
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Drop old public policies and replace with authenticated-only
DROP POLICY IF EXISTS "public read inventory" ON public.inventory;
DROP POLICY IF EXISTS "public write inventory" ON public.inventory;
CREATE POLICY "auth read inventory" ON public.inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write inventory" ON public.inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read synonyms" ON public.synonyms;
DROP POLICY IF EXISTS "public write synonyms" ON public.synonyms;
CREATE POLICY "auth read synonyms" ON public.synonyms FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write synonyms" ON public.synonyms FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read categories" ON public.categories;
DROP POLICY IF EXISTS "public write categories" ON public.categories;
CREATE POLICY "auth read categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write categories" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read brands" ON public.brands;
DROP POLICY IF EXISTS "public write brands" ON public.brands;
CREATE POLICY "auth read brands" ON public.brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write brands" ON public.brands FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read quotations" ON public.quotations;
DROP POLICY IF EXISTS "public write quotations" ON public.quotations;
CREATE POLICY "auth read quotations" ON public.quotations FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write quotations" ON public.quotations FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read ai_instructions" ON public.ai_instructions;
DROP POLICY IF EXISTS "public write ai_instructions" ON public.ai_instructions;
CREATE POLICY "auth read ai_instructions" ON public.ai_instructions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write ai_instructions" ON public.ai_instructions FOR ALL TO authenticated USING (true) WITH CHECK (true);
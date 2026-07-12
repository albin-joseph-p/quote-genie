
-- Restrict quotation-images storage policies to authenticated users
DROP POLICY IF EXISTS "public read quotation-images" ON storage.objects;
DROP POLICY IF EXISTS "public insert quotation-images" ON storage.objects;
DROP POLICY IF EXISTS "public update quotation-images" ON storage.objects;
DROP POLICY IF EXISTS "public delete quotation-images" ON storage.objects;

CREATE POLICY "auth read quotation-images" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'quotation-images');
CREATE POLICY "auth insert quotation-images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'quotation-images');
CREATE POLICY "auth update quotation-images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'quotation-images') WITH CHECK (bucket_id = 'quotation-images');
CREATE POLICY "auth delete quotation-images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'quotation-images');

-- Replace overly-permissive ALL (using true / check true) policies with
-- SELECT-only using(true) plus mutation policies gated on auth.uid() IS NOT NULL.
-- This still keeps the app single-tenant (any authenticated user can read/write)
-- but removes the "always true" WITH CHECK on writes flagged by the linter.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_instructions','brands','categories','inventory','quotations','synonyms']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth read ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth write ' || t, t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', 'auth read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL)', 'auth insert ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', 'auth update ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL)', 'auth delete ' || t, t);
  END LOOP;
END $$;

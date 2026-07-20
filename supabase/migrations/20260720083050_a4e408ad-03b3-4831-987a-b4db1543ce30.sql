DROP POLICY IF EXISTS "Authenticated can insert category defaults" ON public.category_defaults;
DROP POLICY IF EXISTS "Authenticated can update category defaults" ON public.category_defaults;
DROP POLICY IF EXISTS "Authenticated can delete category defaults" ON public.category_defaults;
CREATE POLICY "Authenticated can insert category defaults" ON public.category_defaults FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update category defaults" ON public.category_defaults FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete category defaults" ON public.category_defaults FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
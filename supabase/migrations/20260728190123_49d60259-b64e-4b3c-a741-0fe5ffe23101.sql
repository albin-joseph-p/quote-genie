DROP POLICY IF EXISTS "Authenticated users can insert purchases" ON public.purchases;
DROP POLICY IF EXISTS "Authenticated users can update purchases" ON public.purchases;
DROP POLICY IF EXISTS "Authenticated users can delete purchases" ON public.purchases;

CREATE POLICY "Authenticated users can insert purchases"
ON public.purchases FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update purchases"
ON public.purchases FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete purchases"
ON public.purchases FOR DELETE TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Authenticated can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Authenticated can delete suppliers" ON public.suppliers;

CREATE POLICY "Authenticated can insert suppliers"
ON public.suppliers FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update suppliers"
ON public.suppliers FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can delete suppliers"
ON public.suppliers FOR DELETE TO authenticated
USING (auth.uid() IS NOT NULL);
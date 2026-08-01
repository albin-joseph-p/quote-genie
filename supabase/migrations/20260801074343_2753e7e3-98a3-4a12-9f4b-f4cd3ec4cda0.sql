CREATE TABLE public.measurement_conversions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  input_unit text NOT NULL,
  mm_value numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX measurement_conversions_input_unit_key ON public.measurement_conversions (lower(btrim(input_unit)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_conversions TO authenticated;
GRANT ALL ON public.measurement_conversions TO service_role;

ALTER TABLE public.measurement_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read measurement_conversions" ON public.measurement_conversions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert measurement_conversions" ON public.measurement_conversions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update measurement_conversions" ON public.measurement_conversions FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete measurement_conversions" ON public.measurement_conversions FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_measurement_conversions_updated_at BEFORE UPDATE ON public.measurement_conversions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
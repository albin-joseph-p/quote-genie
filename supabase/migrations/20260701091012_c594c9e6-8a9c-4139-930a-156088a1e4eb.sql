
CREATE TABLE public.quotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO anon, authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read quotations" ON public.quotations FOR SELECT USING (true);
CREATE POLICY "public write quotations" ON public.quotations FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX quotations_created_at_idx ON public.quotations (created_at DESC);
CREATE INDEX quotations_customer_name_idx ON public.quotations (customer_name);

CREATE TABLE public.ai_instructions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instructions TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_instructions TO anon, authenticated;
GRANT ALL ON public.ai_instructions TO service_role;
ALTER TABLE public.ai_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read ai_instructions" ON public.ai_instructions FOR SELECT USING (true);
CREATE POLICY "public write ai_instructions" ON public.ai_instructions FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.ai_instructions (instructions) VALUES ('');

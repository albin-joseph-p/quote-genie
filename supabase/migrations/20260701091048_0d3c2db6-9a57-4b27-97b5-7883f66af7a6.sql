
CREATE POLICY "public read quotation-images" ON storage.objects FOR SELECT USING (bucket_id = 'quotation-images');
CREATE POLICY "public insert quotation-images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'quotation-images');
CREATE POLICY "public update quotation-images" ON storage.objects FOR UPDATE USING (bucket_id = 'quotation-images') WITH CHECK (bucket_id = 'quotation-images');
CREATE POLICY "public delete quotation-images" ON storage.objects FOR DELETE USING (bucket_id = 'quotation-images');

-- Video reviews (YouTube) and shop events, each with per-locale text columns.

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.video_reviews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    title text NOT NULL,
    title_nl text,
    title_fr text,
    title_de text,
    title_es text,
    title_it text,
    title_pl text,
    title_cs text,
    title_da text,
    title_pt text,
    title_no text,
    title_sv text,
    title_uk text,
    title_ar text,
    title_bg text,
    reviewer text,
    youtube_id text NOT NULL,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    name_nl text,
    name_fr text,
    name_de text,
    name_es text,
    name_it text,
    name_pl text,
    name_cs text,
    name_da text,
    name_pt text,
    name_no text,
    name_sv text,
    name_uk text,
    name_ar text,
    name_bg text,
    location text NOT NULL,
    date_info text,
    date_info_nl text,
    date_info_fr text,
    date_info_de text,
    date_info_es text,
    date_info_it text,
    date_info_pl text,
    date_info_cs text,
    date_info_da text,
    date_info_pt text,
    date_info_no text,
    date_info_sv text,
    date_info_uk text,
    date_info_ar text,
    date_info_bg text,
    website_url text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.video_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_events ENABLE ROW LEVEL SECURITY;

-- 3. Setup Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_video_reviews_updated_at ON public.video_reviews;
CREATE TRIGGER update_video_reviews_updated_at BEFORE UPDATE ON public.video_reviews FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_shop_events_updated_at ON public.shop_events;
CREATE TRIGGER update_shop_events_updated_at BEFORE UPDATE ON public.shop_events FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 4. RLS policies: public reads active rows, the shop owner manages everything
DROP POLICY IF EXISTS "Allow public read access on video_reviews" ON public.video_reviews;
CREATE POLICY "Allow public read access on video_reviews" ON public.video_reviews FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Allow public read access on shop_events" ON public.shop_events;
CREATE POLICY "Allow public read access on shop_events" ON public.shop_events FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Allow admin all access on video_reviews" ON public.video_reviews;
CREATE POLICY "Allow admin all access on video_reviews" ON public.video_reviews
    FOR ALL USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

DROP POLICY IF EXISTS "Allow admin all access on shop_events" ON public.shop_events;
CREATE POLICY "Allow admin all access on shop_events" ON public.shop_events
    FOR ALL USING (public.is_shop_owner()) WITH CHECK (public.is_shop_owner());

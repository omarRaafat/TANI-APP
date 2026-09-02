-- ═══════════════════════════════════════════════════════════
--  تاني — إعداد Supabase
--  شغّل الملف ده كله مرة واحدة في SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ── ١) جدول الإعلانات ──────────────────────────────────────
create table if not exists public.listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references auth.users(id) on delete cascade,

  title        text not null check (char_length(title) between 8 and 120),
  category     text not null check (category in
                 ('furniture','appliance','phones','computers','kids','bikes','books','tools')),
  condition    text not null check (condition in ('new','good','used')),

  price        integer not null check (price > 0 and price < 100000000),
  was_price    integer check (was_price is null or was_price > 0),

  city         text not null,
  market       text not null check (market in ('EG','SA')),

  seller_name  text not null check (char_length(seller_name) between 2 and 40),
  seller_phone text not null check (char_length(seller_phone) between 8 and 20),

  description  text check (description is null or char_length(description) <= 2000),
  photos       text[] not null default '{}',

  status       text not null default 'live' check (status in ('live','sold','hidden')),
  created_at   timestamptz not null default now()
);

-- فهارس للفلترة والترتيب
create index if not exists listings_market_created_idx
  on public.listings (market, created_at desc) where status = 'live';
create index if not exists listings_category_idx on public.listings (category);
create index if not exists listings_city_idx     on public.listings (city);
create index if not exists listings_seller_idx   on public.listings (seller_id);

-- بحث نصي على العنوان والوصف
create index if not exists listings_search_idx
  on public.listings using gin (to_tsvector('simple', title || ' ' || coalesce(description,'')));


-- ── ٢) صلاحيات الصفوف (RLS) ────────────────────────────────
alter table public.listings enable row level security;

-- أي حد يقدر يقرا الإعلانات المنشورة
drop policy if exists "read live listings" on public.listings;
create policy "read live listings"
  on public.listings for select
  using (status = 'live' or auth.uid() = seller_id);

-- المستخدم يضيف إعلان باسمه هو بس
drop policy if exists "insert own listing" on public.listings;
create policy "insert own listing"
  on public.listings for insert
  with check (auth.uid() = seller_id);

-- ويعدّل ويمسح إعلانه هو بس
drop policy if exists "update own listing" on public.listings;
create policy "update own listing"
  on public.listings for update
  using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

drop policy if exists "delete own listing" on public.listings;
create policy "delete own listing"
  on public.listings for delete
  using (auth.uid() = seller_id);


-- ── ٣) حد أقصى للإعلانات لكل مستخدم (مكافحة سبام) ─────────
create or replace function public.check_listing_quota()
returns trigger language plpgsql security definer as $$
declare n integer;
begin
  select count(*) into n
    from public.listings
   where seller_id = new.seller_id and status = 'live';
  if n >= 25 then
    raise exception 'وصلت للحد الأقصى: ٢٥ إعلان منشور';
  end if;
  return new;
end $$;

drop trigger if exists listing_quota on public.listings;
create trigger listing_quota
  before insert on public.listings
  for each row execute function public.check_listing_quota();


-- ── ٤) تخزين الصور ─────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 3145728,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- أي حد يشوف الصور
drop policy if exists "public read photos" on storage.objects;
create policy "public read photos"
  on storage.objects for select
  using (bucket_id = 'listing-photos');

-- كل مستخدم يرفع جوه فولدر باسم الـ uid بتاعه فقط
drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ── ٥) بث التحديثات الحية ──────────────────────────────────
alter publication supabase_realtime add table public.listings;


-- ── ٦) توثيق البايع (OTP) ──────────────────────────────────
alter table public.listings
  add column if not exists seller_verified boolean not null default false;

-- منع النشر من غير توثيق، وختم حالة التوثيق من auth.users
-- (بيتنفذ على السيرفر — العميل مش بيقدر يتحايل عليه)
create or replace function public.enforce_verified_seller()
returns trigger language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select (u.phone is not null and u.phone_confirmed_at is not null)
      or (u.email is not null and u.email_confirmed_at is not null)
    into ok
  from auth.users u
  where u.id = new.seller_id;

  if not coalesce(ok, false) then
    raise exception 'لازم توثّق رقمك أو إيميلك قبل ما تنشر إعلان'
      using errcode = 'P0001';
  end if;

  new.seller_verified := true;
  return new;
end $$;

drop trigger if exists verified_seller on public.listings;
create trigger verified_seller
  before insert on public.listings
  for each row execute function public.enforce_verified_seller();


-- ── ٧) تنضيف صور الإعلان المحذوف ──────────────────────────
create or replace function public.purge_listing_photos()
returns trigger language plpgsql security definer set search_path = public as $$
declare u text; key text;
begin
  foreach u in array coalesce(old.photos, '{}') loop
    key := substring(u from '/listing-photos/(.*)$');
    if key is not null then
      delete from storage.objects
       where bucket_id = 'listing-photos' and name = key;
    end if;
  end loop;
  return old;
end $$;

drop trigger if exists purge_photos on public.listings;
create trigger purge_photos
  after delete on public.listings
  for each row execute function public.purge_listing_photos();


-- ═══════════════════════════════════════════════════════════
--  خطوات يدوية مطلوبة في لوحة التحكم:
--
--  ١) Authentication → Sign In / Providers → Anonymous sign-ins → Enable
--     (عشان المستخدم يتصفح قبل ما يوثّق)
--
--  ٢) Authentication → Sign In / Providers → Phone → Enable
--     واختار مزوّد SMS (Twilio أو MessageBird أو Vonage أو Textlocal)
--     وحط بياناته. Supabase مش بيبعت SMS بنفسه.
--
--  ٣) Authentication → Sign In / Providers → Email → Enable
--     (قناة احتياطية، وبتشتغل مجاناً من غير أي مزوّد)
--
--  ٤) Authentication → Rate Limits → اضبط حد إرسال الـ OTP
--     المقترح: ٥ رسايل للرقم في الساعة
-- ═══════════════════════════════════════════════════════════

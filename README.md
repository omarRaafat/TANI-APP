# تاني · Tani

**سوق للحاجات المستعملة في مصر والسعودية — كل الإعلانات من الناس نفسها.**

A secondhand marketplace for Egypt and Saudi Arabia. Every listing is user-generated: sellers post what they no longer need, buyers find working items at a fraction of retail. Arabic-first, RTL throughout, built as static HTML with a Supabase backend.

---

## Why this exists

Classifieds in the region are either bloated apps or Facebook groups with no structure, no photos discipline, and no buyer protection. Tani is a focused alternative: a clean listing flow, real photos, honest condition labels, and a checkout that works with how people actually pay and receive goods here — cash on delivery and mobile wallets.

---

## Features

**Marketplace**
- User-generated listings only — the site ships with zero seeded inventory
- Live search across title, description, category and city
- Filters: category, condition, city, max price, sort by newest / cheapest / biggest discount
- Removable filter chips showing exactly what's applied
- Favorites, listing detail modal with photo gallery
- Realtime updates — a new listing appears without a refresh
- Dual market: Egypt (ج.م) and Saudi Arabia (ر.س), each with its own city list and currency; mixed-currency carts are blocked

**Posting a listing**
- Live preview that builds as the seller types
- Client-side image resize to 1400px + JPEG compression before upload
- Price guidance derived from category and condition
- Full validation with inline Arabic error messages

**Seller verification (OTP)**
- Visitors browse anonymously; verification is required only at publish time
- Phone or email OTP
- Uses `updateUser()` rather than `signInWithOtp()`, so the anonymous account is **upgraded in place** — the `uid` is preserved and earlier listings stay linked to the seller
- Phone normalisation for both markets, including Arabic-Indic digits:
  `٠١٠٦٦٣٤٣٦٨٨` → `+201066343688`, `٠٥٠١٢٣٤٥٦٧` → `+966501234567`
- Malformed numbers are rejected client-side before an SMS is spent
- Enforced server-side by a Postgres trigger — calling the API directly does not bypass it

**Checkout**
- Interactive map pin (Leaflet + OpenStreetMap) so the courier gets real coordinates
- Address geocoding tuned for Egyptian addresses: the text is parsed into landmark / street / district, then resolved through a local dictionary of ~145 Egyptian areas with Arabic fuzzy matching (Levenshtein + Arabic normalisation), falling back to Photon and Nominatim bounded to the resolved district
- One-tap GPS capture
- Accuracy radius drawn on the map so the buyer knows how approximate the pin is
- Cash on delivery, or mobile wallet with a required transfer-screenshot upload

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla JS, no build step | Three static files, deployable anywhere |
| Database | Supabase (Postgres) | RLS gives real per-row authorization |
| Auth | Supabase anonymous → phone/email OTP | Browse first, verify only when publishing |
| Storage | Supabase Storage | Photos as files, not base64 |
| Maps | Leaflet + OpenStreetMap | No API key, no billing |
| Geocoding | Local dictionary → Photon → Nominatim | OSM alone is weak on Egyptian street addresses |
| Fonts | Changa + Tajawal | Arabic display and text pairing |

No framework, no bundler, no `node_modules`.

---

## Getting started

```bash
git clone https://github.com/<you>/tani.git
cd tani
```

1. Create a project at [supabase.com](https://supabase.com) — pick `eu-central` or `me-central`.
2. Open **SQL Editor**, paste all of `supabase-setup.sql`, run it.
3. In **Authentication → Sign In / Providers**, enable **Anonymous**, **Email**, and **Phone**.
   Phone OTP needs an SMS provider (Unifonic, Twilio, MessageBird, Vonage) configured in the dashboard — Supabase does not send SMS itself. Email OTP works immediately with no provider.
4. Paste your project URL and `anon` key into the top of `tani-supabase.js`.
5. Serve the folder — any static host works.

```bash
python3 -m http.server 8000
```

Full walkthrough, including SMS provider notes for Egypt and Saudi Arabia, is in [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md).

**Running without Supabase:** leave the config untouched and the data layer falls back to `localStorage`, so the whole UI is explorable offline. Listings are then per-browser and are not shared.

---

## Project structure

```
index.html            marketplace, listing composer, OTP modal
cart.html             cart — one-of-a-kind items, no quantity stepper
checkout.html         address + map + payment + receipt upload
tani-supabase.js      data layer: listings, photos, auth, realtime, local fallback
supabase-setup.sql    schema, RLS policies, triggers, storage bucket
SUPABASE-SETUP.md     setup guide and operational notes
```

All data access is isolated in `tani-supabase.js`. Pages read from an in-memory cache it maintains, which is why the render functions stay synchronous.

---

## Security model

Authorization lives in the database, not the client:

- `select` is public for `status = 'live'`; sellers additionally see their own
- `insert` requires `auth.uid() = seller_id`
- `update` / `delete` are restricted to the owning seller
- Storage policy pins uploads to a folder named after the user's `uid`
- A trigger rejects inserts from unverified accounts and stamps `seller_verified`
- A trigger caps each seller at 25 live listings
- A trigger deletes a listing's photos from Storage when the listing is removed
- Column constraints on title length, price range, category and condition

The `anon` key is meant to be public — it is shipped to the browser by design. Never put a `service_role` key in this repo.

---

## Known limitations

These are real gaps, not oversights to discover later:

- **Orders are not persisted.** Checkout computes and displays an order, but nothing is written to the database. An `orders` table and a submit handler are the natural next step.
- **The wallet transfer screenshot is never uploaded.** It is read and previewed in the browser only. The file sits in `receiptFile`, ready to be sent once an endpoint exists.
- **No admin review.** The UI promises manual moderation; implementing it means defaulting `status` to `pending` and building an admin view.
- **Seller phone numbers are readable by anyone** who queries the table. If that matters, expose a public view without the column and serve the number through an RPC after an order is placed.
- **Text-to-coordinates accuracy caps at street level in Egypt.** This is a data problem, not a code one — buildings are not indexed in any map provider here. The GPS button remains the accurate path.
- **Cart and favorites are local** to each browser.
- **Placeholder legal details.** Commercial registration and tax numbers in the footer are dummy values.

---

## Roadmap

- [ ] `orders` table and checkout submission
- [ ] Receipt upload to Storage
- [ ] Admin moderation queue
- [ ] Seller profiles and ratings
- [ ] Saved searches with notifications
- [ ] Arabic full-text search using the existing GIN index

---

## Contributing

Issues and pull requests are welcome. The codebase deliberately avoids a build step — please keep changes to plain HTML, CSS and ES5-compatible JavaScript so the files stay directly editable and deployable.

---

## License

Add a license file before publishing. MIT is a reasonable default for this kind of project.

# Bantay Kalye

Volunteers tracking and feeding stray dogs and cats across Metro Manila, with printable QR collar tags and adoption posts from partner shelters.

- **Volunteers** report animals with a photo, log feedings, and see who is hungry on the feeding rounds.
- **Anyone who scans a collar tag** sees the animal's public page: photo, name, area, whether it's approachable, and the shelter's contact if it's up for adoption.
- **Shelters and rescues** register, get verified by an organizer, and post animals for adoption.
- **Organizers (admins)** approve new volunteers and verify shelters.

## Who sees what

| | Public (QR scan) | Signed up, not approved | Approved volunteer | Admin |
|---|---|---|---|---|
| Photo, name, species, markings, city, approachability, status | ✓ | ✓ | ✓ | ✓ |
| Adoption bio + shelter contact (verified shelters only) | ✓ | ✓ | ✓ | ✓ |
| Barangay / landmark, map pin, feeding log, volunteer notes | | | ✓ | ✓ |
| Report animals, log feedings, register a shelter | | | ✓ | ✓ |
| Approve volunteers, verify shelters, delete anything | | | | ✓ |

Exact locations stay private so a QR scan can't lead someone with bad intentions to an animal's feeding spot. This is enforced in the database (row-level security), not just hidden in the app. Photos are re-encoded on the phone before upload, which also strips the camera's GPS data.

## Stack and cost

- **Supabase**: database, sign-in, photo storage. Free plan for testing; **upgrade to Pro ($25/month) before tags go on collars**, because free projects pause after a week without activity and paused projects make every QR scan fail.
- **Cloudflare Pages**: hosts the site. Free.
- **Email sending** (Resend or similar): needed for sign-in emails. Free tier is enough to start.
- **Domain** (optional but recommended): ~$10–50/year.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com). Pick the **Singapore** region (closest to Manila).
2. Open **SQL Editor**, paste all of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and click **Run**.
3. Open **Project Settings → API** (or the **Connect** button) and copy:
   - the **Project URL**
   - the **anon / publishable** key. Never use the `service_role` / secret key in this app.

### 2. Sign-in emails

Supabase's built-in email only delivers to members of your Supabase team, at about 2 emails an hour, so volunteers can't sign in until you add your own email sender.

1. Create a free account with an email provider such as [Resend](https://resend.com) and verify a sending domain (or use their test domain to start).
2. In Supabase: **Authentication → Emails → SMTP Settings**, turn on custom SMTP and paste the provider's SMTP host, port, username and password.
3. Optional: **Authentication → Emails → Templates → Magic Link**, change the subject to something like "Your Bantay Kalye sign-in link".

### 3. Deploy on Cloudflare Pages

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, choose `nixpad/bantay-kalye`.
2. Build settings:
   - Framework preset: **Vite** (or none)
   - Build command: `npm run build`
   - Output directory: `dist`
3. Environment variables (Production):
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
   - `VITE_CONTACT` = a phone number or Facebook page shown on public pages ("If they look hurt, message us")
   - `VITE_PUBLIC_URL` = leave empty until you have a domain (see step 5)
4. Deploy. You'll get an address like `bantay-kalye.pages.dev`.

### 4. Point Supabase sign-in at your site

In Supabase: **Authentication → URL Configuration**

- **Site URL**: `https://bantay-kalye.pages.dev` (or your domain)
- **Redirect URLs**: add `https://bantay-kalye.pages.dev/**` and, for local testing, `http://localhost:5173/**`

### 5. Make yourself the first admin

1. Open the site, tap **Sign in**, and sign in with your email.
2. In Supabase **SQL Editor**, run (with your email):

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

3. Reload the site. You'll see **Admin** in the header, where you approve everyone else.

### 6. Before printing tags

QR codes contain the site address. If you'll move to your own domain, do it **before** printing:

1. Add the domain in Cloudflare Pages → **Custom domains**.
2. Set `VITE_PUBLIC_URL=https://your-domain` and redeploy.
3. Add the domain to Supabase's Site URL and Redirect URLs.
4. Upgrade Supabase to Pro.

Tags printed with a `pages.dev` address keep working as long as that Cloudflare project exists, since it stays live alongside a custom domain.

### Optional: Google sign-in

Enable Google in **Supabase → Authentication → Providers** (it walks you through creating the Google OAuth client), then set `VITE_GOOGLE_SIGNIN=true` in Cloudflare and redeploy.

## Using it

- **Report**: take a photo, pick dog or cat, how approachable they are, city and landmark. "Use my current location" pins the exact spot (volunteers only).
- **Feeding**: tap **Fed** on the feeding rounds, or log food and notes on the animal's page.
- **Collar tags**: download a single tag from an animal's page, or open **Print collar tags** to print several on A4 at 3 × 4.5 cm with cut lines. Laminate and thread the collar through the circle.
- **Shelters**: register under Shelters. After an admin verifies it, members can post animals for adoption; the adoption bio and contact become public.

## Local development

```bash
cp .env.example .env    # fill in your Supabase URL and anon key
npm install
npm run dev             # http://localhost:5173
```

## Project layout

```
index.html                 app shell
src/main.js                routing and all screens
src/style.css              design tokens and styles (light + dark)
src/lib/supabase.js        Supabase client and settings
src/lib/photos.js          on-phone photo resizing
src/lib/tag.js             QR collar tag rendering
src/lib/util.js            labels, formatting, helpers
public/                    icons, manifest, Cloudflare _redirects and _headers
supabase/migrations/       database schema and security rules
```

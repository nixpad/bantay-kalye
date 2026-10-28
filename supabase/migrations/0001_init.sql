-- Bantay Kalye: initial schema
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Who sees what
--   Public (anyone who scans a collar)  -> public_animals / public_orgs views:
--       photo, name, species, sex, markings, city, approachability, status, shelter + contact.
--       Adoption bios are public only for animals a shelter posted.
--   Pending sign-ups                     -> the same public data, plus their own profile.
--   Approved volunteers                  -> everything: landmarks, map pins, feeding logs.
--   Admins                               -> approve volunteers, verify shelters, delete records.

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  role         text not null default 'pending'
               check (role in ('pending', 'volunteer', 'admin', 'blocked')),
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1),
      ''
    ), 60)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_volunteer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('volunteer', 'admin')
  )
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  )
$$;

alter table public.profiles enable row level security;

create policy "read own profile or any if volunteer" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_volunteer());

create policy "edit own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- People may change their display name, never their role.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Tag codes: 6 characters, no look-alikes (0/O, 1/I/L)
-- ---------------------------------------------------------------------------
create or replace function public.gen_code(tbl text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
  taken boolean;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    execute format('select exists (select 1 from %s where id = $1)', tbl) into taken using candidate;
    exit when not taken;
  end loop;
  return candidate;
end $$;

-- ---------------------------------------------------------------------------
-- Shelters, rescues, clinics
-- ---------------------------------------------------------------------------
create table public.orgs (
  id         text primary key default public.gen_code('public.orgs'),
  name       text not null check (char_length(name) between 2 and 80),
  type       text not null default 'shelter' check (type in ('shelter', 'rescue', 'clinic')),
  city       text not null default '' check (char_length(city) <= 40),
  contact    text not null default '' check (char_length(contact) <= 160),
  about      text not null default '' check (char_length(about) <= 800),
  verified   boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id  text not null references public.orgs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (org_id, user_id)
);

create or replace function public.is_org_member(org text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members where org_id = org and user_id = auth.uid()
  )
$$;

-- Whoever registers an organization manages it.
create or replace function public.add_org_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    insert into public.org_members (org_id, user_id) values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger orgs_add_creator after insert on public.orgs
  for each row execute function public.add_org_creator();

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

create policy "volunteers read all orgs" on public.orgs
  for select to authenticated using (public.is_volunteer());

create policy "volunteers register orgs" on public.orgs
  for insert to authenticated
  with check (public.is_volunteer() and created_by = auth.uid() and verified = false);

create policy "members or admins edit org" on public.orgs
  for update to authenticated
  using (public.is_org_member(id) or public.is_admin())
  with check (public.is_org_member(id) or public.is_admin());

create policy "admins delete orgs" on public.orgs
  for delete to authenticated using (public.is_admin());

revoke insert, update, delete on public.orgs from anon, authenticated;
grant insert (name, type, city, contact, about) on public.orgs to authenticated;
grant update (name, type, city, contact, about) on public.orgs to authenticated;
grant delete on public.orgs to authenticated;

create policy "volunteers read memberships" on public.org_members
  for select to authenticated using (public.is_volunteer());
revoke insert, update, delete on public.org_members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Animals
-- ---------------------------------------------------------------------------
create table public.animals (
  id          text primary key default public.gen_code('public.animals'),
  name        text not null default '' check (char_length(name) <= 40),
  species     text not null default 'dog' check (species in ('dog', 'cat')),
  sex         text not null default '' check (sex in ('', 'male', 'female')),
  temper      text not null default 'unknown'
              check (temper in ('friendly', 'cautious', 'avoid', 'unknown')),
  color       text not null default '' check (char_length(color) <= 80),
  city        text not null default '' check (char_length(city) <= 40),
  status      text not null default 'street'
              check (status in ('street', 'care', 'adopt', 'shelter', 'adopted')),
  org_id      text references public.orgs (id) on delete set null,
  notes       text not null default '' check (char_length(notes) <= 800),
  photo_path  text,
  thumb_path  text,
  -- volunteer-only details
  landmark    text not null default '' check (char_length(landmark) <= 120),
  map_url     text not null default '' check (map_url = '' or (map_url ~ '^https://' and char_length(map_url) <= 300)),
  last_fed_at timestamptz,
  last_fed_by uuid references public.profiles (id) on delete set null,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index animals_city_idx on public.animals (city);
create index animals_org_idx on public.animals (org_id);

-- Only members (or admins) can attach an animal to an organization.
create or replace function public.animals_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.org_id is not null
     and (tg_op = 'INSERT' or new.org_id is distinct from old.org_id)
     and not (public.is_org_member(new.org_id) or public.is_admin()) then
    raise exception 'Only members of this organization can post animals for it'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger animals_guard before insert or update on public.animals
  for each row execute function public.animals_guard();

alter table public.animals enable row level security;

create policy "volunteers read animals" on public.animals
  for select to authenticated using (public.is_volunteer());

create policy "volunteers add animals" on public.animals
  for insert to authenticated
  with check (public.is_volunteer() and created_by = auth.uid());

create policy "volunteers update animals" on public.animals
  for update to authenticated
  using (public.is_volunteer()) with check (public.is_volunteer());

create policy "admins or reporters delete animals" on public.animals
  for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and public.is_volunteer()));

revoke insert, update, delete on public.animals from anon, authenticated;
grant insert (name, species, sex, temper, color, city, status, org_id, notes,
              photo_path, thumb_path, landmark, map_url)
  on public.animals to authenticated;
grant update (name, species, sex, temper, color, city, status, org_id, notes,
              photo_path, thumb_path, landmark, map_url)
  on public.animals to authenticated;
grant delete on public.animals to authenticated;

-- ---------------------------------------------------------------------------
-- Feeding log
-- ---------------------------------------------------------------------------
create table public.feedings (
  id        bigint generated always as identity primary key,
  animal_id text not null references public.animals (id) on delete cascade,
  fed_by    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  fed_at    timestamptz not null default now(),
  food      text not null default '' check (char_length(food) <= 80),
  note      text not null default '' check (char_length(note) <= 200)
);

create index feedings_animal_idx on public.feedings (animal_id, fed_at desc);

create or replace function public.feedings_touch_animal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.animals
     set last_fed_at = new.fed_at, last_fed_by = new.fed_by
   where id = new.animal_id
     and (last_fed_at is null or last_fed_at < new.fed_at);
  return new;
end $$;

create trigger feedings_touch_animal after insert on public.feedings
  for each row execute function public.feedings_touch_animal();

alter table public.feedings enable row level security;

create policy "volunteers read feedings" on public.feedings
  for select to authenticated using (public.is_volunteer());

create policy "volunteers log feedings" on public.feedings
  for insert to authenticated
  with check (public.is_volunteer() and fed_by = auth.uid()
              and fed_at <= now() + interval '5 minutes');

create policy "own or admin delete feedings" on public.feedings
  for delete to authenticated
  using (fed_by = auth.uid() or public.is_admin());

revoke insert, update, delete on public.feedings from anon, authenticated;
grant insert (animal_id, food, note) on public.feedings to authenticated;
grant delete on public.feedings to authenticated;

-- Explicit read grants (row-level security above still decides which rows).
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.orgs, public.org_members,
                public.animals, public.feedings to authenticated;
grant usage on sequence public.feedings_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Public views (what a QR scan shows). These run as their owner on purpose,
-- so they expose only the columns listed here and nothing else.
-- ---------------------------------------------------------------------------
create view public.public_orgs as
  select id, name, type, city, contact, about
  from public.orgs
  where verified;

create view public.public_animals as
  select a.id, a.name, a.species, a.sex, a.temper, a.color, a.city, a.status,
         case when o.id is not null then a.org_id end as org_id,
         case when o.id is not null then a.notes else '' end as bio,
         a.photo_path, a.thumb_path, a.created_at
  from public.animals a
  left join public.orgs o on o.id = a.org_id and o.verified;

revoke all on public.public_orgs, public.public_animals from anon, authenticated;
grant select on public.public_orgs, public.public_animals to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_people()
returns table (id uuid, email text, display_name text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.display_name, p.role, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    order by (p.role = 'pending') desc, p.created_at desc;
end $$;

create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if target = auth.uid() then
    raise exception 'You can''t change your own role' using errcode = '42501';
  end if;
  if new_role not in ('pending', 'volunteer', 'admin', 'blocked') then
    raise exception 'Unknown role %', new_role using errcode = '22023';
  end if;
  update public.profiles set role = new_role where id = target;
end $$;

create or replace function public.admin_verify_org(org text, is_verified boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.orgs set verified = is_verified where id = org;
end $$;

create or replace function public.admin_set_org_member(org text, member uuid, is_member boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or public.is_org_member(org)) then
    raise exception 'Only admins or members of this organization can change its members'
      using errcode = '42501';
  end if;
  if is_member then
    insert into public.org_members (org_id, user_id) values (org, member) on conflict do nothing;
  else
    delete from public.org_members where org_id = org and user_id = member;
  end if;
end $$;

revoke execute on function public.admin_list_people() from public, anon;
revoke execute on function public.admin_set_role(uuid, text) from public, anon;
revoke execute on function public.admin_verify_org(text, boolean) from public, anon;
revoke execute on function public.admin_set_org_member(text, uuid, boolean) from public, anon;
grant execute on function public.admin_list_people() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_verify_org(text, boolean) to authenticated;
grant execute on function public.admin_set_org_member(text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Photo storage. Photos are re-encoded in the browser before upload, which
-- also strips GPS data from the original camera file.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('animal-photos', 'animal-photos', true, 1048576, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "volunteers read photo objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'animal-photos' and public.is_volunteer());

create policy "volunteers upload photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'animal-photos' and public.is_volunteer());

create policy "volunteers replace photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'animal-photos' and public.is_volunteer());

create policy "admins delete photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'animal-photos' and public.is_admin());

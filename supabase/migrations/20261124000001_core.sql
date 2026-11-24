-- USMODE core schema. Zero-knowledge: every sensitive field is ciphertext + IV
-- produced on the two paired devices. The server only sees counts, flags and
-- timestamps it needs to run the race, the end-of-day handshake and the locks.
--
-- Conventions
--   * Every table carries room_id and is readable only by that room's members.
--   * Writes that need rules (pairing, end of day, kiss catching, unlocking)
--     go through SECURITY DEFINER functions with search_path = ''.
--   * Table privileges are granted column-by-column, so a client can't, for
--     example, flip winner_user_id or seen_at directly.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.status_code as enum ('locked_in', 'decompressing', 'low_battery', 'free', 'in_room');
create type public.cycle_status as enum ('active', 'eod_pending', 'closed');
create type public.room_type as enum ('boast', 'confession', 'vault', 'jam');
create type public.post_tag as enum ('flex', 'roast', 'mutual_reveal');
create type public.kiss_style as enum ('forehead', 'smooch', 'flying', 'attack10');
create type public.join_method as enum ('qr', 'code');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  -- PBKDF2-SHA256(code) lookup half, hex. Cleared the moment the room locks.
  pairing_code_hash text unique check (pairing_code_hash ~ '^[0-9a-f]{64}$'),
  pairing_expires_at timestamptz,
  is_locked boolean not null default false,
  max_members smallint not null default 2 check (max_members = 2),
  join_method public.join_method,
  -- Room key sealed by partner A for partner B (ECDH + code-bound HKDF). Cleared after B confirms.
  key_envelope text,
  key_envelope_iv text,
  -- Room name, pet names, phone numbers, dares, avatars: one encrypted JSON blob.
  encrypted_config text,
  config_iv text,
  theme_seed_hex text not null default '#d0436e' check (theme_seed_hex ~ '^#[0-9a-fA-F]{6}$'),
  backchodi_start_time time not null default '21:00',
  backchodi_tz text not null default 'UTC',
  backchodi_minutes smallint not null default 120 check (backchodi_minutes between 30 and 360),
  vault_early_unlock_at timestamptz,
  cowork_started_at timestamptz,
  cowork_started_by uuid references auth.users (id) on delete set null,
  cowork_focus_min smallint not null default 25 check (cowork_focus_min between 5 and 120),
  cowork_break_min smallint not null default 5 check (cowork_break_min between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((pairing_code_hash is null) = (pairing_expires_at is null)),
  check (not is_locked or pairing_code_hash is null)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  public_key_jwk jsonb not null check (public_key_jwk ? 'x' and public_key_jwk ? 'y' and public_key_jwk ->> 'crv' = 'P-256'),
  battery_level smallint not null default 3 check (battery_level between 1 and 5),
  status_code public.status_code not null default 'free',
  decompression_ends_at timestamptz,
  vault_unlock_requested_at timestamptz,
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  -- One room per account: USMODE is for exactly one couple.
  unique (user_id)
);
create index members_room_idx on public.members (room_id);

create table public.daily_cycles (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  status public.cycle_status not null default 'active',
  eod_proposed_by uuid references auth.users (id) on delete set null,
  eod_proposed_at timestamptz,
  eod_nudged_at timestamptz,
  eod_declined_by uuid references auth.users (id) on delete set null,
  eod_declined_at timestamptz,
  eod_confirmed_at timestamptz,
  winner_user_id uuid references auth.users (id) on delete set null,
  loser_user_id uuid references auth.users (id) on delete set null,
  dare_selected_encrypted text,
  dare_iv text,
  dare_completed_at timestamptz,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (room_id, cycle_number)
);
-- Exactly one open day per room.
create unique index daily_cycles_one_open on public.daily_cycles (room_id) where status <> 'closed';

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  cycle_id uuid not null references public.daily_cycles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  encrypted_title text not null,
  iv text not null,
  is_completed boolean not null default false,
  completed_at timestamptz,
  encrypted_proof_path text,
  created_at timestamptz not null default clock_timestamp()
);
create index tasks_cycle_user_idx on public.tasks (cycle_id, user_id, created_at);
create index tasks_room_idx on public.tasks (room_id);

-- Maintained by trigger from tasks; read-only for clients.
create table public.cycle_scores (
  cycle_id uuid not null references public.daily_cycles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  task_count integer not null default 0,
  completed_count integer not null default 0,
  reached_100_at timestamptz,
  primary key (cycle_id, user_id)
);
create index cycle_scores_room_idx on public.cycle_scores (room_id);

create table public.kisses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  cycle_id uuid references public.daily_cycles (id) on delete set null,
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  trigger_task_id uuid references public.tasks (id) on delete set null,
  kiss_style public.kiss_style not null default 'smooch',
  kiss_count smallint not null default 1,
  encrypted_note text,
  iv text,
  created_at timestamptz not null default now(),
  delivered_to_recipient boolean not null default false,
  seen_at timestamptz,
  check (from_user_id <> to_user_id),
  check ((encrypted_note is null) = (iv is null))
);
create unique index kisses_one_per_task on public.kisses (trigger_task_id, from_user_id) where trigger_task_id is not null;
create index kisses_unseen_idx on public.kisses (to_user_id) where seen_at is null;
create index kisses_room_idx on public.kisses (room_id);

create table public.reveal_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  started_by uuid not null references auth.users (id) on delete cascade,
  submitted_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  revealed_at timestamptz
);
create index reveal_rounds_room_idx on public.reveal_rounds (room_id);

create table public.room_posts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  room_type public.room_type not null,
  tag public.post_tag,
  author_id uuid not null references auth.users (id) on delete cascade,
  encrypted_payload text not null,
  iv text not null,
  encrypted_media_path text,
  reveal_round_id uuid references public.reveal_rounds (id) on delete cascade,
  is_revealed boolean not null default true,
  ephemeral boolean not null default false,
  unlocks_at timestamptz,
  created_at timestamptz not null default now(),
  check (tag is null or (room_type = 'boast' and tag in ('flex', 'roast')) or (room_type = 'confession' and tag = 'mutual_reveal')),
  check ((tag = 'mutual_reveal') = (reveal_round_id is not null)),
  check (not ephemeral or room_type = 'confession')
);
create index room_posts_room_type_idx on public.room_posts (room_id, room_type, created_at desc);
create index room_posts_media_idx on public.room_posts (encrypted_media_path) where encrypted_media_path is not null;
create unique index room_posts_one_per_round on public.room_posts (reveal_round_id, author_id) where reveal_round_id is not null;

create table public.post_reactions (
  post_id uuid not null references public.room_posts (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sticker text not null check (sticker in ('cope', 'show_off', 'beat_you', 'cry', 'fire', 'heart')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, sticker)
);
create index post_reactions_room_idx on public.post_reactions (room_id);

create table public.spotify_sessions (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  jam_url_encrypted text,
  jam_iv text,
  -- Track title/artist/art: encrypted too (stricter than plaintext metadata).
  current_track_encrypted text,
  track_iv text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.pairing_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index pairing_attempts_user_idx on public.pairing_attempts (user_id, attempted_at);

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------
create function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.room_id = p_room and m.user_id = (select auth.uid())
  );
$$;

create function public.my_room_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.room_id from public.members m where m.user_id = (select auth.uid());
$$;

create function public.partner_of(p_room uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id from public.members m where m.room_id = p_room and m.user_id <> p_user limit 1;
$$;

create function public.current_cycle_id(p_room uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.daily_cycles c where c.room_id = p_room and c.status <> 'closed';
$$;

-- Accepts "room-uuid" as text; false for anything that isn't a uuid.
create function public.is_room_member_text(p_room text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_room is null or p_room !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_room_member(p_room::uuid);
end;
$$;

-- When does a vault drop posted at `p_at` unlock? Now, if a window is open;
-- otherwise at the start of the next Backchodi window in the room's time zone.
create function public.vault_unlock_time(p_room uuid, p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  d date;
  s timestamptz;
  shift int;
begin
  select * into r from public.rooms where id = p_room;
  d := (p_at at time zone r.backchodi_tz)::date;
  foreach shift in array array[-1, 0, 1] loop
    s := ((d + shift) + r.backchodi_start_time) at time zone r.backchodi_tz;
    if p_at < s + make_interval(mins => r.backchodi_minutes) then
      return greatest(s, p_at);
    end if;
  end loop;
  return p_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_touch before update on public.rooms
for each row execute function public.touch_updated_at();

create function public.rooms_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.backchodi_tz) then
    raise exception 'Unknown time zone %', new.backchodi_tz using errcode = '22023';
  end if;
  if new.cowork_started_at is not null and new.cowork_started_at > now() + interval '1 minute' then
    raise exception 'Co-work timer can''t start in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger rooms_validate before insert or update on public.rooms
for each row execute function public.rooms_validate();

-- Tasks: only on the open day, completed stays completed, server stamps times.
create function public.tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.daily_cycles;
  n int;
begin
  if tg_op = 'INSERT' then
    select * into c from public.daily_cycles where id = new.cycle_id;
    if c.id is null or c.room_id <> new.room_id then
      raise exception 'Task must belong to this room''s day' using errcode = '22023';
    end if;
    if c.status = 'closed' then
      raise exception 'That day is closed' using errcode = '22023';
    end if;
    select count(*) into n from public.tasks where cycle_id = new.cycle_id and user_id = new.user_id;
    if n >= 50 then
      raise exception 'At most 50 tasks a day' using errcode = '22023';
    end if;
    new.is_completed := false;
    new.completed_at := null;
    new.encrypted_proof_path := null;
    new.created_at := clock_timestamp();
    return new;
  end if;

  select * into c from public.daily_cycles where id = old.cycle_id;
  if c.status = 'closed' then
    raise exception 'That day is closed' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    if old.is_completed then
      raise exception 'Completed tasks can''t be deleted' using errcode = '22023';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.is_completed and not new.is_completed then
    raise exception 'Completed tasks stay completed' using errcode = '22023';
  end if;
  if old.is_completed and new.encrypted_title is distinct from old.encrypted_title then
    raise exception 'Completed tasks can''t be renamed' using errcode = '22023';
  end if;
  if new.is_completed and not old.is_completed then
    new.completed_at := clock_timestamp();
  elsif not new.is_completed then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  if new.encrypted_proof_path is not null and not new.is_completed then
    raise exception 'Proof is added when completing' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger tasks_guard before insert or update or delete on public.tasks
for each row execute function public.tasks_guard();

create function public.recompute_cycle_score(p_cycle uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  done int;
  rid uuid;
begin
  select room_id into rid from public.daily_cycles where id = p_cycle;
  if rid is null then
    return;
  end if;
  select count(*), count(*) filter (where is_completed) into n, done
  from public.tasks where cycle_id = p_cycle and user_id = p_user;

  insert into public.cycle_scores as s (cycle_id, user_id, room_id, task_count, completed_count, reached_100_at)
  values (p_cycle, p_user, rid, n, done, case when n > 0 and done = n then clock_timestamp() end)
  on conflict (cycle_id, user_id) do update
    set task_count = excluded.task_count,
        completed_count = excluded.completed_count,
        -- Keep the original moment while the partner stays at 100; clear it if they drop below.
        reached_100_at = case
          when excluded.task_count > 0 and excluded.completed_count = excluded.task_count
            then coalesce(s.reached_100_at, excluded.reached_100_at)
          else null
        end;
end;
$$;

create function public.tasks_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_cycle_score(old.cycle_id, old.user_id);
    return old;
  end if;
  perform public.recompute_cycle_score(new.cycle_id, new.user_id);
  return new;
end;
$$;

create trigger tasks_after after insert or update or delete on public.tasks
for each row execute function public.tasks_after();

-- Kisses: server decides count, cycle and timestamps; only the partner can be the recipient.
create function public.kisses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if new.to_user_id is distinct from public.partner_of(new.room_id, new.from_user_id) then
    raise exception 'Kisses go to your partner' using errcode = '22023';
  end if;
  if new.trigger_task_id is not null then
    select * into t from public.tasks where id = new.trigger_task_id;
    if t.id is null or t.room_id <> new.room_id or t.user_id <> new.to_user_id or not t.is_completed then
      raise exception 'A kiss can only be for a task your partner completed' using errcode = '22023';
    end if;
  end if;
  new.kiss_count := case when new.kiss_style = 'attack10' then 10 else 1 end;
  new.cycle_id := public.current_cycle_id(new.room_id);
  new.created_at := now();
  new.delivered_to_recipient := false;
  new.seen_at := null;
  return new;
end;
$$;

create trigger kisses_guard before insert on public.kisses
for each row execute function public.kisses_guard();

-- Posts: vault unlock time, mutual-reveal bookkeeping.
create function public.room_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rr public.reveal_rounds;
begin
  new.created_at := now();
  if new.room_type = 'vault' then
    new.unlocks_at := public.vault_unlock_time(new.room_id, now());
  else
    new.unlocks_at := null;
  end if;
  if new.reveal_round_id is not null then
    select * into rr from public.reveal_rounds where id = new.reveal_round_id for update;
    if rr.id is null or rr.room_id <> new.room_id then
      raise exception 'Unknown reveal round' using errcode = '22023';
    end if;
    if rr.revealed_at is not null then
      raise exception 'That reveal already happened' using errcode = '22023';
    end if;
    new.is_revealed := false;
  else
    new.is_revealed := true;
  end if;
  return new;
end;
$$;

create trigger room_posts_guard before insert on public.room_posts
for each row execute function public.room_posts_guard();

create function public.room_posts_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted uuid[];
begin
  if new.reveal_round_id is null then
    return new;
  end if;
  update public.reveal_rounds
    set submitted_user_ids = array(select distinct unnest(submitted_user_ids || new.author_id))
    where id = new.reveal_round_id
    returning submitted_user_ids into submitted;
  if cardinality(submitted) >= 2 then
    update public.reveal_rounds set revealed_at = now() where id = new.reveal_round_id;
    update public.room_posts set is_revealed = true where reveal_round_id = new.reveal_round_id;
  end if;
  return new;
end;
$$;

create trigger room_posts_after_insert after insert on public.room_posts
for each row execute function public.room_posts_after_insert();

create function public.reactions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.room_posts p where p.id = new.post_id and p.room_id = new.room_id) then
    raise exception 'Reaction must be on a post in this room' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger reactions_guard before insert on public.post_reactions
for each row execute function public.reactions_guard();

create function public.spotify_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create trigger spotify_guard before insert or update on public.spotify_sessions
for each row execute function public.spotify_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.members enable row level security;
alter table public.daily_cycles enable row level security;
alter table public.tasks enable row level security;
alter table public.cycle_scores enable row level security;
alter table public.kisses enable row level security;
alter table public.reveal_rounds enable row level security;
alter table public.room_posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.spotify_sessions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.pairing_attempts enable row level security;

-- Start from nothing, then grant exactly what the app uses.
revoke all on all tables in schema public from anon, authenticated;

-- rooms
grant select on public.rooms to authenticated;
grant update (encrypted_config, config_iv, theme_seed_hex, backchodi_start_time, backchodi_tz,
              cowork_started_at, cowork_started_by, cowork_focus_min, cowork_break_min)
  on public.rooms to authenticated;
create policy rooms_select on public.rooms for select to authenticated
  using ((select public.is_room_member(id)));
create policy rooms_update on public.rooms for update to authenticated
  using ((select public.is_room_member(id)) and is_locked)
  with check ((select public.is_room_member(id)) and is_locked);

-- members
grant select on public.members to authenticated;
grant update (battery_level, status_code, decompression_ends_at, last_seen_at, public_key_jwk)
  on public.members to authenticated;
create policy members_select on public.members for select to authenticated
  using ((select public.is_room_member(room_id)));
create policy members_update_own on public.members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- daily_cycles: read-only; changes go through the EOD functions
grant select on public.daily_cycles to authenticated;
create policy cycles_select on public.daily_cycles for select to authenticated
  using ((select public.is_room_member(room_id)));

-- cycle_scores: read-only
grant select on public.cycle_scores to authenticated;
create policy scores_select on public.cycle_scores for select to authenticated
  using ((select public.is_room_member(room_id)));

-- tasks
grant select, delete on public.tasks to authenticated;
grant insert (room_id, cycle_id, user_id, encrypted_title, iv) on public.tasks to authenticated;
grant update (encrypted_title, iv, is_completed, encrypted_proof_path) on public.tasks to authenticated;
create policy tasks_select on public.tasks for select to authenticated
  using ((select public.is_room_member(room_id)));
create policy tasks_insert_own on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_room_member(room_id)));
create policy tasks_update_own on public.tasks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy tasks_delete_own on public.tasks for delete to authenticated
  using (user_id = (select auth.uid()));

-- kisses: send via insert; catching goes through catch_kisses()
grant select on public.kisses to authenticated;
grant insert (room_id, from_user_id, to_user_id, trigger_task_id, kiss_style, encrypted_note, iv)
  on public.kisses to authenticated;
create policy kisses_select on public.kisses for select to authenticated
  using ((select public.is_room_member(room_id)));
create policy kisses_insert on public.kisses for insert to authenticated
  with check (from_user_id = (select auth.uid()) and (select public.is_room_member(room_id)));

-- reveal_rounds
grant select on public.reveal_rounds to authenticated;
grant insert (room_id, started_by) on public.reveal_rounds to authenticated;
create policy reveal_select on public.reveal_rounds for select to authenticated
  using ((select public.is_room_member(room_id)));
create policy reveal_insert on public.reveal_rounds for insert to authenticated
  with check (started_by = (select auth.uid()) and (select public.is_room_member(room_id)));

-- room_posts: the server enforces the vault seal and the mutual-reveal blur.
grant select, delete on public.room_posts to authenticated;
grant insert (room_id, room_type, tag, author_id, encrypted_payload, iv, encrypted_media_path, reveal_round_id, ephemeral)
  on public.room_posts to authenticated;
create policy posts_select on public.room_posts for select to authenticated
  using (
    (select public.is_room_member(room_id))
    and (
      author_id = (select auth.uid())
      or (
        case
          when room_type = 'vault' then
            unlocks_at <= now()
            or created_at <= coalesce((select r.vault_early_unlock_at from public.rooms r where r.id = room_id), '-infinity')
          when reveal_round_id is not null then is_revealed
          else true
        end
      )
    )
  );
create policy posts_insert on public.room_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select public.is_room_member(room_id))
    and (encrypted_media_path is null or encrypted_media_path like room_id::text || '/' || author_id::text || '/%')
  );
create policy posts_delete_own on public.room_posts for delete to authenticated
  using (author_id = (select auth.uid()));

-- post_reactions
grant select, delete on public.post_reactions to authenticated;
grant insert (post_id, room_id, user_id, sticker) on public.post_reactions to authenticated;
create policy reactions_select on public.post_reactions for select to authenticated
  using ((select public.is_room_member(room_id)));
create policy reactions_insert on public.post_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_room_member(room_id)));
create policy reactions_delete on public.post_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- spotify_sessions
grant select on public.spotify_sessions to authenticated;
grant insert (room_id, jam_url_encrypted, jam_iv, current_track_encrypted, track_iv) on public.spotify_sessions to authenticated;
grant update (jam_url_encrypted, jam_iv, current_track_encrypted, track_iv) on public.spotify_sessions to authenticated;
create policy spotify_select on public.spotify_sessions for select to authenticated
  using ((select public.is_room_member(room_id)));
create policy spotify_insert on public.spotify_sessions for insert to authenticated
  with check ((select public.is_room_member(room_id)));
create policy spotify_update on public.spotify_sessions for update to authenticated
  using ((select public.is_room_member(room_id)))
  with check ((select public.is_room_member(room_id)));

-- push_subscriptions: your own only
grant select, delete on public.push_subscriptions to authenticated;
grant insert (room_id, user_id, endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
create policy push_own_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_own_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_room_member(room_id)));
create policy push_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- pairing_attempts: no client access at all (RLS on, no policies, no grants).

-- ---------------------------------------------------------------------------
-- Pairing functions
-- ---------------------------------------------------------------------------
create function public.create_room(p_lookup text, p_expires_at timestamptz, p_public_key jsonb, p_tz text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  rid uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'You are already in a room' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then
    raise exception 'Pairing codes last up to 24 hours' using errcode = '22023';
  end if;
  insert into public.rooms (created_by, pairing_code_hash, pairing_expires_at, backchodi_tz)
    values (uid, p_lookup, p_expires_at, coalesce(nullif(p_tz, ''), 'UTC'))
    returning id into rid;
  insert into public.members (room_id, user_id, public_key_jwk) values (rid, uid, p_public_key);
  insert into public.daily_cycles (room_id, cycle_number) values (rid, 1);
  insert into public.spotify_sessions (room_id) values (rid);
  return rid;
end;
$$;

-- Creator only, before the partner joins: issue a fresh code.
create function public.refresh_pairing_code(p_lookup text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then
    raise exception 'Pairing codes last up to 24 hours' using errcode = '22023';
  end if;
  update public.rooms set pairing_code_hash = p_lookup, pairing_expires_at = p_expires_at
    where created_by = uid and not is_locked;
  if not found then
    raise exception 'No unpaired room to refresh' using errcode = '22023';
  end if;
end;
$$;

-- Creator only, before the partner joins: throw the room away.
create function public.cancel_room()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rooms where created_by = (select auth.uid()) and not is_locked;
  if not found then
    raise exception 'No unpaired room to cancel' using errcode = '22023';
  end if;
end;
$$;

-- Returns {ok, room_id, partner_public_key} or {ok:false, error}. Wrong codes
-- return instead of raising, so the attempt row commits and the rate limit holds.
create function public.join_room(p_lookup text, p_public_key jsonb, p_method public.join_method)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.rooms;
  n int;
  partner jsonb;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- 10 tries an hour per account, counted before checking the code.
  select count(*) into n from public.pairing_attempts
    where user_id = uid and attempted_at > now() - interval '1 hour';
  if n >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many pairing attempts. Try again in an hour.');
  end if;
  insert into public.pairing_attempts (user_id) values (uid);

  if exists (select 1 from public.members where user_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'You are already in a room');
  end if;

  select * into r from public.rooms where pairing_code_hash = p_lookup for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t match a room');
  end if;
  if r.is_locked then
    return jsonb_build_object('ok', false, 'error', 'This room is already full');
  end if;
  if r.pairing_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'That code has expired');
  end if;
  select count(*) into n from public.members m where m.room_id = r.id;
  if n >= r.max_members then
    return jsonb_build_object('ok', false, 'error', 'This room is already full');
  end if;

  insert into public.members (room_id, user_id, public_key_jwk) values (r.id, uid, p_public_key);
  update public.rooms
    set is_locked = true, pairing_code_hash = null, pairing_expires_at = null, join_method = p_method
    where id = r.id;

  select m.public_key_jwk into partner from public.members m where m.room_id = r.id and m.user_id = r.created_by;
  return jsonb_build_object('ok', true, 'room_id', r.id, 'partner_public_key', partner);
end;
$$;

create function public.deliver_room_key(p_ct text, p_iv text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms set key_envelope = p_ct, key_envelope_iv = p_iv
    where created_by = (select auth.uid()) and is_locked;
  if not found then
    raise exception 'No paired room to deliver a key to' using errcode = '22023';
  end if;
end;
$$;

create function public.confirm_room_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := public.my_room_id();
begin
  update public.rooms set key_envelope = null, key_envelope_iv = null
    where id = rid and created_by <> (select auth.uid()) and key_envelope is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mutual end-of-day handshake
-- ---------------------------------------------------------------------------
create function public.propose_eod()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  rid uuid := public.my_room_id();
begin
  if rid is null then
    raise exception 'Not in a room' using errcode = '42501';
  end if;
  if (select count(*) from public.members where room_id = rid) < 2 then
    raise exception 'Your partner hasn''t joined yet' using errcode = '22023';
  end if;
  update public.daily_cycles
    set status = 'eod_pending', eod_proposed_by = uid, eod_proposed_at = now(),
        eod_nudged_at = null, eod_declined_by = null, eod_declined_at = null
    where room_id = rid and status = 'active';
  if not found then
    raise exception 'The day isn''t open' using errcode = '22023';
  end if;
end;
$$;

create function public.nudge_eod()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daily_cycles set eod_nudged_at = now()
    where room_id = public.my_room_id() and status = 'eod_pending' and eod_proposed_by = (select auth.uid());
  if not found then
    raise exception 'Nothing to nudge' using errcode = '22023';
  end if;
end;
$$;

-- Proposer cancels, or the partner says "not yet".
create function public.cancel_eod()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  update public.daily_cycles
    set status = 'active',
        eod_declined_by = case when eod_proposed_by = uid then null else uid end,
        eod_declined_at = case when eod_proposed_by = uid then null else now() end,
        eod_proposed_by = null, eod_proposed_at = null, eod_nudged_at = null
    where room_id = public.my_room_id() and status = 'eod_pending';
  if not found then
    raise exception 'Nothing to cancel' using errcode = '22023';
  end if;
end;
$$;

-- The second partner's confirmation closes the day atomically and opens the next.
create function public.confirm_eod()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  rid uuid := public.my_room_id();
  c public.daily_cycles;
  a record;
  b record;
  win uuid;
  lose uuid;
begin
  select * into c from public.daily_cycles where room_id = rid and status <> 'closed' for update;
  if c.id is null or c.status <> 'eod_pending' then
    raise exception 'Nobody has proposed ending the day' using errcode = '22023';
  end if;
  if c.eod_proposed_by = uid then
    raise exception 'Your partner has to confirm' using errcode = '22023';
  end if;

  -- Both members, with their reached-100 moment (null if they never got there).
  select m.user_id, s.reached_100_at into a
    from public.members m left join public.cycle_scores s on s.cycle_id = c.id and s.user_id = m.user_id
    where m.room_id = rid order by m.joined_at limit 1;
  select m.user_id, s.reached_100_at into b
    from public.members m left join public.cycle_scores s on s.cycle_id = c.id and s.user_id = m.user_id
    where m.room_id = rid order by m.joined_at offset 1 limit 1;

  if a.reached_100_at is not null and (b.reached_100_at is null or a.reached_100_at < b.reached_100_at) then
    win := a.user_id; lose := b.user_id;
  elsif b.reached_100_at is not null and (a.reached_100_at is null or b.reached_100_at < a.reached_100_at) then
    win := b.user_id; lose := a.user_id;
  end if;

  update public.daily_cycles
    set status = 'closed', eod_confirmed_at = now(), closed_at = now(),
        winner_user_id = win, loser_user_id = lose
    where id = c.id;
  insert into public.daily_cycles (room_id, cycle_number) values (rid, c.cycle_number + 1);
  return c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dares
-- ---------------------------------------------------------------------------
create function public.set_dare(p_cycle uuid, p_ct text, p_iv text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daily_cycles set dare_selected_encrypted = p_ct, dare_iv = p_iv
    where id = p_cycle and status = 'closed' and loser_user_id = (select auth.uid())
      and dare_selected_encrypted is null;
  if not found then
    raise exception 'Only the day''s loser can spin, once' using errcode = '22023';
  end if;
end;
$$;

create function public.complete_dare(p_cycle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daily_cycles set dare_completed_at = now()
    where id = p_cycle and status = 'closed' and dare_selected_encrypted is not null
      and dare_completed_at is null
      and (select auth.uid()) in (winner_user_id, loser_user_id);
  if not found then
    raise exception 'No dare to mark done' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kisses
-- ---------------------------------------------------------------------------
create function public.mark_kisses_delivered(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kisses set delivered_to_recipient = true
    where id = any (p_ids) and to_user_id = (select auth.uid()) and not delivered_to_recipient;
$$;

create function public.catch_kisses(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  with caught as (
    update public.kisses set seen_at = now(), delivered_to_recipient = true
      where id = any (p_ids) and to_user_id = (select auth.uid()) and seen_at is null
      returning kiss_count
  )
  select coalesce(sum(kiss_count), 0) into n from caught;
  return n;
end;
$$;

-- Counters: caught kisses in this room, today (since the open day started) and all time.
create function public.kiss_stats()
returns table (today integer, all_time integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(k.kiss_count) filter (
      where k.seen_at >= (select c.started_at from public.daily_cycles c where c.room_id = k.room_id and c.status <> 'closed')
    ), 0)::int,
    coalesce(sum(k.kiss_count), 0)::int
  from public.kisses k
  where k.room_id = public.my_room_id() and k.seen_at is not null;
$$;

-- Tasks my partner finished that I haven't kissed for yet (any day).
create function public.owed_kisses()
returns table (task_id uuid, encrypted_title text, iv text, completed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.encrypted_title, t.iv, t.completed_at
  from public.tasks t
  where t.room_id = public.my_room_id()
    and t.user_id <> (select auth.uid())
    and t.is_completed
    and not exists (
      select 1 from public.kisses k where k.trigger_task_id = t.id and k.from_user_id = (select auth.uid())
    )
  order by t.completed_at;
$$;

-- ---------------------------------------------------------------------------
-- Vault, reveal, ephemeral
-- ---------------------------------------------------------------------------
create function public.request_vault_unlock()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  rid uuid := public.my_room_id();
begin
  update public.members set vault_unlock_requested_at = now() where user_id = uid and room_id = rid;
  if exists (
    select 1 from public.members
    where room_id = rid and user_id <> uid and vault_unlock_requested_at > now() - interval '12 hours'
  ) then
    update public.rooms set vault_early_unlock_at = now() where id = rid;
    update public.members set vault_unlock_requested_at = null where room_id = rid;
    return true;
  end if;
  return false;
end;
$$;

create function public.cancel_vault_unlock()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.members set vault_unlock_requested_at = null where user_id = (select auth.uid());
$$;

-- How many sealed drops my partner has waiting for me (count only, no content).
create function public.vault_sealed_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.room_posts p
  join public.rooms r on r.id = p.room_id
  where p.room_id = public.my_room_id()
    and p.room_type = 'vault'
    and p.author_id <> (select auth.uid())
    and p.unlocks_at > now()
    and p.created_at > coalesce(r.vault_early_unlock_at, '-infinity');
$$;

-- Recipient reads an ephemeral confession once; then it's gone for both.
create function public.burn_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.room_posts
    where id = p_post and ephemeral and room_id = public.my_room_id() and author_id <> (select auth.uid())
      and (reveal_round_id is null or is_revealed);
  if not found then
    raise exception 'Nothing to burn' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_room_member(uuid),
  public.is_room_member_text(text),
  public.my_room_id(),
  public.create_room(text, timestamptz, jsonb, text),
  public.refresh_pairing_code(text, timestamptz),
  public.cancel_room(),
  public.join_room(text, jsonb, public.join_method),
  public.deliver_room_key(text, text),
  public.confirm_room_key(),
  public.propose_eod(),
  public.nudge_eod(),
  public.cancel_eod(),
  public.confirm_eod(),
  public.set_dare(uuid, text, text),
  public.complete_dare(uuid),
  public.mark_kisses_delivered(uuid[]),
  public.catch_kisses(uuid[]),
  public.kiss_stats(),
  public.owed_kisses(),
  public.request_vault_unlock(),
  public.cancel_vault_unlock(),
  public.vault_sealed_count(),
  public.burn_post(uuid)
to authenticated;

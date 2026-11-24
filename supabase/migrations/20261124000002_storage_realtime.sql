-- Encrypted media in Storage, and Realtime access for the two room members.

-- ---------------------------------------------------------------------------
-- Storage: private bucket of encrypted blobs, path = <room_id>/<author_id>/<uuid>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- Upload only into your own folder inside your room.
create policy media_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.is_room_member_text((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- Download your own uploads, or a partner's blob only while the post or task
-- that points at it is visible to you. That makes the vault seal and the
-- mutual-reveal blur apply to media too: hidden row, no download.
create policy media_select on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and public.is_room_member_text((storage.foldername(name))[1])
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (select 1 from public.room_posts p where p.encrypted_media_path = objects.name)
      or exists (select 1 from public.tasks t where t.encrypted_proof_path = objects.name)
    )
  );

-- Delete your own uploads, or a partner's ephemeral blob you are burning after reading.
create policy media_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and public.is_room_member_text((storage.foldername(name))[1])
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (
        select 1 from public.room_posts p
        where p.encrypted_media_path = objects.name and p.ephemeral and p.author_id <> (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: Postgres Changes (RLS applies per subscriber)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.rooms,
  public.members,
  public.daily_cycles,
  public.cycle_scores,
  public.tasks,
  public.kisses,
  public.reveal_rounds,
  public.room_posts,
  public.post_reactions,
  public.spotify_sessions;

-- ---------------------------------------------------------------------------
-- Realtime: private Broadcast channel "room:<room_id>" for floating reactions,
-- "something changed" pings and the live kiss spectacle. No content is sent.
-- ---------------------------------------------------------------------------
create function public.topic_room_member(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_topic like 'room:%' and public.is_room_member_text(substr(p_topic, 6));
$$;

revoke execute on function public.topic_room_member(text) from public, anon;
grant execute on function public.topic_room_member(text) to authenticated;

create policy room_broadcast_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.topic_room_member((select realtime.topic()))
  );

create policy room_broadcast_send on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.topic_room_member((select realtime.topic()))
  );

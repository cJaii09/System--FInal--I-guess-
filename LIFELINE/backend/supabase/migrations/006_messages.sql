-- Request-linked patient/donor to hospital messaging.
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  thread_type text not null check (thread_type in ('patient_hospital', 'donor_hospital')),
  participant_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (request_id, thread_type, participant_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 1000 and length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists chat_messages_thread_created_idx
  on public.chat_messages(thread_id, created_at);
create index if not exists chat_messages_unread_idx
  on public.chat_messages(thread_id, read_at) where read_at is null;

create or replace function public.lifeline_create_request_chat_threads()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.hospital_id is distinct from old.hospital_id and new.hospital_id is not null then
    update public.chat_threads
    set hospital_id = new.hospital_id
    where request_id = new.id and thread_type = 'patient_hospital';
  end if;
  if new.status = 'accepted' and new.donor_id is not null then
    insert into public.chat_threads (request_id, hospital_id, thread_type, participant_id)
    values (new.id, new.hospital_id, 'donor_hospital', new.donor_id)
    on conflict (request_id, thread_type, participant_id) do nothing;
  end if;
  return new;
end $$;

create or replace function public.lifeline_create_patient_chat_thread()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.hospital_id is not null then
    insert into public.chat_threads (request_id, hospital_id, thread_type, participant_id)
    values (new.id, new.hospital_id, 'patient_hospital', new.patient_id)
    on conflict (request_id, thread_type, participant_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists requests_create_chat_threads on public.requests;
drop trigger if exists requests_create_patient_chat_thread on public.requests;
create trigger requests_create_patient_chat_thread
  after insert on public.requests
  for each row execute function public.lifeline_create_patient_chat_thread();
create trigger requests_create_chat_threads
  after update of status, donor_id, hospital_id on public.requests
  for each row execute function public.lifeline_create_request_chat_threads();

-- Backfill conversations for requests that predate this migration.
insert into public.chat_threads (request_id, hospital_id, thread_type, participant_id)
select id, hospital_id, 'patient_hospital', patient_id
from public.requests
where hospital_id is not null
on conflict (request_id, thread_type, participant_id) do nothing;

insert into public.chat_threads (request_id, hospital_id, thread_type, participant_id)
select id, hospital_id, 'donor_hospital', donor_id
from public.requests
where hospital_id is not null and donor_id is not null and status in ('accepted', 'completed')
on conflict (request_id, thread_type, participant_id) do nothing;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_read_participants on public.chat_threads;
create policy chat_threads_read_participants on public.chat_threads
  for select to authenticated
  using (
    participant_id = auth.uid()
    and (
      thread_type = 'patient_hospital'
      or exists (
        select 1 from public.requests r
        where r.id = request_id and r.donor_id = auth.uid()
          and r.status in ('accepted', 'completed')
      )
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'hospital' and p.hospital_id = chat_threads.hospital_id
    )
  );

drop policy if exists chat_messages_read_participants on public.chat_messages;
create policy chat_messages_read_participants on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads t
    where t.id = thread_id
      and (
        (t.participant_id = auth.uid() and (
          t.thread_type = 'patient_hospital'
          or exists (
            select 1 from public.requests r
            where r.id = t.request_id and r.donor_id = auth.uid()
              and r.status in ('accepted', 'completed')
          )
        ))
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'hospital' and p.hospital_id = t.hospital_id
        )
      )
  ));

drop policy if exists chat_messages_insert_participants on public.chat_messages;
create policy chat_messages_insert_participants on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id
        and (
          (t.participant_id = auth.uid() and (
            t.thread_type = 'patient_hospital'
            or exists (
              select 1 from public.requests r
              where r.id = t.request_id and r.donor_id = auth.uid()
                and r.status in ('accepted', 'completed')
            )
          ))
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'hospital' and p.hospital_id = t.hospital_id
          )
        )
    )
  );

drop policy if exists chat_messages_mark_received_read on public.chat_messages;
create policy chat_messages_mark_received_read on public.chat_messages
  for update to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id
        and (
          (t.participant_id = auth.uid() and (
            t.thread_type = 'patient_hospital'
            or exists (
              select 1 from public.requests r
              where r.id = t.request_id and r.donor_id = auth.uid()
                and r.status in ('accepted', 'completed')
            )
          ))
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'hospital' and p.hospital_id = t.hospital_id
          )
        )
    )
  )
  with check (
    sender_id <> auth.uid() and read_at is not null
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id
        and (
          (t.participant_id = auth.uid() and (
            t.thread_type = 'patient_hospital'
            or exists (
              select 1 from public.requests r
              where r.id = t.request_id and r.donor_id = auth.uid()
                and r.status in ('accepted', 'completed')
            )
          ))
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'hospital' and p.hospital_id = t.hospital_id
          )
        )
    )
  );

revoke all on public.chat_threads, public.chat_messages from anon, authenticated;
grant select on public.chat_threads to authenticated;
grant select, insert on public.chat_messages to authenticated;
grant update (read_at) on public.chat_messages to authenticated;
grant all on public.chat_threads, public.chat_messages to service_role;

create or replace function public.lifeline_guard_chat_message_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at')
    or old.read_at is not null or new.read_at is null then
    raise exception 'Recipients may only mark unread messages as read';
  end if;
  if not exists (
    select 1 from public.chat_threads t
    where t.id = old.thread_id
      and (
        (t.participant_id = auth.uid() and (
          t.thread_type = 'patient_hospital'
          or exists (
            select 1 from public.requests r
            where r.id = t.request_id and r.donor_id = auth.uid()
              and r.status in ('accepted', 'completed')
          )
        ))
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'hospital' and p.hospital_id = t.hospital_id
        )
      )
  ) then
    raise exception 'You are not a recipient of this message';
  end if;
  return new;
end $$;

drop trigger if exists chat_messages_guard_update on public.chat_messages;
create trigger chat_messages_guard_update before update on public.chat_messages
  for each row execute function public.lifeline_guard_chat_message_update();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
    ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Run this once in your Supabase project: SQL Editor -> New query -> paste -> Run.
-- Stores your manual edits (notes, logged sessions, rearrangements) as one JSON row
-- so they sync across phone + laptop.

create table if not exists training_state (
  id   text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table training_state enable row level security;

-- Personal app: allow the public anon key to read/write this single table.
-- (Low-sensitivity training data. The key is public, so anyone who has both your
--  site URL and the anon key could read/write it. Fine for this use; ask me if you
--  ever want to lock it down with real auth.)
create policy "anon read"   on training_state for select using (true);
create policy "anon insert" on training_state for insert with check (true);
create policy "anon update" on training_state for update using (true) with check (true);

-- Kick during a running game: the host's kick starts a 10 s pending kick the player can ignore.
-- null = no pending kick. Run by hand in the Supabase SQL editor; idempotent.
alter table public.septica_players add column if not exists kick_requested_at timestamptz;

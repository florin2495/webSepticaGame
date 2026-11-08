-- Șeptică 003: seat order (host can reorder players) + spectators (join a running room, queue for the next round).
-- Additive and idempotent: safe to run twice, drops nothing.

alter table public.septica_players add column if not exists seat integer not null default 0;
alter table public.septica_players add column if not exists role text not null default 'player';
alter table public.septica_players add column if not exists queued_at timestamptz;

do $$ begin
  alter table public.septica_players
    add constraint septica_players_role_check check (role in ('player', 'spectator'));
exception when duplicate_object then null; end $$;

-- Existing rooms: seat = join order inside each room, so nothing changes for games already running.
update public.septica_players p
   set seat = r.rn
  from (
    select id, (row_number() over (partition by room_id order by joined_at, id) - 1)::integer as rn
      from public.septica_players
  ) r
 where p.id = r.id
   and p.seat = 0
   and r.rn > 0;

create index if not exists septica_players_room_role_seat_idx on public.septica_players (room_id, role, seat);

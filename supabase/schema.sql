-- Șeptică multiplayer - Supabase schema
-- Every object is prefixed with septica_ because the Supabase project is shared by all the hub
-- mini-games. Keep the prefix on anything new: tables, constraints, indexes.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Idempotent: re-running it drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- septica_rooms: one row per room. The running deal (stock, hands, trick, captured cards)
-- lives in `deal` as JSON and is only ever read by the server; clients get a filtered view.
-- `version` is bumped on every deal change (optimistic concurrency).
-- ---------------------------------------------------------------------------
create table if not exists public.septica_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null check (char_length(name) between 1 and 40),
  password_hash    text,                                   -- scrypt hash, null = no password
  teams            boolean not null default false,         -- 2 vs 2, only with 4 players
  status           text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 check (round >= 1),
  host_player_id   uuid,
  deal             jsonb,                                  -- current / last deal, server-only
  result           jsonb,                                  -- outcome of the last deal
  version          integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()      -- lobby/finished rooms idle > 2 min are deleted
);
create index if not exists septica_rooms_status_activity_idx on public.septica_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- septica_players: members of a room (max 4). Identity = random token kept by the browser,
-- only its SHA-256 hash is stored. `wins` = rounds won in this room (both partners in teams).
-- ---------------------------------------------------------------------------
create table if not exists public.septica_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.septica_rooms (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 12),
  token_hash text not null unique,
  is_host    boolean not null default false,
  ready      boolean not null default false,
  team       smallint check (team is null or team in (0, 1)),
  wins       integer not null default 0 check (wins >= 0),
  joined_at  timestamptz not null default now(),
  kick_requested_at timestamptz                            -- pending host kick during a game (null = none), see migrations/001
);
-- For databases created before migration 001:
alter table public.septica_players add column if not exists kick_requested_at timestamptz;
create unique index if not exists septica_players_room_nickname_uq on public.septica_players (room_id, lower(nickname));
create index if not exists septica_players_room_idx on public.septica_players (room_id);

do $$ begin
  alter table public.septica_rooms
    add constraint septica_rooms_host_fk foreign key (host_player_id) references public.septica_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.septica_rooms   enable row level security;
alter table public.septica_players enable row level security;

revoke all on public.septica_rooms, public.septica_players from anon, authenticated;

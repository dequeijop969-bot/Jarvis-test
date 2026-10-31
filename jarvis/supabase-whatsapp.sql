-- Cole no Supabase: SQL Editor > New query > Run. Tabelas do Jarvis no WhatsApp (só o servidor acessa).
create table if not exists public.jarvis_wa_contas (
  numero text primary key,
  uid text not null,
  nome text,
  perfil jsonb,
  tokens text,
  historico jsonb,
  pend text,
  pcpend boolean not null default false,
  pc boolean not null default false,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists jarvis_wa_contas_uid on public.jarvis_wa_contas (uid);
create table if not exists public.jarvis_wa_codigos (
  codigo text primary key,
  uid text not null,
  dados text,
  exp timestamptz not null
);
create table if not exists public.jarvis_wa_msgs (
  id text primary key,
  criado timestamptz not null default now()
);
create table if not exists public.jarvis_pc_fila (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  numero text not null,
  texto text not null,
  estado text not null default 'pendente',
  resposta text,
  criado timestamptz not null default now(),
  feito timestamptz
);
create index if not exists jarvis_pc_fila_uid on public.jarvis_pc_fila (uid, estado);
alter table public.jarvis_wa_contas enable row level security;
alter table public.jarvis_wa_codigos enable row level security;
alter table public.jarvis_wa_msgs enable row level security;
alter table public.jarvis_pc_fila enable row level security;

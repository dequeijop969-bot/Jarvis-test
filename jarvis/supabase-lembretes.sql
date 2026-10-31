-- Cole no Supabase: SQL Editor > New query > Run. Cria a tabela dos lembretes do Jarvis (só o servidor acessa).
create table if not exists public.jarvis_lembretes (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  numero text not null,
  texto text not null,
  quando timestamptz not null,
  enviado boolean not null default false,
  enviado_em timestamptz,
  erro text,
  criado timestamptz not null default now()
);
create index if not exists jarvis_lembretes_pend on public.jarvis_lembretes (enviado, quando);
alter table public.jarvis_lembretes enable row level security;

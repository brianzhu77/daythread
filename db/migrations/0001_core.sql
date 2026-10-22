-- The general core (docs/plan/supabase-data-model.md §4, docs/plan/core-build.md C1).
-- Content: blocks, collections, properties, relations, unique_values, block_tags.
-- Infrastructure: workspaces, operations, history, ai_runs, model_attempts, jobs.
-- Every table is scoped by workspace_id with composite keys, so nothing can point into another workspace. The Data API
-- doesn't expose the `app` schema. Request queries run as the restricted role `daythread_app` under forced RLS.

create schema if not exists app;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'daythread_app') then
    -- Never logs in. The server connects with DATABASE_URL (a privileged user) and runs every request transaction as
    -- this role (SET LOCAL ROLE + the verified owner), so RLS applies to request queries. That is an application-
    -- enforced boundary: the privileged connection itself could query outside it, so request code never gets the raw
    -- client (Ratchet 9c19fe45).
    create role daythread_app nologin nobypassrls;
  end if;
end $$;
-- The connecting user must be allowed to SET ROLE to it. On Supabase that user isn't a superuser.
grant daythread_app to current_user;

-- The verified owner of this transaction, set by the server with set_config('app.owner_id', …, true) after it checks
-- the session. Unset means nobody: every policy below then matches nothing.
create function app.current_owner() returns text language sql stable as $$
  select nullif(current_setting('app.owner_id', true), '')
$$;

create table app.workspaces (
  id text primary key,
  owner_id text not null,
  timezone text not null,
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index workspaces_owner on app.workspaces (owner_id);

create table app.collections (
  workspace_id text not null references app.workspaces (id),
  id text not null,
  system_key text,
  name text not null,
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (workspace_id, id)
);
create unique index collections_system_key on app.collections (workspace_id, system_key) where system_key is not null;

create table app.properties (
  workspace_id text not null,
  id text not null,
  collection_id text not null,
  system_key text,
  name text not null,
  type text not null check (type in ('text', 'number', 'checkbox', 'date', 'datetime', 'select', 'multi_select', 'url', 'relation')),
  cardinality text not null default 'one' check (cardinality in ('one', 'many')),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  required boolean not null default false,
  default_value jsonb check (default_value is null or jsonb_typeof(default_value) = 'array'),
  unique_scope text not null default 'none' check (unique_scope in ('none', 'live', 'all')),
  -- A unique property holds one value, so it has one canonical text form in unique_values (its single element, ->> 0).
  check (unique_scope = 'none' or cardinality = 'one'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (workspace_id, id),
  foreign key (workspace_id, collection_id) references app.collections (workspace_id, id)
);
create unique index properties_system_key on app.properties (workspace_id, collection_id, system_key) where system_key is not null;

-- Everything he writes is a block; a page is a block of type 'page'. Blocks are never hard-deleted in normal use:
-- trash (restorable with children) and tombstone (a removed line: id and last page) are separate.
create table app.blocks (
  workspace_id text not null,
  id text not null,
  parent_id text,
  position bigint not null default 0,
  type text not null,
  content jsonb,
  content_format text not null default 'bn-1',
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
  collection_id text,
  -- Values keyed by property id, always arrays (§4.2), so a cardinality change rewrites no value.
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  created_by text not null default 'user' check (created_by in ('user', 'model')),
  trashed_at timestamptz,
  trash_batch_id text,
  deleted_at timestamptz,
  deleted_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (workspace_id, id),
  foreign key (workspace_id) references app.workspaces (id),
  foreign key (workspace_id, parent_id) references app.blocks (workspace_id, id) on delete restrict,
  foreign key (workspace_id, collection_id) references app.collections (workspace_id, id),
  check (parent_id is null or parent_id <> id)
);
create index blocks_children on app.blocks (workspace_id, parent_id, position, id);
create index blocks_collection on app.blocks (workspace_id, collection_id) where collection_id is not null;
-- One index for every property of every workspace: queries use containment, properties @> '{"<id>": ["value"]}'.
create index blocks_properties on app.blocks using gin (properties jsonb_path_ops);

-- A block can't become its own ancestor. Checked in the command under the workspace lock as well; this is the second wall.
create function app.blocks_no_cycle() returns trigger language plpgsql as $$
begin
  if new.parent_id is null then return new; end if;
  if exists (
    with recursive up (id, parent_id, depth) as (
      select b.id, b.parent_id, 1 from app.blocks b where b.workspace_id = new.workspace_id and b.id = new.parent_id
      union all
      select b.id, b.parent_id, up.depth + 1 from app.blocks b join up on b.workspace_id = new.workspace_id and b.id = up.parent_id
      where up.depth < 10000
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'block % would be its own ancestor', new.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger blocks_no_cycle before insert or update of parent_id on app.blocks for each row execute function app.blocks_no_cycle();

-- Every edge: inline mentions and line links, ref blocks (kind 'embed'), relation properties, brought_from / copied_from.
create table app.relations (
  workspace_id text not null,
  id text not null,
  from_block text not null,
  to_block text not null,
  kind text not null,
  property_id text,
  ref_id text,
  at timestamptz,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, from_block) references app.blocks (workspace_id, id),
  foreign key (workspace_id, to_block) references app.blocks (workspace_id, id),
  foreign key (workspace_id, property_id) references app.properties (workspace_id, id)
);
create index relations_to on app.relations (workspace_id, to_block, kind);
create index relations_from on app.relations (workspace_id, from_block, kind);

-- Uniqueness as a schema rule (properties.unique_scope), for any property including his own: the write path keeps one
-- row per unique value in the same transaction; 'live' rows are removed when the block is trashed.
create table app.unique_values (
  workspace_id text not null,
  property_id text not null,
  -- The canonical form: the property's single value as text (properties -> property_id ->> 0).
  value text not null,
  block_id text not null,
  primary key (workspace_id, property_id, value),
  foreign key (workspace_id, property_id) references app.properties (workspace_id, id),
  foreign key (workspace_id, block_id) references app.blocks (workspace_id, id)
);

-- Tags are text (Brian's rule); this is an index rebuilt from content at any time.
create table app.block_tags (
  workspace_id text not null,
  block_id text not null,
  tag_key text not null,
  tag text not null,
  primary key (workspace_id, block_id, tag_key),
  foreign key (workspace_id, block_id) references app.blocks (workspace_id, id)
);
create index block_tags_key on app.block_tags (workspace_id, tag_key);

-- Facts about what happened, read by screens. Append-only, never pruned; no foreign key, so nothing cascades into it.
create table app.history (
  workspace_id text not null references app.workspaces (id),
  id text not null,
  block_id text,
  kind text not null,
  day date,
  at timestamptz not null default now(),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  operation_id text,
  primary key (workspace_id, id)
);
create index history_block on app.history (workspace_id, block_id, kind);

-- One row per command: replay by fingerprint, the result, and the before-images Undo restores (core-build §6).
create table app.operations (
  workspace_id text not null references app.workspaces (id),
  id text not null,
  type text not null,
  fingerprint text not null,
  device text,
  entity_id text,
  simulated boolean not null default false,
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object'),
  inverse jsonb,
  undone_by text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index operations_created on app.operations (workspace_id, created_at);

create table app.ai_runs (
  workspace_id text not null references app.workspaces (id),
  id text not null,
  kind text not null,
  target_block_id text,
  status text not null,
  model text,
  request_hash text,
  manifest jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (workspace_id, id)
);

-- The budget ledger, as on SQLite (src/server/model-ledger.ts), scoped by workspace.
create table app.model_attempts (
  workspace_id text not null references app.workspaces (id),
  id text not null,
  run_id text,
  revision integer,
  day date not null,
  reserved_micros bigint not null,
  actual_micros bigint,
  state text not null check (state in ('reserved', 'unknown', 'estimated', 'settled', 'not-sent')),
  generation_id text,
  model text,
  created_at timestamptz not null,
  settled_at timestamptz,
  note text,
  result_fingerprint text,
  result_operation_id text,
  request_hash text,
  primary key (workspace_id, id)
);
create index model_attempts_day on app.model_attempts (workspace_id, day);

-- Durable background work (core-build §5): written with the command, run with waitUntil, recovered by lease expiry.
create table app.jobs (
  workspace_id text not null references app.workspaces (id),
  id text not null,
  kind text not null,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  state text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index jobs_due on app.jobs (state, lease_until);

-- Row level security: owner only, forced, on every table.
do $$
declare t text;
begin
  foreach t in array array['collections', 'properties', 'blocks', 'relations', 'unique_values', 'block_tags', 'history', 'operations', 'ai_runs', 'model_attempts', 'jobs'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format($p$create policy owner_only on app.%I using (workspace_id in (select id from app.workspaces where owner_id = app.current_owner())) with check (workspace_id in (select id from app.workspaces where owner_id = app.current_owner()))$p$, t);
  end loop;
end $$;
alter table app.workspaces enable row level security;
alter table app.workspaces force row level security;
create policy owner_only on app.workspaces using (owner_id = app.current_owner()) with check (owner_id = app.current_owner());

-- Grants: nothing for anyone but the server role. History is append-only; operations keep their rows (Undo marks them).
revoke all on schema app from public;
grant usage on schema app to daythread_app;
grant execute on function app.current_owner() to daythread_app;
grant select, insert, update on app.workspaces, app.collections, app.properties, app.blocks, app.ai_runs, app.model_attempts, app.jobs, app.operations to daythread_app;
grant select, insert, update, delete on app.relations, app.unique_values, app.block_tags to daythread_app;
grant select, insert on app.history to daythread_app;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema app from %I', r);
      execute format('revoke all on all tables in schema app from %I', r);
    end if;
  end loop;
end $$;

-- The seed at first sign-in (docs/design/empty-start-states.md §1): the workspace, five collections with their system
-- properties, and the day template. Nothing else: no sample page, task or welcome text.
-- Runs as the server role inside the sign-in transaction, after app.owner_id is set, so RLS checks every row it writes.

create function app.create_workspace(p_owner text, p_timezone text) returns text language plpgsql as $$
declare
  ws text := gen_random_uuid()::text;
  c_days text := gen_random_uuid()::text;
  c_tasks text := gen_random_uuid()::text;
  c_events text := gen_random_uuid()::text;
  c_links text := gen_random_uuid()::text;
  c_templates text := gen_random_uuid()::text;
  template text := gen_random_uuid()::text;
  pos bigint := 0;
  r record;
begin
  if p_owner is distinct from app.current_owner() then
    raise exception 'a workspace can only be created for the signed-in owner' using errcode = 'insufficient_privilege';
  end if;
  insert into app.workspaces (id, owner_id, timezone) values (ws, p_owner, p_timezone);

  insert into app.collections (workspace_id, id, system_key, name) values
    (ws, c_days, 'days', 'Days'),
    (ws, c_tasks, 'tasks', 'Tasks'),
    (ws, c_events, 'events', 'Events'),
    (ws, c_links, 'links', 'Links'),
    (ws, c_templates, 'templates', 'Templates');

  -- System properties: the app finds them by system_key, never by name (§4.2). Values are always arrays.
  insert into app.properties (workspace_id, id, collection_id, system_key, name, type, cardinality, config, unique_scope)
  select ws, gen_random_uuid()::text, c, k, n, t, card, cfg::jsonb, u from (values
    (c_days,   'date',            'Date',             'date',     'one', '{}', 'all'),
    (c_days,   'review_done_at',  'Review done',      'datetime', 'one', '{}', 'none'),
    (c_days,   'handoff_done_at', 'Hand-off done',    'datetime', 'one', '{}', 'none'),
    (c_tasks,  'status',          'Status',           'select',   'one', '{"options":[{"id":"open","name":"Open"},{"id":"done","name":"Done"},{"id":"cancelled","name":"Cancelled"}]}', 'none'),
    (c_tasks,  'plan_on',         'Plan date',        'date',     'one', '{}', 'none'),
    (c_tasks,  'last_planned_on', 'Last planned',     'date',     'one', '{}', 'none'),
    (c_tasks,  'due_on',          'Deadline',         'date',     'one', '{}', 'none'),
    (c_tasks,  'start_on',        'Start',            'date',     'one', '{}', 'none'),
    (c_tasks,  'paused',          'Paused',           'checkbox', 'one', '{}', 'none'),
    (c_tasks,  'done_on',         'Done on',          'date',     'one', '{}', 'none'),
    (c_tasks,  'created_on',      'Created',          'date',     'one', '{}', 'none'),
    (c_tasks,  'source_page',     'Source page',      'relation', 'one', '{}', 'none'),
    (c_events, 'date',            'Date',             'date',     'one', '{}', 'none'),
    (c_events, 'time',            'Time',             'text',     'one', '{}', 'none'),
    (c_events, 'cancelled',       'Cancelled',        'checkbox', 'one', '{}', 'none'),
    (c_links,  'url',             'URL',              'url',      'one', '{}', 'none'),
    -- A trashed link page still owns its URL (A2); pasting it again restores that page (Lead, after Jazz and Bumblebee).
    (c_links,  'url_key',         'URL key',          'text',     'one', '{}', 'all'),
    (c_links,  'saved_on',        'Saved',            'date',     'one', '{}', 'none'),
    (c_links,  'review_state',    'Follow-up',        'select',   'one', '{"options":[{"id":"pending","name":"To sort"},{"id":"watching","name":"Watching"},{"id":"lower","name":"Later"},{"id":"done","name":"Done with it"},{"id":"task","name":"Became a task"}]}', 'none'),
    (c_links,  'next_review_on',  'Next look',        'date',     'one', '{}', 'none'),
    (c_links,  'skipped_until',   'Skipped until',    'date',     'one', '{}', 'none'),
    (c_links,  'resurface',       'Resurface',        'checkbox', 'one', '{}', 'none')
  ) as p (c, k, n, t, card, cfg, u);

  -- The day template: today's five headings with their roles and starter rows, his wording kept as text (renamable).
  insert into app.blocks (workspace_id, id, type, collection_id, content, props)
  values (ws, template, 'page', c_templates, '[{"type":"text","text":"Day","styles":{}}]', '{}');
  for r in select * from (values
    ('heading',        'TODO - Top 3', 'plan-top3'),
    ('todo',           null,           null),
    ('heading',        'TODO - Other', 'plan-other'),
    ('todo',           null,           null),
    ('heading',        'Events',       null),
    ('bulletListItem', null,           null),
    ('heading',        'Good Stuffs',  'collect-links'),
    ('bulletListItem', null,           null),
    ('heading',        'Notes',        null),
    ('bulletListItem', null,           null)
  ) as t (type, title, role) loop
    pos := pos + 1024;
    insert into app.blocks (workspace_id, id, parent_id, position, type, content, props)
    values (ws, gen_random_uuid()::text, template, pos, r.type,
      case when r.title is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type', 'text', 'text', r.title, 'styles', '{}'::jsonb)) end,
      case when r.type = 'heading' then jsonb_strip_nulls(jsonb_build_object('level', 2, 'role', r.role)) else '{}'::jsonb end);
  end loop;
  update app.collections set settings = jsonb_build_object('template_page_id', template) where workspace_id = ws and id = c_days;
  return ws;
end $$;

grant execute on function app.create_workspace(text, text) to daythread_app;

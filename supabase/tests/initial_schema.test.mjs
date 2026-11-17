// LS-03: the initial schema applies cleanly and enforces its constraints.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { asRole, createDatabase, createUser, migrationFiles } from './helpers.mjs';

const STUDENT = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-000000000002';

const TABLES = [
  'ai_analyses',
  'categories',
  'duplicate_candidates',
  'locations',
  'notifications',
  'profiles',
  'report_media',
  'reports',
  'routing_rules',
  'status_history',
  'team_members',
  'teams',
];

let db;
let ids;

async function one(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0];
}

before(async () => {
  db = await createDatabase();
  await createUser(db, STUDENT);
  await createUser(db, STAFF);
  const team = await one(`insert into teams (name) values ('Test Team A') returning id`);
  const location = await one(`insert into locations (name, location_type) values ('Test Building', 'building') returning id`);
  const category = await one(`insert into categories (name) values ('Test Category') returning id`);
  ids = { team: team.id, location: location.id, category: category.id };
});

async function newReport() {
  return one(
    `insert into reports (submitter_id, location_id) values ($1, $2)
     returning id, reference_code, status`,
    [STUDENT, ids.location],
  );
}

describe('migrations', () => {
  it('has at least one migration and applies to a clean database', () => {
    assert.ok(migrationFiles().length >= 1);
  });

  it('creates every SDD 5.6 data area', async () => {
    const result = await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.table_name),
      TABLES,
    );
  });

  it('enables row-level security on every table', async () => {
    const result = await db.query(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    assert.deepEqual(result.rows, []);
  });
});

describe('users and roles', () => {
  it('creates a student profile for each new auth user', async () => {
    const profile = await one('select role from profiles where id = $1', [STUDENT]);
    assert.equal(profile.role, 'student');
  });

  it('rejects an unknown role', async () => {
    await assert.rejects(db.query(`update profiles set role = 'superuser' where id = $1`, [STAFF]));
  });

  it('records staff team membership once', async () => {
    await db.query(`update profiles set role = 'staff' where id = $1`, [STAFF]);
    await db.query('insert into team_members (team_id, user_id) values ($1, $2)', [ids.team, STAFF]);
    await assert.rejects(
      db.query('insert into team_members (team_id, user_id) values ($1, $2)', [ids.team, STAFF]),
    );
  });

  it('removes the profile when the auth user is deleted', async () => {
    const temp = '00000000-0000-0000-0000-0000000000aa';
    await createUser(db, temp);
    await db.query('delete from auth.users where id = $1', [temp]);
    assert.equal(await one('select 1 as found from profiles where id = $1', [temp]), undefined);
  });
});

describe('reports', () => {
  it('starts as submitted with a unique reference code', async () => {
    const first = await newReport();
    const second = await newReport();
    assert.equal(first.status, 'submitted');
    assert.match(first.reference_code, /^RPT-\d{6}$/);
    assert.notEqual(first.reference_code, second.reference_code);
  });

  it('accepts exactly the SDD 6.4 statuses', async () => {
    const result = await db.query(`select unnest(enum_range(null::report_status))::text as status`);
    assert.deepEqual(
      result.rows.map((row) => row.status),
      ['submitted', 'assigned', 'in_progress', 'resolved', 'reopened', 'closed'],
    );
    const report = await newReport();
    await assert.rejects(
      db.query(`update reports set status = 'deleted' where id = $1`, [report.id]),
    );
  });

  it('requires a submitter and a supported location', async () => {
    await assert.rejects(db.query('insert into reports (submitter_id) values ($1)', [STUDENT]));
    await assert.rejects(
      db.query('insert into reports (submitter_id, location_id) values ($1, $2)', [
        STUDENT,
        '00000000-0000-0000-0000-00000000dead',
      ]),
    );
  });

  it('limits the optional note length', async () => {
    await assert.rejects(
      db.query('insert into reports (submitter_id, location_id, note) values ($1, $2, $3)', [
        STUDENT,
        ids.location,
        'x'.repeat(2001),
      ]),
    );
  });

  it('requires category confirmation to name who confirmed it', async () => {
    const report = await newReport();
    await assert.rejects(
      db.query('update reports set category_confirmed_at = now() where id = $1', [report.id]),
    );
    await db.query(
      `update reports set category_id = $2, category_confirmed_by = $3, category_confirmed_at = now()
       where id = $1`,
      [report.id, ids.category, STAFF],
    );
  });

  it('updates updated_at on change', async () => {
    const report = await newReport();
    await db.query(`update reports set created_at = now() - interval '1 hour',
                    updated_at = now() - interval '1 hour' where id = $1`, [report.id]);
    const after = await one(
      `update reports set note = 'changed' where id = $1
       returning updated_at > created_at as bumped`,
      [report.id],
    );
    assert.equal(after.bumped, true);
  });
});

describe('routing rules', () => {
  it('routes to a team, not an individual', async () => {
    const result = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'routing_rules' and column_name in ('team_id', 'user_id', 'assignee_id')`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.column_name),
      ['team_id'],
    );
  });

  it('allows one active rule per category and per category + location', async () => {
    const insert = (location, active = true) =>
      db.query(
        `insert into routing_rules (category_id, location_id, team_id, is_active)
         values ($1, $2, $3, $4)`,
        [ids.category, location, ids.team, active],
      );
    await insert(null);
    await insert(ids.location);
    await assert.rejects(insert(null));
    await assert.rejects(insert(ids.location));
    // Inactive rules may be kept alongside the active one.
    await insert(null, false);
  });
});

describe('related records', () => {
  it('stores media, AI analysis, history, and notifications for a report', async () => {
    const report = await newReport();
    await db.query(
      `insert into report_media (report_id, uploader_id, bucket, object_path, content_type, size_bytes)
       values ($1, $2, 'report-media', $3, 'image/jpeg', 1024)`,
      [report.id, STUDENT, `${STUDENT}/photo.jpg`],
    );
    await db.query(
      `insert into ai_analyses (report_id, processing_status, suggested_category_id,
                                suggested_priority, confidence, is_potential_safety_hazard)
       values ($1, 'succeeded', $2, 'high', 0.82, true)`,
      [report.id, ids.category],
    );
    const history = await one(
      `insert into status_history (report_id, to_status) values ($1, 'submitted') returning id`,
      [report.id],
    );
    await db.query(
      `insert into notifications (report_id, recipient_id, status_history_id, event_type, channel)
       values ($1, $2, $3, 'status_changed', 'test')`,
      [report.id, STUDENT, history.id],
    );
    const notification = await one(
      'select delivery_state from notifications where report_id = $1',
      [report.id],
    );
    assert.equal(notification.delivery_state, 'pending');
  });

  it('rejects out-of-range AI confidence and empty files', async () => {
    const report = await newReport();
    await assert.rejects(
      db.query('insert into ai_analyses (report_id, confidence) values ($1, 1.5)', [report.id]),
    );
    await assert.rejects(
      db.query(
        `insert into report_media (uploader_id, bucket, object_path, content_type, size_bytes)
         values ($1, 'report-media', 'empty.jpg', 'image/jpeg', 0)`,
        [STUDENT],
      ),
    );
  });

  it('keeps duplicate suggestions non-destructive and never self-referential', async () => {
    const a = await newReport();
    const b = await newReport();
    await assert.rejects(
      db.query('insert into duplicate_candidates (report_id, candidate_report_id) values ($1, $1)', [
        a.id,
      ]),
    );
    const candidate = await one(
      `insert into duplicate_candidates (report_id, candidate_report_id) values ($1, $2)
       returning review_state`,
      [a.id, b.id],
    );
    assert.equal(candidate.review_state, 'pending');
    const statuses = await db.query('select status from reports where id in ($1, $2)', [a.id, b.id]);
    assert.deepEqual(
      statuses.rows.map((row) => row.status),
      ['submitted', 'submitted'],
    );
  });
});

describe('public API access without a signed-in user', () => {
  it('anon cannot read or write reports', async () => {
    await newReport();
    await asRole(db, 'anon', async () => {
      await assert.rejects(db.query('select count(*) from reports'));
      await assert.rejects(
        db.query('insert into reports (submitter_id, location_id) values ($1, $2)', [
          STUDENT,
          ids.location,
        ]),
      );
    });
  });

  it('a token with no user identity sees no rows and cannot write', async () => {
    await asRole(db, 'authenticated', async () => {
      for (const table of TABLES) {
        const result = await db.query(`select count(*)::int as visible from ${table}`);
        // Active reference data is intentionally readable by any signed-in role.
        if (!['locations', 'categories'].includes(table)) {
          assert.equal(result.rows[0].visible, 0, table);
        }
      }
      await assert.rejects(db.query(`update profiles set role = 'administrator'`));
    });
    const profile = await one('select role from profiles where id = $1', [STUDENT]);
    assert.equal(profile.role, 'student');
  });
});

// LS-04: row-level security policies enforce RC-01 for anyone reaching
// Supabase directly with a user's token.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { asRole, asUser, createDatabase, createUser } from './helpers.mjs';

const STUDENT_A = '00000000-0000-0000-0000-00000000000a';
const STUDENT_B = '00000000-0000-0000-0000-00000000000b';
const STAFF_ONE = '00000000-0000-0000-0000-000000000011'; // member of team one
const STAFF_TWO = '00000000-0000-0000-0000-000000000022'; // member of team two
const FORMER_STAFF = '00000000-0000-0000-0000-000000000033'; // membership row, student role
const ADMIN = '00000000-0000-0000-0000-0000000000ad';

let db;
let ids;

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

async function visibleIds(userId, table) {
  return asUser(db, userId, async () => (await rows(`select id from ${table}`)).map((r) => r.id));
}

before(async () => {
  db = await createDatabase();
  for (const id of [STUDENT_A, STUDENT_B, STAFF_ONE, STAFF_TWO, FORMER_STAFF, ADMIN]) {
    await createUser(db, id);
  }
  await db.query(`update profiles set role = 'staff' where id in ($1, $2)`, [STAFF_ONE, STAFF_TWO]);
  await db.query(`update profiles set role = 'administrator' where id = $1`, [ADMIN]);

  const [teamOne, teamTwo] = await rows(
    `insert into teams (name) values ('Test Team One'), ('Test Team Two') returning id`,
  );
  await db.query(
    `insert into team_members (team_id, user_id) values ($1, $2), ($3, $4), ($1, $5)`,
    [teamOne.id, STAFF_ONE, teamTwo.id, STAFF_TWO, FORMER_STAFF],
  );
  const [active, inactive] = await rows(
    `insert into locations (name, is_active) values ('Open Building', true), ('Closed Building', false)
     returning id`,
  );
  const [category] = await rows(`insert into categories (name) values ('Test Category') returning id`);
  await db.query(`insert into categories (name, is_active) values ('Retired Category', false)`);
  await db.query(`insert into routing_rules (category_id, team_id) values ($1, $2)`, [
    category.id,
    teamOne.id,
  ]);

  const report = async (submitter, team) =>
    (
      await rows(
        `insert into reports (submitter_id, location_id, assigned_team_id) values ($1, $2, $3)
         returning id`,
        [submitter, active.id, team],
      )
    )[0].id;
  const aTeamOne = await report(STUDENT_A, teamOne.id);
  const bTeamTwo = await report(STUDENT_B, teamTwo.id);
  const bUnassigned = await report(STUDENT_B, null);

  for (const id of [aTeamOne, bTeamTwo, bUnassigned]) {
    await db.query(
      `insert into report_media (report_id, uploader_id, bucket, object_path, content_type, size_bytes)
       select id, submitter_id, 'report-media', id::text, 'image/jpeg', 10 from reports where id = $1`,
      [id],
    );
    await db.query(`insert into ai_analyses (report_id) values ($1)`, [id]);
    await db.query(`insert into status_history (report_id, to_status) values ($1, 'submitted')`, [id]);
    await db.query(
      `insert into notifications (report_id, recipient_id, event_type, channel)
       select id, submitter_id, 'status_changed', 'test' from reports where id = $1`,
      [id],
    );
  }
  await db.query(
    `insert into report_media (uploader_id, bucket, object_path, content_type, size_bytes)
     values ($1, 'report-media', 'pending-upload', 'image/jpeg', 10)`,
    [STUDENT_A],
  );
  await db.query(`insert into duplicate_candidates (report_id, candidate_report_id) values ($1, $2)`, [
    aTeamOne,
    bTeamTwo,
  ]);

  ids = { teamOne: teamOne.id, teamTwo: teamTwo.id, active: active.id, inactive: inactive.id };
  ids.reports = { aTeamOne, bTeamTwo, bUnassigned };
});

describe('reports (RC-01)', () => {
  it('a student sees only their own reports', async () => {
    assert.deepEqual(await visibleIds(STUDENT_A, 'reports'), [ids.reports.aTeamOne]);
    assert.deepEqual(
      (await visibleIds(STUDENT_B, 'reports')).sort(),
      [ids.reports.bTeamTwo, ids.reports.bUnassigned].sort(),
    );
  });

  it('staff see only reports assigned to their team', async () => {
    assert.deepEqual(await visibleIds(STAFF_ONE, 'reports'), [ids.reports.aTeamOne]);
    assert.deepEqual(await visibleIds(STAFF_TWO, 'reports'), [ids.reports.bTeamTwo]);
  });

  it('a former staff member with a leftover membership row sees no team reports', async () => {
    assert.deepEqual(await visibleIds(FORMER_STAFF, 'reports'), []);
  });

  it('an administrator sees every report', async () => {
    assert.equal((await visibleIds(ADMIN, 'reports')).length, 3);
  });

  it('a signed-out caller sees nothing', async () => {
    await asRole(db, 'anon', async () => {
      await assert.rejects(db.query('select id from reports'));
    });
  });
});

describe('records attached to reports follow report visibility', () => {
  for (const table of ['report_media', 'ai_analyses', 'status_history']) {
    it(`${table}: student A and staff one see report A's rows only`, async () => {
      const visible = async (user) =>
        asUser(db, user, async () =>
          (await rows(`select report_id from ${table} where report_id is not null`)).map(
            (r) => r.report_id,
          ),
        );
      assert.deepEqual(await visible(STUDENT_A), [ids.reports.aTeamOne]);
      assert.deepEqual(await visible(STAFF_ONE), [ids.reports.aTeamOne]);
      assert.equal((await visible(ADMIN)).length, 3);
    });
  }

  it('an unattached upload is visible only to its uploader', async () => {
    const pending = (user) =>
      asUser(db, user, async () =>
        rows(`select id from report_media where report_id is null`),
      );
    assert.equal((await pending(STUDENT_A)).length, 1);
    assert.equal((await pending(STUDENT_B)).length, 0);
    assert.equal((await pending(STAFF_ONE)).length, 0);
  });

  it('duplicate suggestions are visible to staff in scope and admins, not students', async () => {
    assert.equal((await visibleIds(STUDENT_A, 'duplicate_candidates')).length, 0);
    assert.equal((await visibleIds(STAFF_ONE, 'duplicate_candidates')).length, 1);
    assert.equal((await visibleIds(STAFF_TWO, 'duplicate_candidates')).length, 0);
    assert.equal((await visibleIds(ADMIN, 'duplicate_candidates')).length, 1);
  });

  it('notifications are visible to their recipient', async () => {
    assert.equal((await visibleIds(STUDENT_A, 'notifications')).length, 1);
    assert.equal((await visibleIds(STUDENT_B, 'notifications')).length, 2);
    assert.equal((await visibleIds(STAFF_ONE, 'notifications')).length, 0);
  });
});

describe('profiles, teams, and configuration', () => {
  it('users see their own profile; administrators see all', async () => {
    assert.deepEqual(await visibleIds(STUDENT_A, 'profiles'), [STUDENT_A]);
    assert.deepEqual(await visibleIds(STAFF_ONE, 'profiles'), [STAFF_ONE]);
    assert.equal((await visibleIds(ADMIN, 'profiles')).length, 6);
  });

  it('staff see their own team only; students see none', async () => {
    assert.deepEqual(await visibleIds(STAFF_ONE, 'teams'), [ids.teamOne]);
    assert.deepEqual(await visibleIds(STUDENT_A, 'teams'), []);
    assert.equal((await visibleIds(ADMIN, 'teams')).length, 2);
  });

  it('everyone signed in sees active locations and categories only', async () => {
    assert.deepEqual(await visibleIds(STUDENT_A, 'locations'), [ids.active]);
    assert.equal((await visibleIds(STUDENT_A, 'categories')).length, 1);
    assert.equal((await visibleIds(ADMIN, 'locations')).length, 2);
    assert.equal((await visibleIds(ADMIN, 'categories')).length, 2);
  });

  it('routing rules are visible to administrators only', async () => {
    assert.equal((await visibleIds(STUDENT_A, 'routing_rules')).length, 0);
    assert.equal((await visibleIds(STAFF_ONE, 'routing_rules')).length, 0);
    assert.equal((await visibleIds(ADMIN, 'routing_rules')).length, 1);
  });
});

describe('the public API is read-only for every role', () => {
  for (const [label, user] of [
    ['student', STUDENT_A],
    ['staff', STAFF_ONE],
    ['administrator', ADMIN],
  ]) {
    it(`${label} cannot write`, async () => {
      await asUser(db, user, async () => {
        await assert.rejects(db.query(`update profiles set role = 'administrator'`));
        await assert.rejects(db.query(`update reports set status = 'closed'`));
        await assert.rejects(db.query(`delete from reports`));
        await assert.rejects(db.query(`insert into teams (name) values ('Injected Team')`));
        await assert.rejects(
          db.query(`insert into team_members (team_id, user_id) values ($1, $2)`, [
            ids.teamTwo,
            user,
          ]),
        );
      });
    });
  }

  it('nothing was changed by those attempts', async () => {
    const [counts] = await rows(
      `select (select count(*)::int from reports) as reports,
              (select count(*)::int from teams) as teams,
              (select count(*)::int from profiles where role = 'administrator') as admins`,
    );
    assert.deepEqual(counts, { reports: 3, teams: 2, admins: 1 });
  });
});

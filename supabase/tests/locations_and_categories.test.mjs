// LS-05: seeded campus locations and report categories.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { asUser, createDatabase, createUser } from './helpers.mjs';

const STUDENT = '00000000-0000-0000-0000-000000000001';

const EXPECTED_LOCATIONS = [
  'Academic Quad',
  'Annie Gabriel Library',
  'Business Building',
  'CBU Events Center',
  'Campus Store',
  'Dennis and Carol Troesh Science Complex',
  'Dining Commons',
  'Engineering Building',
  'James Building',
  'Lancer Plaza',
  'Outdoor / Common Areas',
  'Parking Lots',
  'Recreation Center',
  'Residence Halls',
  'Rose Garden',
  'School of Nursing',
  'University Chapel',
  'Van Dyne Gymnasium',
  'Wallace Theatre',
  'Yeager Center',
];

const EXPECTED_CATEGORIES = [
  'Dining or campus service-location issue',
  'Facilities / maintenance issue',
  'Housing / residential issue',
  'IT / technology problem',
  'Other supported campus issue',
  'Potential safety hazard',
];

let db;

before(async () => {
  db = await createDatabase();
  await createUser(db, STUDENT);
});

describe('campus locations', () => {
  it('seeds exactly the approved list, all active, each with a type', async () => {
    const result = await db.query(
      `select name, location_type, is_active from locations order by name collate "C"`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.name),
      [...EXPECTED_LOCATIONS].sort(),
    );
    for (const row of result.rows) {
      assert.equal(row.is_active, true, row.name);
      assert.match(row.location_type, /^[a-z][a-z0-9_]*$/, row.name);
    }
  });

  it('accepts a new location and a new type without a schema change', async () => {
    await db.query(
      `insert into locations (name, location_type) values ('Test Field', 'athletic_field')`,
    );
    await db.query(`delete from locations where name = 'Test Field'`);
  });

  it('requires a well-formed type and a unique name', async () => {
    await assert.rejects(db.query(`insert into locations (name) values ('No Type')`));
    await assert.rejects(
      db.query(`insert into locations (name, location_type) values ('Bad Type', 'Has Spaces')`),
    );
    await assert.rejects(
      db.query(`insert into locations (name, location_type) values ('Yeager Center', 'building')`),
    );
  });

  it('a signed-in student sees active locations only', async () => {
    await db.query(`update locations set is_active = false where name = 'Rose Garden'`);
    const names = await asUser(db, STUDENT, async () =>
      (await db.query('select name from locations')).rows.map((row) => row.name),
    );
    assert.equal(names.length, EXPECTED_LOCATIONS.length - 1);
    assert.ok(!names.includes('Rose Garden'));
    await db.query(`update locations set is_active = true where name = 'Rose Garden'`);
  });
});

describe('report categories', () => {
  it('seeds the SDD 2.3 candidate set, all active, with descriptions', async () => {
    const result = await db.query(
      `select name, description, is_active from categories order by name collate "C"`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.name),
      [...EXPECTED_CATEGORIES].sort(),
    );
    for (const row of result.rows) {
      assert.equal(row.is_active, true, row.name);
      assert.ok(row.description.length > 0, row.name);
    }
  });
});

describe('scope', () => {
  it('creates no teams or routing rules', async () => {
    const [counts] = (
      await db.query(
        `select (select count(*)::int from teams) as teams,
                (select count(*)::int from routing_rules) as rules`,
      )
    ).rows;
    assert.deepEqual(counts, { teams: 0, rules: 0 });
  });
});

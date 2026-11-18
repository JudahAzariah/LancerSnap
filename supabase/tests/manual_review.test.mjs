// LS-17: manual-review team and the reason a report is in review.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDatabase, createUser } from './helpers.mjs';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '20261119010000_manual_review.sql',
);
const STUDENT = '00000000-0000-0000-0000-000000000001';

let db;
let reportId;

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

before(async () => {
  db = await createDatabase();
  await createUser(db, STUDENT);
  const [location] = await rows('select id from locations limit 1');
  [{ id: reportId }] = await rows(
    'insert into reports (submitter_id, location_id) values ($1, $2) returning id',
    [STUDENT, location.id],
  );
});

describe('manual-review configuration', () => {
  it('seeds one dedicated review team, marked unverified', async () => {
    const review = await rows('select name, description from teams where is_manual_review');
    assert.deepEqual(
      review.map((t) => t.name),
      ['Manual review (example, unverified)'],
    );
    assert.match(review[0].description, /confirmed with CBU/);
  });

  it('allows only one review team at a time', async () => {
    await assert.rejects(
      db.query(`update teams set is_manual_review = true where name like 'Facilities%'`),
    );
  });

  it('does not add a second review team when the seed runs again', async () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    await db.exec(sql.slice(sql.indexOf('insert into public.teams')));
    const [{ n }] = await rows(`select count(*)::int as n from teams where name like 'Manual review%'`);
    assert.equal(n, 1);
  });
});

describe('review reason', () => {
  it('accepts only the known reasons', async () => {
    for (const reason of ['ai_failed', 'ai_unavailable', 'uncertain', 'no_category', 'no_matching_rule']) {
      await db.query('update reports set review_reason = $1 where id = $2', [reason, reportId]);
    }
    await assert.rejects(
      db.query(`update reports set review_reason = 'because' where id = $1`, [reportId]),
    );
  });

  it('is empty for a report that is not in review', async () => {
    await db.query('update reports set review_reason = null where id = $1', [reportId]);
    const [row] = await rows('select review_reason from reports where id = $1', [reportId]);
    assert.equal(row.review_reason, null);
  });
});

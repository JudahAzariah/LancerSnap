// LS-08: the report-media bucket is private and closed to direct client access.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { asRole, asUser, createDatabase, createUser } from './helpers.mjs';

const STUDENT = '00000000-0000-0000-0000-000000000001';

let db;

before(async () => {
  db = await createDatabase();
  await createUser(db, STUDENT);
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('report-media', $1)`,
    [`${STUDENT}/photo.jpg`],
  );
});

describe('report-media bucket', () => {
  it('exists, is private, and limits size and type', async () => {
    const { rows } = await db.query(`select * from storage.buckets where id = 'report-media'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].public, false);
    assert.equal(Number(rows[0].file_size_limit), 10 * 1024 * 1024);
    assert.deepEqual(rows[0].allowed_mime_types, [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
  });

  it('has no storage policies, so clients have no direct access', async () => {
    const { rows } = await db.query(
      `select policyname from pg_policies where schemaname = 'storage'`,
    );
    assert.deepEqual(rows, []);
  });

  it('a signed-in user cannot see or add files directly, even their own', async () => {
    await asUser(db, STUDENT, async () => {
      const { rows } = await db.query('select name from storage.objects');
      assert.deepEqual(rows, []);
      await assert.rejects(
        db.query(`insert into storage.objects (bucket_id, name) values ('report-media', 'x.jpg')`),
      );
    });
  });

  it('a signed-out caller cannot see files', async () => {
    await asRole(db, 'anon', async () => {
      const { rows } = await db.query('select name from storage.objects');
      assert.deepEqual(rows, []);
    });
  });
});

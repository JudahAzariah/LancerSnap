// LS-16: example teams and routing rules, clearly marked unverified (OQ-01).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDatabase } from './helpers.mjs';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '20261119000000_example_routing.sql',
);

let db;

async function rows(sql) {
  return (await db.query(sql)).rows;
}

before(async () => {
  db = await createDatabase();
});

describe('example routing configuration', () => {
  it('seeds the five SDD example teams, each labelled unverified', async () => {
    const teams = await rows('select name, description, is_active from teams order by name');
    assert.deepEqual(
      teams.map((t) => t.name),
      [
        'Building Administration (example, unverified)',
        'Dining (example, unverified)',
        'Facilities (example, unverified)',
        'Housing / Residential Assistants (example, unverified)',
        'IT / Technology Support (example, unverified)',
      ],
    );
    for (const team of teams) {
      assert.match(team.description, /Not confirmed CBU ownership/);
      assert.equal(team.is_active, true);
    }
  });

  it('maps only the four obvious categories, category-wide', async () => {
    const rules = await rows(`
      select c.name as category, t.name as team, r.location_id, r.is_active
      from routing_rules r
      join categories c on c.id = r.category_id
      join teams t on t.id = r.team_id
      order by c.name`);
    assert.deepEqual(
      rules.map((r) => [r.category, r.team]),
      [
        ['Dining or campus service-location issue', 'Dining (example, unverified)'],
        ['Facilities / maintenance issue', 'Facilities (example, unverified)'],
        ['Housing / residential issue', 'Housing / Residential Assistants (example, unverified)'],
        ['IT / technology problem', 'IT / Technology Support (example, unverified)'],
      ],
    );
    assert.ok(rules.every((r) => r.location_id === null && r.is_active));
  });

  it('leaves safety hazards and "other" without a rule, for manual review', async () => {
    const unmapped = await rows(`
      select c.name from categories c
      where not exists (select 1 from routing_rules r where r.category_id = c.id)
      order by c.name`);
    assert.deepEqual(
      unmapped.map((r) => r.name),
      ['Other supported campus issue', 'Potential safety hazard'],
    );
  });

  it('is safe to apply twice and never overrides an existing rule', async () => {
    // An administrator has pointed Facilities somewhere else.
    await db.exec(`
      update routing_rules set team_id = (select id from teams where name like 'Building%')
      where category_id = (select id from categories where name = 'Facilities / maintenance issue')`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));

    const [{ teams }] = await rows('select count(*)::int as teams from teams');
    const [{ rules }] = await rows('select count(*)::int as rules from routing_rules');
    assert.equal(teams, 5);
    assert.equal(rules, 4);
    const [facilities] = await rows(`
      select t.name from routing_rules r join teams t on t.id = r.team_id
      join categories c on c.id = r.category_id
      where c.name = 'Facilities / maintenance issue'`);
    assert.equal(facilities.name, 'Building Administration (example, unverified)');
  });
});

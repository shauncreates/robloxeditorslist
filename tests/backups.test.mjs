import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRankingBackup,prepareImportSql,fingerprint} from '../scripts/ranking-backup.mjs';
import {fixture,rankings} from './auth-fixture.mjs';

test('backup parsing never executes JavaScript and preserves ranked array ordering',()=>{
  const parsed=parseRankingBackup('/* backup */\nwindow.SITE_DATA = '+JSON.stringify(rankings)+';');
  assert.deepEqual(parsed,rankings);
  assert.throws(()=>parseRankingBackup('window.SITE_DATA = (()=>{throw Error("executed")})()'),/JSON5/);
  assert.throws(()=>parseRankingBackup('window.SITE_DATA = '+JSON.stringify(rankings)+'; process.exit()'),/JSON5/);
  const duplicate=structuredClone(rankings);duplicate.lists.main.push('editor1');
  assert.throws(()=>parseRankingBackup(JSON.stringify(duplicate)),/Duplicate/);
  const missing=structuredClone(rankings);missing.lists.main.push('nonexistent');
  assert.throws(()=>parseRankingBackup(JSON.stringify(missing)),/unknown/);
  const reordered=structuredClone(rankings);reordered.lists.main.reverse();
  assert.notEqual(fingerprint(rankings),fingerprint(reordered));
  assert.equal(fingerprint(rankings),fingerprint({lists:rankings.lists,editors:rankings.editors,styles:rankings.styles,site:rankings.site}));
});

test('prepared import fills an empty database once, preserves exact data and refuses overwrites',async()=>{
  const {db}=await fixture();
  try{
    const changed=structuredClone(rankings);changed.site.title="Imported ' title $rel_import$";
    const importSql=prepareImportSql(changed);
    await assert.rejects(db.exec(importSql),/REFUSED/);await db.exec('rollback');
    assert.deepEqual((await db.query('select data from public.roblox_editor_site_data')).rows[0].data,rankings);
    await db.exec('delete from public.roblox_editor_site_data'); // In-memory synthetic fixture only.
    await db.exec(importSql);
    const first=(await db.query('select data,revision,updated_at from public.roblox_editor_site_data')).rows[0];
    assert.deepEqual(first.data,changed);assert.equal(fingerprint(first.data),fingerprint(changed));
    await db.exec(importSql);
    assert.deepEqual((await db.query('select data,revision,updated_at from public.roblox_editor_site_data')).rows[0],first);
  }finally{await db.close()}
});

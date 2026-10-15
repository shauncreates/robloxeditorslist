import JSON5 from "json5";
import { createHash } from "node:crypto";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Backup contains a non-JSON number.');
  return JSON.stringify(value);
}
export const fingerprint = data => createHash('sha256').update(canonical(data)).digest('hex');

export function parseRankingBackup(source) {
  let object = source.trim();
  if (!object.startsWith('{')) {
    const match = object.match(/^(?:(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*)window\.SITE_DATA\s*=\s*([\s\S]*)$/);
    if (!match) throw new Error('Expected a JSON object or a data.js SITE_DATA assignment.');
    object = match[1].replace(/;\s*$/, '');
  }
  // Parse object literals; never import/eval/execute the attached JavaScript.
  const data = JSON5.parse(object);
  canonical(data);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.site || typeof data.site !== 'object' || Array.isArray(data.site) ||
      !Array.isArray(data.editors) || data.editors.length < 1 || data.editors.length > 300 ||
      !Array.isArray(data.styles) || data.styles.length < 1 || data.styles.length > 30 ||
      !data.lists || typeof data.lists !== 'object' || Array.isArray(data.lists) || !Array.isArray(data.lists.main)) throw new Error('Invalid ranking data shape.');
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  const editorIds = new Set(), styleIds = new Set();
  for (const editor of data.editors) {
    if (!id(editor.id) || editorIds.has(editor.id) || typeof editor.name !== 'string' || !editor.name.trim() || editor.name.length > 120) throw new Error('Invalid/duplicate editor ID or name.');
    editorIds.add(editor.id);
  }
  for (const style of data.styles) {
    if (!id(style.id) || style.id === 'main' || styleIds.has(style.id) || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 120 || !/^#[0-9a-fA-F]{6}$/.test(style.color)) throw new Error('Invalid/duplicate style.');
    styleIds.add(style.id);
  }
  for (const editor of data.editors) {
    if ('flares' in editor && (!Array.isArray(editor.flares) || editor.flares.some(flare=>!styleIds.has(flare)))) throw new Error('Unknown editor style reference.');
  }
  for (const [key,list] of Object.entries(data.lists)) {
    if (key !== 'main' && !styleIds.has(key)) throw new Error('Unknown ranked-list style: '+key);
    if (!Array.isArray(list) || new Set(list).size !== list.length || list.some(editor=>!editorIds.has(editor))) throw new Error('Duplicate or unknown ranking reference in '+key);
  }
  if (Buffer.byteLength(JSON.stringify(data)) > 500000) throw new Error('Backup is too large.');
  return data;
}

export function prepareImportSql(data) {
  const hash=fingerprint(data), delimiter='$rel_'+hash.slice(0,24)+'$', blockDelimiter='$rel_import_'+hash.slice(24,48)+'$';
  const json=JSON.stringify(data);
  if (json.includes(delimiter) || json.includes(blockDelimiter)) throw new Error('Unexpected SQL delimiter in backup.');
  return `-- REVIEW ONLY: execute only after explicit approval of the database project.
-- Prepared data SHA-256: ${hash}
-- Inserts only into an EMPTY ranking table. Never overwrites an existing record.
begin;
do ${blockDelimiter}
declare incoming jsonb := ${delimiter}${json}${delimiter}::jsonb; existing jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  lock table public.roblox_editor_site_data in share row exclusive mode;
  select data into existing from public.roblox_editor_site_data where id = 'site-data';
  if found then
    if existing = incoming then
      raise notice 'Identical rankings already stored; no changes made.';
      return;
    end if;
    raise exception 'REFUSED: saved rankings already exist. Export and compare them; this import will not overwrite them.';
  end if;
  insert into public.roblox_editor_site_data(id,data) values ('site-data',incoming);
  if (select data from public.roblox_editor_site_data where id = 'site-data') is distinct from incoming then
    raise exception 'Imported ranking verification failed.';
  end if;
end
${blockDelimiter};
commit;
`;
}

export async function prepareBackup(input, outputName) {
  if ((await stat(input)).size > 550000) throw new Error('Backup file is too large.');
  const source=await readFile(input), data=parseRankingBackup(source.toString('utf8'));
  const sourceSha256=createHash('sha256').update(source).digest('hex');
  const root=resolve(dirname(fileURLToPath(import.meta.url)), '..', 'private-backups');
  const output=resolve(root,outputName || sourceSha256.slice(0,16));
  const within=relative(root,output);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Output must be a new folder inside private-backups.');
  await mkdir(root,{recursive:true});
  await mkdir(output); // Refuse to reuse/overwrite an existing backup folder.
  const manifest={sourceSha256,dataSha256:fingerprint(data),editors:data.editors.length,styles:data.styles.length,
    lists:Object.fromEntries(Object.entries(data.lists).map(([key,list])=>[key,{count:list.length,order:list}])),
    updated:data.site.updated || null,remoteImportPerformed:false};
  for (const [name,contents] of [
    ['source-data.js',source],['rankings.json',JSON.stringify(data,null,2)+'\n'],
    ['manifest.json',JSON.stringify(manifest,null,2)+'\n'],['import-empty-database.sql',prepareImportSql(data)],
  ]) await writeFile(resolve(output,name),contents,{flag:'wx'});
  return {output,sourceSha256,dataSha256:manifest.dataSha256,editors:manifest.editors,styles:manifest.styles,
    lists:Object.fromEntries(Object.entries(manifest.lists).map(([key,value])=>[key,value.count]))};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/ranking-backup.mjs "path/to/data.js" [new-backup-folder]');
    console.log(JSON.stringify(await prepareBackup(process.argv[2],process.argv[3]),null,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}

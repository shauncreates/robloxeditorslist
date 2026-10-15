import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const limit=5*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const legacyPicture=url=>{
  try{const source=new URL(url);return source.protocol==='https:'&&/^[a-z0-9-]+\.(?:public|private)\.blob\.vercel-storage\.com$/i.test(source.hostname)}catch{return false}
};
async function imageBytes(response){
  if(!response.ok)throw Error('Picture request failed ('+response.status+').');
  const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!['image/png','image/jpeg','image/webp'].includes(mime))throw Error('Unsupported picture type.');
  if(Number(response.headers.get('content-length'))>limit)throw Error('Picture exceeds 5 MB.');
  const reader=response.body?.getReader();if(!reader)throw Error('Empty picture response.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Picture exceeds 5 MB.')}chunks.push(Buffer.from(value))}
  if(!size)throw Error('Empty picture response.');
  return{mime,bytes:Buffer.concat(chunks)};
}

export async function copyPicture(editor,{url,key,fetchImpl=fetch}){
  if(!legacyPicture(editor.thumb)||!/^[A-Za-z0-9_-]{1,80}$/.test(editor.id))throw Error('Invalid legacy picture or editor ID.');
  const base=new URL(url);
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.pathname!=='/'||base.username||base.password||!key)throw Error('Use the approved Supabase URL and server key.');
  const source=await imageBytes(await fetchImpl(editor.thumb,{redirect:'error'}));
  const path='avatars/'+editor.id+'/'+randomUUID();
  const uploaded=await fetchImpl(base.origin+'/storage/v1/object/editor-avatars/'+path,{
    method:'POST',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':source.mime,'Cache-Control':'3600'},body:source.bytes,
  });
  if(!uploaded.ok)throw Error('Storage upload failed ('+uploaded.status+').');
  const newUrl=base.origin+'/storage/v1/object/public/editor-avatars/'+path;
  const verified=await imageBytes(await fetchImpl(newUrl,{redirect:'error'}));
  if(verified.mime!==source.mime||hash(verified.bytes)!==hash(source.bytes))throw Error('Uploaded picture does not match the original.');
  return{editor_id:editor.id,old_url:editor.thumb,new_url:newUrl,bytes:source.bytes.length,sha256:hash(source.bytes)};
}

export function replacementSQL(report,origin){
  if(!/^[0-9a-f-]{36}$/.test(report.revision)||!/^[0-9a-f]{32}$/.test(report.fingerprint)||!report.changes.length||report.failures?.length)throw Error('Use a complete verified copy report.');
  const target=new URL(origin).origin;
  if(new Set(report.changes.map(c=>c.editor_id)).size!==report.changes.length)throw Error('Duplicate editor IDs.');
  for(const change of report.changes){
    if(!legacyPicture(change.old_url)||!/^[A-Za-z0-9_-]{1,80}$/.test(change.editor_id)||!change.new_url.startsWith(target+'/storage/v1/object/public/editor-avatars/avatars/'+change.editor_id+'/')||!/^[0-9a-f]{64}$/.test(change.sha256))throw Error('Invalid verified picture change.');
  }
  const changes=JSON.stringify(report.changes).replace(/'/g,"''");
  let tag='$rel_avatar_retirement$';while(changes.includes(tag))tag=tag.replace('$rel_', '$rel_x');
  return `begin;
do ${tag}
declare previous public.roblox_editor_site_data; next_data jsonb; change jsonb; idx integer; core_before jsonb; core_after jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  select * into previous from public.roblox_editor_site_data where id='site-data' for update;
  if not found or previous.revision <> '${report.revision}'::uuid or md5(previous.data::text) <> '${report.fingerprint}' then raise exception 'REL_CONFLICT'; end if;
  next_data := previous.data;
  for change in select * from jsonb_array_elements('${changes}'::jsonb) loop
    select ordinality::integer-1 into idx from jsonb_array_elements(next_data->'editors') with ordinality
      where value->>'id'=change->>'editor_id' and value->>'thumb'=change->>'old_url';
    if not found then raise exception 'REL_CONFLICT'; end if;
    next_data := jsonb_set(next_data,array['editors',idx::text,'thumb'],to_jsonb(change->>'new_url'),false);
  end loop;
  select jsonb_set(previous.data,'{editors}',jsonb_agg(value-'thumb' order by ordinality)) into core_before from jsonb_array_elements(previous.data->'editors') with ordinality;
  select jsonb_set(next_data,'{editors}',jsonb_agg(value-'thumb' order by ordinality)) into core_after from jsonb_array_elements(next_data->'editors') with ordinality;
  if core_before is distinct from core_after or not rel_private.validate_data(next_data) then raise exception 'REL_INVALID'; end if;
  insert into rel_private.data_history(revision,data,actor_id) values(previous.revision,previous.data,null);
  update public.roblox_editor_site_data set data=next_data,revision=gen_random_uuid(),updated_at=now() where id='site-data';
  insert into rel_private.audit(actor_id,action,target,details) values(null,'retire_legacy_avatar_urls','site-data',jsonb_build_object('count',${report.changes.length},'previous_revision',previous.revision,'source','user-approved maintenance'));
  insert into rel_private.audit(actor_id,action,target,details) values(null,'legacy_avatar_copy_manifest','site-data',jsonb_build_object('previous_revision',previous.revision,'pictures','${changes}'::jsonb));
end ${tag};
commit;
`;
}

function privatePath(value){
  const root=resolve(fileURLToPath(new URL('../private-backups/',import.meta.url))),path=resolve(value||'');
  const part=relative(root,path);
  if(!part||part.startsWith('..')||isAbsolute(part))throw Error('Snapshots and reports must stay under private-backups.');
  return path;
}
async function main(){
  if(process.argv[2]!=='--upload')throw Error('Use --upload followed by a private snapshot and report path. This uploads pictures but never updates rankings.');
  const snapshot=JSON.parse(await readFile(privatePath(process.argv[3]),'utf8'));
  const reportPath=privatePath(process.argv[4]);
  const report={revision:snapshot.revision,fingerprint:snapshot.fingerprint,changes:[],failures:[]};
  const editors=snapshot.data.editors.filter(e=>legacyPicture(e.thumb));
  for(const editor of editors){
    try{report.changes.push(await copyPicture(editor,{url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}))}
    catch(error){report.failures.push({editor_id:editor.id,error:error.message})}
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    console.log(`${report.changes.length} copied and verified; ${report.failures.length} failed; ${editors.length} total.`);
  }
  if(report.failures.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1});

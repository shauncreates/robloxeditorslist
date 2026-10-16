// Read-only public checks and unauthenticated requests that must be rejected.
// No signups, emails, credentials, cookies, ranking edits or role assignments.
const base = new URL(process.argv[2] || 'http://127.0.0.1:8788');
if (!['http:','https:'].includes(base.protocol) || base.username || base.password) throw new Error('Use a website URL without credentials.');
async function check(path,method,status){
  const response=await fetch(new URL(path,base),{
    method,redirect:'manual',headers:{Origin:base.origin,'Content-Type':'application/json'},
    ...(method==='POST'?{body:'{}'}:{}),
  });
  if(response.status!==status)throw new Error(`${method} ${path}: expected ${status}, received ${response.status}`);
  console.log(`PASS ${method} ${path}: ${status}`);return response;
}
try{
  await check('/signin/','GET',200);
  const data=await(await check('/api/data','GET',200)).json();
  if(!Array.isArray(data.editors)||!Array.isArray(data.styles)||!data.lists)throw new Error('Invalid ranking response.');
  console.log(JSON.stringify({editors:data.editors.length,styles:data.styles.length,lists:Object.fromEntries(Object.entries(data.lists).map(([key,list])=>[key,list.length]))}));
  await check('/api/auth/session','GET',401);
  for(const path of ['/api/save','/api/avatar','/api/applications','/api/applications/admin','/api/applications/notifications','/api/account/users','/api/account/profile','/api/account/claim','/api/account/youtube/start','/api/account/youtube'])await check(path,'POST',401);
  for(const path of ['/api/account/applications','/api/account/activity','/api/account/youtube'])await check(path,'GET',401);
  const crossOrigin=await fetch(new URL('/api/save',base),{method:'POST',headers:{Origin:'https://rel-test.invalid','Content-Type':'application/json'},body:'{}'});
  if(crossOrigin.status!==403)throw new Error('Cross-origin save was not denied.');
  console.log('PASS cross-origin save: 403');
}catch(error){console.error(error.message);process.exitCode=1;}

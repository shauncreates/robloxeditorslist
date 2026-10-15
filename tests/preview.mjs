// Local UI fixture only: no real Auth emails, credentials or Supabase connection.
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {mockService} from "./mock-service.mjs";
const service=await mockService();
const port=Number(process.env.REL_PREVIEW_PORT||8789);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Use a valid local fixture port.");
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://127.0.0.1:"+port);
    if(['/apply','/account','/profile','/admin','/reset-password','/email-verified','/changelog'].includes(url.pathname)){res.writeHead(301,{Location:url.pathname+'/'+url.search});return res.end()}
    const emailTemplate={"/test-email/signup/":"confirm-signup","/test-email/recovery/":"reset-password"}[url.pathname];
    if(emailTemplate){
      const html=(await readFile(new URL('../supabase/email-templates/'+emailTemplate+'.html',import.meta.url),'utf8'))
        .replaceAll('{{ .SiteURL }}',url.origin)
        .replaceAll('{{ .ConfirmationURL }}',url.origin+'/email-verified/#access_token=member')
        .replaceAll('{{ .RedirectTo }}',url.origin+'/reset-password/')
        .replaceAll('{{ .Token }}','123456')
        .replaceAll('https://robloxeditors.com/media/logo.svg',url.origin+'/media/logo.svg');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);
    }
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await service.handle(new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
      res.writeHead(response.status,{...Object.fromEntries(response.headers),...(response.headers.getSetCookie().length?{'set-cookie':response.headers.getSetCookie()}:{})});
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(file.endsWith('/'))file+='index.html';
    if(!/^(index\.html|data\.js|(?:admin|account|profile|signin|list|apply|reset-password|email-verified|changelog)\/index\.html|(?:assets|media)\/[a-zA-Z0-9_-]+\.(?:js|css|svg))$/.test(file)){
      res.writeHead(404);return res.end('Not found');
    }
    if(file==='admin/index.html'){
      const response=await service.handleAdmin(new Request(url,{headers:req.headers}),async()=>new Response(await readFile(new URL('../'+file,import.meta.url)),{headers:{'Content-Type':'text/html; charset=utf-8'}}));
      res.writeHead(response.status,{...Object.fromEntries(response.headers),...(response.headers.getSetCookie().length?{'set-cookie':response.headers.getSetCookie()}:{})});
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const content=await readFile(new URL('../'+file,import.meta.url));
    const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/svg+xml';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(content);
  }catch{res.writeHead(500);res.end('Fixture error');}
});
server.listen(port,'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:'+port+'/signin/; owner/member/contributor/reviewer/stranger@example.test, password test-password-123'));
process.on('SIGINT',()=>server.close(async()=>{await service.close();process.exit(0)}));

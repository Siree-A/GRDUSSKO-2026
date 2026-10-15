// Isolated QA preview. No Supabase keys, cloud requests, or production reports are used.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const allowed=new Set(['index.html','report-1.html','report-2.html','report-3.html','report-4.html','report-editor.js','report-editor.css','report-analysis.js','favicon.svg']);
http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  res.setHeader('Cache-Control','no-store');
  if(name==='supabase-config.js'){res.setHeader('Content-Type','application/javascript');return res.end('window.SUPABASE_CONFIG={};');}
  if(!allowed.has(name)){res.writeHead(404);return res.end('Not found');}
  const file=path.join(root,name);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'application/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml');
  let content=fs.readFileSync(file);if(name==='index.html')content=content.toString().replace(/<script src="https:\/\/cdn.jsdelivr.net\/npm\/@supabase\/supabase-js@2"><\/script>/,'');
  res.end(content);
}).listen(4177,'127.0.0.1',()=>console.log('Isolated QA preview http://127.0.0.1:4177 (cloud disabled)'));

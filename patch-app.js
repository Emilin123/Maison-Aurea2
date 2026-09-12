import fs from 'node:fs';
const p='app.js';
let s=fs.readFileSync(p,'utf8');
const old="if(req.method==='GET'&&(req.url==='/'||req.url==='/app'))return out(res,200,HTML,'text/html');if(req.url.startsWith('/api/'))return api(req,res);return out(res,404,{error:'not_found'})";
const neu="const path=new URL(req.url,'http://localhost').pathname;if(req.method==='GET'&&(path==='/'||path==='/app'))return out(res,200,HTML,'text/html');if(path.startsWith('/api/'))return api(req,res);return out(res,404,{error:'not_found'})";
if(s.includes(old)) s=s.replace(old,neu);
if(!s.includes("APP+'/?v=20260912-1306'")) s=s.replace("web_app:{url:APP}","web_app:{url:APP+'/?v=20260912-1306'}");
fs.writeFileSync(p,s);
console.log('Maison Aurea route/cache patch applied or already present');

import fs from 'node:fs';
const path='server.js';
let s=fs.readFileSync(path,'utf8');
const old="function card(a,b,button,fn){const el='<div class=\"card\"><b>'+esc(a)+'</b><div class=\"muted\">'+esc(b)+'</div><button class=\"btn\">'+esc(button)+'</button></div>';const wrap=document.createElement('div');wrap.innerHTML=el;wrap.firstElementChild.querySelector('button').addEventListener('click',fn);return wrap.innerHTML}";
const replacement="function card(a,b,button,fn){const el='<div class=\"card\"><b>'+esc(a)+'</b><div class=\"muted\">'+esc(b)+'</div><button class=\"btn\" type=\"button\">'+esc(button)+'</button></div>';const wrap=document.createElement('div');wrap.innerHTML=el;const root=wrap.firstElementChild;root.querySelector('button').onclick=fn;return root.outerHTML}";
if(!s.includes(old)){console.log('UI patch: function already patched or pattern not found');process.exit(0)}
s=s.replace(old,replacement);
fs.writeFileSync(path,s);
console.log('UI patch: internal catalog buttons fixed');

import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('./app_fixed.js',import.meta.url),'utf8');
// Force Telegram Mini App clients to fetch the latest frontend after each fix.
const patched=source.replaceAll('v=20260912.7','v=20260912.8');
const runtime=new URL('./.maison-aurea-runtime.mjs',import.meta.url);
await fs.writeFile(runtime,patched+'\n}\nmain();\n','utf8');
await import(runtime.href);

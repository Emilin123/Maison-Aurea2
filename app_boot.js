import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('./app_fixed.js',import.meta.url),'utf8');
const runtime=new URL('./.maison-aurea-runtime.mjs',import.meta.url);
await fs.writeFile(runtime,source+'\n}\nmain();\n','utf8');
await import(runtime.href);

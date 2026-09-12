import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.BOT_TOKEN || process.env.maison_aurea_bot_token || '';
const APP = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
const APP_VERSION = '20260912-1258';
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const catalog = {
  mining_packages: [
    ['initial','Inicial',500,100,3,120], ['basic','Básico',2500,500,4,650],
    ['large','Grande',5000,1000,5,1350], ['premium','Premium',12500,2500,6,3500],
    ['maximum','Máximo',25000,5000,7,7500]
  ].map(([id,name,price_cup,diamonds,duration_days,reference_reward_diamonds]) =>
    ({id,name,price_cup,diamonds,duration_days,reference_reward_diamonds})),
  memberships: [
    ['bronze','Bronce',100,3,5], ['silver','Plata',250,4,10], ['gold','Oro',500,5,20],
    ['platinum','Platino',1000,6,35], ['diamond','Diamante',2500,7,50]
  ].map(([id,name,price_diamonds,duration_days,bonus_percent]) =>
    ({id,name,price_diamonds,duration_days,bonus_percent})),
  accelerators: [
    ['quartz','Cuarzo',100,2], ['ruby','Rubí',150,3], ['sapphire','Zafiro',200,4],
    ['supercluster','Supercluster',250,6], ['titan_reactor','Reactor Titán',300,0]
  ].map(([id,name,price_diamonds,speed_multiplier]) =>
    ({id,name,price_diamonds,speed_multiplier,instant_complete:id==='titan_reactor'}))
};

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Maison Aurea</title>
<script src="https://telegram.org/js/telegram-web-app.js?63"></script>
<style>
:root{--bg:#0d0b14;--panel:#171321;--line:#3a3047;--gold:#e9c46a;--muted:#aaa;--ok:#69d391;--danger:#ff7373}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:16px;padding-bottom:28px}
h1{margin:0;color:var(--gold);font-size:34px}.sub{color:var(--muted);margin-top:3px}
.top{position:sticky;top:0;background:rgba(13,11,20,.96);z-index:5;padding:5px 0 12px}
.wallet{margin-top:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px;margin:10px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid .card{margin:0}
button{font:inherit}.btn{display:block;width:100%;border:0;border-radius:11px;padding:11px;margin-top:10px;background:var(--gold);color:#111;font-weight:800}
.btn.secondary{background:#2a2333;color:#fff;border:1px solid var(--line)}.btn.danger{background:#7b3030;color:#fff}
.nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.nav button{border:1px solid var(--line);background:#211b2b;color:#fff;border-radius:11px;padding:10px;font-weight:700}
.section{display:none}.section.active{display:block}.price{font-size:20px;font-weight:800;color:var(--gold)}.muted{color:var(--muted)}
.msg{margin:12px 0;padding:12px;border-radius:12px;background:#201a2b}.err{color:var(--danger)}.ok{color:var(--ok)}
.list{display:grid;gap:10px}.back{margin-bottom:10px}.row{display:flex;justify-content:space-between;gap:12px}.pill{border-radius:99px;padding:4px 9px;background:#2a2333;color:#ddd;font-size:12px}
input{width:100%;padding:11px;border-radius:10px;border:1px solid var(--line);background:#0f0c15;color:#fff}
@media(max-width:420px){body{padding:13px}.grid{grid-template-columns:1fr}h1{font-size:30px}}
</style>
</head>
<body>
<div class="top">
  <h1>Maison Aurea</h1><div class="sub">Diamantes · minería virtual · cartas</div>
  <div id="wallet" class="card wallet">Conectando con Telegram…</div>
</div>
<div id="msg" class="msg">Listo.</div>
<div id="home" class="section active">
  <div class="nav">
    <button onclick="show('mining')">⛏️ Minar</button>
    <button onclick="show('cards')">🃏 Cartas ganadoras</button>
    <button onclick="show('diamonds')">💎 Comprar diamantes</button>
    <button onclick="show('wallets')">👛 Mi billetera</button>
    <button onclick="show('referrals')">👥 Invitar amigos</button>
    <button onclick="show('memberships')">💎 Membresías</button>
    <button onclick="show('accelerators')">⚡ Aceleradores</button>
    <button onclick="show('history')">📜 Historial</button>
    <button onclick="show('support')">🛟 Soporte</button>
    <button onclick="show('rules')">📋 Reglas</button>
    <button onclick="show('settings')">⚙️ Ajustes</button>
  </div>
</div>
<div id="mining" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>⛏️ Minar</h2><div id="miningList" class="list">Cargando…</div></div>
<div id="diamonds" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>💎 Comprar diamantes</h2><p class="muted">Compra mediante Transfermóvil o EnZona. La acreditación se realiza solo después de la aprobación administrativa.</p><div id="diamondList" class="list"></div></div>
<div id="memberships" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>💎 Membresías</h2><div id="membershipList" class="list"></div></div>
<div id="accelerators" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>⚡ Aceleradores</h2><div id="acceleratorList" class="list"></div></div>
<div id="cards" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>🃏 Cartas ganadoras</h2><div id="cardsBox" class="card">Cargando…</div></div>
<div id="wallets" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>👛 Mi billetera</h2><div id="walletBox" class="card">Cargando…</div></div>
<div id="history" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>📜 Historial</h2><div id="historyBox" class="list">Cargando…</div></div>
<div id="referrals" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>👥 Invitar amigos</h2><div id="refBox" class="card">Cargando…</div></div>
<div id="support" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>🛟 Soporte</h2><div class="card"><p>Para pagos: envía comprobante y número de operación al soporte.</p><p class="muted">No envíes contraseñas ni códigos de acceso.</p></div></div>
<div id="rules" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>📋 Reglas y condiciones</h2><div class="card"><p>• Una sola minería activa por usuario.</p><p>• El servidor controla duración y recompensas.</p><p>• Los resultados de cartas se deciden en servidor.</p><p>• Los pagos manuales requieren comprobante y aprobación.</p><p>• Los diamantes promocionales no son retirables.</p></div></div>
<div id="settings" class="section"><button class="btn secondary back" onclick="show('home')">← Inicio</button><h2>⚙️ Ajustes</h2><div class="card"><p>Telegram: <b id="tgStatus">verificando…</b></p><button class="btn secondary" onclick="tg?.expand();msg('Mini App ampliada.')">↕️ Ampliar</button></div></div>

<script>
const tg=window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const init=tg?.initData||'';
const q=s=>document.querySelector(s);
function msg(x,err=false){q('#msg').innerHTML=err?'<span class="err">'+esc(x)+'</span>':esc(x)}
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function api(url,opt={}){opt.headers={...(opt.headers||{}),'x-telegram-init-data':init,'content-type':'application/json'};const r=await fetch(url,opt);let j={};try{j=await r.json()}catch{}if(!r.ok)throw Error(j.error||'Error '+r.status);return j}
function show(id){document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));q('#'+id).classList.add('active');if(id==='mining'||id==='diamonds')loadCatalog();if(id==='memberships'||id==='accelerators')loadCatalog();if(id==='cards')loadCards();if(id==='wallets')loadWallet();if(id==='history')loadHistory();if(id==='referrals')loadRefs();history.replaceState(null,'',location.pathname+'?section='+id+'&v='+Date.now());window.scrollTo(0,0)}
async function loadMe(){try{const x=await api('/api/me');q('#wallet').innerHTML='<b>Hola, '+esc(x.first_name||'amigo')+'</b><div class="row"><span>💎 Comprados</span><b>'+x.purchased_diamonds+'</b></div><div class="row"><span>🎁 Promo</span><b>'+x.promotional_diamonds+'</b></div><div class="row"><span>🔒 Bloqueados</span><b>'+x.locked_diamonds+'</b></div><div class="row"><span>💰 CUP disponible</span><b>'+x.available_cup+'</b></div>';q('#tgStatus').textContent='conectado'}catch(e){msg(e.message,true);q('#tgStatus').textContent='sin sesión'}}
async function loadCatalog(){try{const c=await api('/api/catalog');q('#miningList').innerHTML=c.mining_packages.map(p=>card('⛏️ '+p.name,p.price_cup+' CUP · '+p.diamonds+' 💎 · '+p.duration_days+' días','Comprar',()=>order('mining',p.id))).join('');q('#diamondList').innerHTML=c.mining_packages.map(p=>card('💎 '+p.diamonds+' diamantes',p.price_cup+' CUP · paquete '+p.name,'Crear orden',()=>order('mining',p.id))).join('');q('#membershipList').innerHTML=c.memberships.map(p=>card('💎 Membresía '+p.name,p.price_diamonds+' 💎 · '+p.duration_days+' días · +'+p.bonus_percent+'%','Solicitar',()=>order('membership',p.id))).join('');q('#acceleratorList').innerHTML=c.accelerators.map(p=>card('⚡ '+p.name,p.price_diamonds+' 💎 · '+(p.instant_complete?'instantáneo':p.speed_multiplier+'×'),'Solicitar',()=>order('accelerator',p.id))).join('')}catch(e){['miningList','diamondList','membershipList','acceleratorList'].forEach(id=>q('#'+id).innerHTML='<div class="card err">'+esc(e.message)+'</div>')}}
function card(a,b,button,fn){const el='<div class="card"><b>'+esc(a)+'</b><div class="muted">'+esc(b)+'</div><button class="btn">'+esc(button)+'</button></div>';const wrap=document.createElement('div');wrap.innerHTML=el;wrap.firstElementChild.querySelector('button').addEventListener('click',fn);return wrap.innerHTML}
async function order(k,id){try{const x=await api('/api/orders',{method:'POST',body:JSON.stringify({kind:k,catalog_id:id})});msg('Orden '+x.order_no+' creada. '+x.instructions);tg?.HapticFeedback?.notificationOccurred('success')}catch(e){msg(e.message,true)}}
async function loadCards(){try{const x=await api('/api/cards');q('#cardsBox').innerHTML='<b>Ventana:</b> '+esc(x.window)+'<br><b>Entradas:</b> '+x.entries+'<br><b>Cuota:</b> '+x.quota+'<br><p class="muted">Entrada 100 💎 · sorteos 12:00 y 22:00 (Cuba).</p>'}catch(e){q('#cardsBox').textContent=e.message)}}
async function loadWallet(){try{const x=await api('/api/me');q('#walletBox').innerHTML='<div class="row"><span>💎 Comprados</span><b>'+x.purchased_diamonds+'</b></div><div class="row"><span>🎁 Promo</span><b>'+x.promotional_diamonds+'</b></div><div class="row"><span>🔒 Bloqueados</span><b>'+x.locked_diamonds+'</b></div><div class="row"><span>💰 CUP disponible</span><b>'+x.available_cup+'</b></div><div class="row"><span>💸 CUP pagado</span><b>'+x.paid_cup+'</b></div>'}catch(e){q('#walletBox').textContent=e.message}}
async function loadHistory(){try{const x=await api('/api/history');q('#historyBox').innerHTML=x.orders.length?x.orders.map(o=>'<div class="card"><div class="row"><b>'+esc(o.order_no)+'</b><span class="pill">'+esc(o.status)+'</span></div><div>'+esc(o.kind)+' · '+esc(o.catalog_id)+'</div><small>'+esc(o.created_at)+'</small></div>').join(''):'<div class="card muted">No hay órdenes todavía.</div>'}catch(e){q('#historyBox').textContent=e.message}}
async function loadRefs(){try{const x=await api('/api/referrals');q('#refBox').innerHTML='<b>Código:</b> '+esc(x.code)+'<p>'+esc(x.link)+'</p><button class="btn" onclick="copyRef()">📋 Copiar enlace</button><p class="muted">Recompensa: 50 diamantes promo después de la primera orden aprobada del referido. Sin recompensa por solo registrarse.</p>'}catch(e){q('#refBox').textContent=e.message}}
async function copyRef(){const x=await api('/api/referrals');await navigator.clipboard?.writeText(x.link);msg('Enlace copiado.')}
window.addEventListener('load',async()=>{await loadMe();const sec=new URLSearchParams(location.search).get('section');if(sec&&q('#'+sec))show(sec);else await loadCatalog()});
</script>
</body></html>`;

const schema = `
create table if not exists users(
 id bigserial primary key, telegram_user_id text unique not null, username text,
 first_name text, referral_code text unique not null, created_at timestamptz default now()
);
create table if not exists wallets(
 user_id bigint primary key references users(id), purchased_diamonds bigint default 0,
 promotional_diamonds bigint default 0, locked_diamonds bigint default 0,
 available_cup bigint default 0, paid_cup bigint default 0
);
create table if not exists orders(
 id bigserial primary key, order_no text unique not null, user_id bigint references users(id),
 kind text not null, catalog_id text not null, amount_cup bigint not null default 0,
 diamonds bigint default 0, status text default 'pending_payment', snapshot jsonb,
 created_at timestamptz default now()
);
create table if not exists mining_sessions(
 id bigserial primary key, user_id bigint references users(id), package_id text,
 started_at timestamptz, ends_at timestamptz, status text default 'running', snapshot jsonb
);
create unique index if not exists one_active_mining on mining_sessions(user_id) where status='running';
create table if not exists referrals(
 id bigserial primary key, referrer_id bigint references users(id),
 referred_id bigint unique references users(id), status text default 'registered'
);
create table if not exists audit_log(
 id bigserial primary key, actor text, action text, entity text, created_at timestamptz default now()
);`;

async function db(sql, params=[]){if(!pool) throw Error('DATABASE_URL no configurada');return pool.query(sql,params)}
async function init(){if(pool) await db(schema)}

function validInitData(data){
 if(!data||!TOKEN) return false;
 const p=new URLSearchParams(data),received=p.get('hash');
 if(!received||!/^[0-9a-f]{64}$/i.test(received)) return false;
 p.delete('hash');
 const check=[...p].sort().map(([k,v])=>k+'='+v).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(TOKEN).digest();
 const calc=crypto.createHmac('sha256',secret).update(check).digest('hex');
 return crypto.timingSafeEqual(Buffer.from(calc,'hex'),Buffer.from(received,'hex'));
}

async function user(req){
 const data=req.headers['x-telegram-init-data'];
 if(!validInitData(data)) return null;
 const p=new URLSearchParams(data),auth=Number(p.get('auth_date')||0);
 if(!auth||Date.now()/1000-auth>86400) return null;
 let tgUser;try{tgUser=JSON.parse(p.get('user')||'null')}catch{return null}
 if(!tgUser?.id) return null;
 let r=await db('select * from users where telegram_user_id=$1',[String(tgUser.id)]);
 if(r.rowCount) return r.rows[0];
 const code=crypto.randomBytes(5).toString('hex').toUpperCase();
 r=await db('insert into users(telegram_user_id,username,first_name,referral_code) values($1,$2,$3,$4) returning *',[String(tgUser.id),tgUser.username||null,tgUser.first_name||'',code]);
 await db('insert into wallets(user_id) values($1)',[r.rows[0].id]);
 return r.rows[0];
}

async function bot(method,payload){
 if(!TOKEN) throw Error('BOT_TOKEN no configurado');
 const r=await fetch('https://api.telegram.org/bot'+TOKEN+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 const j=await r.json();if(!j.ok) throw Error(j.description||'Telegram API error');return j;
}
function appUrl(section='home'){return APP+'/?section='+encodeURIComponent(section)+'&v='+APP_VERSION}

async function configureTelegram(){
 if(!TOKEN){console.error('Telegram: falta BOT_TOKEN/maison_aurea_bot_token');return}
 if(!APP){console.error('Telegram: falta PUBLIC_APP_URL');return}
 try{
  const me=await bot('getMe',{});
  await bot('setWebhook',{url:APP+'/telegram/webhook',allowed_updates:['message'],drop_pending_updates:false});
  await bot('setChatMenuButton',{menu_button:{type:'web_app',text:'Maison Aurea',web_app:{url:appUrl('home')}}});
  await bot('setMyCommands',{commands:[
   {command:'start',description:'Abrir Maison Aurea'},
   {command:'minar',description:'Ver minería'},
   {command:'cartas',description:'Ver cartas ganadoras'},
   {command:'billetera',description:'Ver mi billetera'},
   {command:'referidos',description:'Invitar amigos'},
   {command:'soporte',description:'Soporte'}
  ]});
  console.log('Telegram conectado:',me.result.username,'webhook:',APP+'/telegram/webhook');
 }catch(e){console.error('Telegram webhook ERROR:',e.message)}
}

function keyboard(){
 const b=(text,section)=>({text,web_app:{url:appUrl(section)}});
 return {keyboard:[
  [b('💎 Abrir Maison Aurea','home')],
  [b('⛏️ Minar','mining'),b('🃏 Cartas ganadoras','cards')],
  [b('💎 Comprar diamantes','diamonds'),b('👛 Mi billetera','wallets')],
  [b('👥 Invitar amigos','referrals'),b('💎 Membresías','memberships')],
  [b('⚡ Aceleradores','accelerators'),b('📜 Historial','history')],
  [b('🛟 Soporte','support'),b('⚙️ Ajustes','settings')]
 ],resize_keyboard:true,is_persistent:true};
}
async function sendStart(chat,u){
 return bot('sendMessage',{chat_id:chat,text:'✨ Bienvenido a Maison Aurea, '+(u.first_name||'amigo')+'!\n\nUsa los botones para entrar directamente en cada sección.',reply_markup:keyboard()});
}
async function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}})})}
function out(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))}

const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/health') return out(res,200,{ok:true,app:'Maison Aurea',telegram:Boolean(TOKEN),database:Boolean(pool)});
  if(req.method==='GET'&&(req.url==='/'||req.url.startsWith('/?'))){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache'});return res.end(html)}
  if(req.method==='POST'&&req.url==='/telegram/webhook'){
   const b=await body(req),m=b.message,t=(m?.text||'').trim();
   if(t.startsWith('/start')) await sendStart(m.chat.id,m.from||{});
   else if(t==='/minar'||t==='⛏️ Minar') await bot('sendMessage',{chat_id:m.chat.id,text:'⛏️ Minar',reply_markup:{inline_keyboard:[[{text:'Abrir Minar',web_app:{url:appUrl('mining')}}]]}});
   else if(t==='/cartas'||t==='🃏 Cartas ganadoras') await bot('sendMessage',{chat_id:m.chat.id,text:'🃏 Cartas ganadoras',reply_markup:{inline_keyboard:[[{text:'Abrir Cartas',web_app:{url:appUrl('cards')}}]]}});
   else if(t==='/billetera'||t==='👛 Mi billetera') await bot('sendMessage',{chat_id:m.chat.id,text:'👛 Mi billetera',reply_markup:{inline_keyboard:[[{text:'Abrir Billetera',web_app:{url:appUrl('wallets')}}]]}});
   else if(t==='/referidos'||t==='👥 Invitar amigos') await bot('sendMessage',{chat_id:m.chat.id,text:'👥 Invitar amigos',reply_markup:{inline_keyboard:[[{text:'Abrir Referidos',web_app:{url:appUrl('referrals')}}]]}});
   else if(t==='/soporte'||t==='🛟 Soporte') await bot('sendMessage',{chat_id:m.chat.id,text:'🛟 Soporte',reply_markup:{inline_keyboard:[[{text:'Abrir Soporte',web_app:{url:appUrl('support')}}]]}});
   else if(t==='💎 Comprar diamantes'||t==='💎 Membresías'||t==='⚡ Aceleradores'||t==='📜 Historial'||t==='⚙️ Ajustes'){
    const map={'💎 Comprar diamantes':'diamonds','💎 Membresías':'memberships','⚡ Aceleradores':'accelerators','📜 Historial':'history','⚙️ Ajustes':'settings'};
    const sec=map[t]; await bot('sendMessage',{chat_id:m.chat.id,text:t,reply_markup:{inline_keyboard:[[{text:'Abrir sección',web_app:{url:appUrl(sec)}}]]}});
   }
   return out(res,200,{ok:true});
  }
  if(req.url==='/api/catalog') return out(res,200,catalog);
  const u=await user(req);if(!u) return out(res,401,{error:'Abre Maison Aurea desde Telegram'});
  if(req.url==='/api/me'){const w=(await db('select * from wallets where user_id=$1',[u.id])).rows[0]||{};return out(res,200,{first_name:u.first_name,telegram_user_id:u.telegram_user_id,...w})}
  if(req.url==='/api/history'){const r=await db('select order_no,kind,catalog_id,status,created_at from orders where user_id=$1 order by id desc limit 50',[u.id]);return out(res,200,{orders:r.rows})}
  if(req.url==='/api/referrals') return out(res,200,{code:u.referral_code,link:'https://t.me/MaisonAureaGameBot?start=ref_'+u.referral_code});
  if(req.url==='/api/cards'){const now=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Havana'}));const h=now.getHours(),window=h>=14?'14:00-22:00':'08:00-12:00';const confirmed=Number((await db("select count(*)::int n from orders where status='approved'")).rows[0]?.n||0);return out(res,200,{window,entries:0,quota:Math.min(10,Math.ceil(confirmed/50)),entry_cost:100})}
  if(req.method==='POST'&&req.url==='/api/orders'){
   const b=await body(req),source=b.kind==='mining'?'mining_packages':b.kind==='membership'?'memberships':'accelerators',c=(catalog[source]||[]).find(x=>x.id===b.catalog_id);
   if(!c) return out(res,400,{error:'Producto no encontrado'});
   const amount=c.price_cup||0,diamonds=c.diamonds||c.price_diamonds||0,orderNo='MA-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
   await db('insert into orders(order_no,user_id,kind,catalog_id,amount_cup,diamonds,status,snapshot) values($1,$2,$3,$4,$5,$6,$7,$8)',[orderNo,u.id,b.kind,b.catalog_id,amount,diamonds,'pending_payment',JSON.stringify(c)]);
   return out(res,201,{order_no:orderNo,instructions:amount?('Paga '+amount+' CUP por Transfermóvil/EnZona y envía comprobante + número de operación al soporte.'):'Confirma el uso de tus diamantes con el administrador.'});
  }
  return out(res,404,{error:'Ruta no encontrada'});
 }catch(e){console.error('REQUEST ERROR:',e.stack||e.message);return out(res,500,{error:e.message||'Error interno'})}
});

init().then(()=>{server.listen(PORT,()=>console.log('Maison Aurea listening on',PORT));configureTelegram()}).catch(e=>{console.error('INIT ERROR:',e.stack||e.message);server.listen(PORT,()=>console.log('Maison Aurea listening on',PORT));configureTelegram()});

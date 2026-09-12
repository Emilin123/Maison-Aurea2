import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const APP_URL = (process.env.PUBLIC_APP_URL || 'https://maison-aurea2-1.onrender.com').replace(/\/$/, '');
const CREATOR_ID = String(process.env.CREATOR_TELEGRAM_USER_ID || '7519855566');
const WA = String(process.env.WHATSAPP_NUMBER || '5355720394').replace(/\D/g, '');
const EMAIL = process.env.SUPPORT_EMAIL || 'nunezyenis05@gmail.com';
const PAYMENT_INFO = process.env.PAYMENT_INFO || 'Solicita las instrucciones de pago por WhatsApp.';
const PAYMENT_CARD_NUMBER = String(process.env.PAYMENT_CARD_NUMBER || '').trim();
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const NOTIFY_TEST_SECRET = process.env.NOTIFY_TEST_SECRET || '';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

// Keep the payment destination server-side. Never hard-code it into the repository.
const paymentInstructions = () => PAYMENT_CARD_NUMBER
  ? `💳 Tarjeta para el pago: ${PAYMENT_CARD_NUMBER}\n${PAYMENT_INFO}`
  : PAYMENT_INFO;

const CATALOG = {
  mining_packages: [
    { id:'initial', name:'Inicial', price_cup:500, diamonds:100, duration_days:3, reference_reward_diamonds:120 },
    { id:'basic', name:'Básico', price_cup:2500, diamonds:500, duration_days:4, reference_reward_diamonds:650 },
    { id:'large', name:'Grande', price_cup:5000, diamonds:1000, duration_days:5, reference_reward_diamonds:1350 },
    { id:'premium', name:'Premium', price_cup:12500, diamonds:2500, duration_days:6, reference_reward_diamonds:3500 },
    { id:'maximum', name:'Máximo', price_cup:25000, diamonds:5000, duration_days:7, reference_reward_diamonds:7500 }
  ],
  memberships: [
    { id:'bronze', name:'Bronce', price_diamonds:100, duration_days:3, bonus_percent:5 },
    { id:'silver', name:'Plata', price_diamonds:250, duration_days:4, bonus_percent:10 },
    { id:'gold', name:'Oro', price_diamonds:500, duration_days:5, bonus_percent:20 },
    { id:'platinum', name:'Platino', price_diamonds:1000, duration_days:6, bonus_percent:35 },
    { id:'diamond', name:'Diamante', price_diamonds:2500, duration_days:7, bonus_percent:50 }
  ],
  accelerators: [
    { id:'quartz', name:'Cuarzo', price_diamonds:100, speed_multiplier:2 },
    { id:'ruby', name:'Rubí', price_diamonds:150, speed_multiplier:3 },
    { id:'sapphire', name:'Zafiro', price_diamonds:200, speed_multiplier:4 },
    { id:'supercluster', name:'Supercluster', price_diamonds:250, speed_multiplier:6 },
    { id:'titan_reactor', name:'Reactor Titán', price_diamonds:300, instant_complete:true }
  ]
};
const STARTER = { id:'starter', name:'Bono inicial', price_cup:0, diamonds:5, duration_minutes:30, reward_cup:25 };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
 id bigserial primary key, telegram_user_id text unique not null, username text, first_name text,
 referral_code text unique not null, referred_by text, welcome_bonus_granted boolean not null default false,
 starter_bonus_granted boolean not null default false, starter_mining_used boolean not null default false,
 suspended boolean not null default false, created_at timestamptz not null default now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_bonus_granted boolean not null default false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_bonus_granted boolean not null default false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_mining_used boolean not null default false;
CREATE TABLE IF NOT EXISTS wallets(
 user_id bigint primary key references users(id), purchased_diamonds bigint not null default 0,
 promotional_diamonds bigint not null default 0, locked_diamonds bigint not null default 0,
 pending_cup bigint not null default 0, available_cup bigint not null default 0, paid_cup bigint not null default 0
);
CREATE TABLE IF NOT EXISTS orders(
 id bigserial primary key, order_no text unique not null, user_id bigint not null references users(id),
 kind text not null, catalog_id text not null, amount_cup bigint not null default 0,
 diamonds bigint not null default 0, operation_no text, proof_url text,
 status text not null default 'pending_payment', snapshot jsonb, created_at timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS mining_sessions(
 id bigserial primary key, user_id bigint not null references users(id), package_id text not null,
 started_at timestamptz not null, ends_at timestamptz not null, status text not null default 'running', snapshot jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_mining ON mining_sessions(user_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS card_entries(
 id bigserial primary key, user_id bigint not null references users(id), draw_key text not null, card text not null,
 created_at timestamptz not null default now(), unique(user_id,draw_key)
);
CREATE TABLE IF NOT EXISTS withdrawals(
 id bigserial primary key, request_no text unique not null, user_id bigint not null references users(id),
 amount_cup bigint not null, destination text not null, status text not null default 'requested', created_at timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS entitlements(
 id bigserial primary key, user_id bigint not null references users(id), kind text not null, catalog_id text not null,
 starts_at timestamptz not null default now(), ends_at timestamptz, status text not null default 'active',
 unique(user_id,kind,catalog_id,starts_at)
);
CREATE TABLE IF NOT EXISTS audit_log(
 id bigserial primary key, actor_telegram_id text, action text not null, target_type text, target_id text, details jsonb, created_at timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS referral_rewards(
 id bigserial primary key, referrer_user_id bigint not null references users(id), referred_user_id bigint unique not null references users(id),
 reward_diamonds bigint not null default 50, created_at timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS support_tickets(
 id bigserial primary key, user_id bigint not null references users(id), message text not null, channel text not null default 'whatsapp',
 status text not null default 'open', created_at timestamptz not null default now()
);
`;

const db = (q,p=[]) => { if(!pool) throw Error('database_unavailable'); return pool.query(q,p); };
const send = (res,status,data,type='application/json') => { res.statusCode=status; res.setHeader('content-type',`${type}; charset=utf-8`); res.end(type==='application/json'?JSON.stringify(data):data); };
const readBody = async req => { let s=''; for await (const c of req) s += c; try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const makeId = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const wa = text => `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
const havana = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Havana',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const havanaParts = d => Object.fromEntries(havana.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));

async function telegram(method,payload) {
  if(!BOT_TOKEN) throw Error('telegram_unavailable');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json();
  if(!j.ok) throw Error(j.description || 'telegram_error');
  return j.result;
}
function parseInit(raw) {
  try {
    const q=new URLSearchParams(raw||''); const hash=q.get('hash'); if(!hash || !BOT_TOKEN) return null;
    q.delete('hash');
    const data=[...q.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}=${v}`).join('\n');
    const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    const good=crypto.createHmac('sha256',secret).update(data).digest('hex');
    if(good.length!==hash.length || !crypto.timingSafeEqual(Buffer.from(good),Buffer.from(hash))) return null;
    const user=JSON.parse(q.get('user')||'{}'); if(!user?.id) return null;
    return {...user,start_param:q.get('start_param')||''};
  } catch { return null; }
}
async function ensureUser(tg,ref='') {
  const tid=String(tg.id);
  let r=await db('select * from users where telegram_user_id=$1',[tid]);
  if(r.rowCount){
    const u=r.rows[0];
    await db('insert into wallets(user_id) values($1) on conflict do nothing',[u.id]);
    if(ref && !u.referred_by){
      const rr=await db('select referral_code from users where referral_code=$1 and telegram_user_id<>$2',[ref,tid]);
      if(rr.rowCount) await db('update users set referred_by=$1 where id=$2',[ref,u.id]);
    }
    if(!u.starter_bonus_granted){
      await db('update wallets set promotional_diamonds=promotional_diamonds+5 where user_id=$1',[u.id]);
      await db('update users set starter_bonus_granted=true,welcome_bonus_granted=true where id=$1',[u.id]);
    }
    return (await db('select * from users where id=$1',[u.id])).rows[0];
  }
  let code;
  for(;;){ code=crypto.randomBytes(5).toString('hex').toUpperCase(); const x=await db('select 1 from users where referral_code=$1',[code]); if(!x.rowCount) break; }
  let referredBy=null;
  if(ref){ const x=await db('select id from users where referral_code=$1 and telegram_user_id<>$2',[ref,tid]); if(x.rowCount) referredBy=ref; }
  const u=(await db(`insert into users(telegram_user_id,username,first_name,referral_code,referred_by,welcome_bonus_granted,starter_bonus_granted,starter_mining_used)
    values($1,$2,$3,$4,$5,true,true,false) returning *`,[tid,tg.username||null,tg.first_name||'',code,referredBy])).rows[0];
  await db('insert into wallets(user_id,promotional_diamonds) values($1,5)',[u.id]);
  if(referredBy) try { await telegram('sendMessage',{chat_id:CREATOR_ID,text:`🤝 Nuevo referido\nUsuario: @${tg.username||'sin_usuario'}\nID Telegram: ${tid}\nCódigo: ${referredBy}`}); } catch {}
  return u;
}
async function auth(req) {
  const tg=parseInit(req.headers['x-telegram-init-data']);
  if(!tg) return null;
  const u=await ensureUser(tg,tg.start_param);
  if(u.suspended) return null;
  return u;
}
function product(kind,key){ const a=kind==='membership'?CATALOG.memberships:kind==='accelerator'?CATALOG.accelerators:CATALOG.mining_packages; return a.find(x=>x.id===key); }
async function audit(actor,action,type,target,details){ await db('insert into audit_log(actor_telegram_id,action,target_type,target_id,details) values($1,$2,$3,$4,$5)',[String(actor||''),action,type,target,details?JSON.stringify(details):null]).catch(()=>{}); }
function appUrl(screen){ return `${APP_URL}/app?screen=${encodeURIComponent(screen)}&v=20260912.5`; }
function playerKeyboard(){
  const rows=[
    [['⛏️ Minar','mining'],['🃏 Cartas','cards']],
    [['💎 Comprar diamantes','diamonds'],['👛 Billetera','wallet']],
    [['🤝 Referidos','referrals'],['👑 Membresías','members']],
    [['⚡ Aceleradores','accelerators'],['🆘 Soporte','support']],
    [['⚙️ Ajustes','settings'],['📋 Reglas','rules']]
  ];
  return {keyboard:rows.map(row=>row.map(([text,screen])=>({text,web_app:{url:appUrl(screen)}}))),resize_keyboard:true,is_persistent:true};
}
async function sendFreshMenu(chatId){
  await telegram('sendMessage',{chat_id:chatId,text:'Actualizando menú…',reply_markup:{remove_keyboard:true}});
  await telegram('sendMessage',{chat_id:chatId,text:'💎 Maison Aurea\n\nSelecciona una sección. Cada botón abre directamente su pantalla.',reply_markup:playerKeyboard()});
}
async function notifyOrder(order,user){
  const label=product(order.kind,order.catalog_id)?.name || order.catalog_id;
  try { await telegram('sendMessage',{chat_id:CREATOR_ID,
    text:`🛒 NUEVA COMPRA\nOrden: ${order.order_no}\nUsuario: @${user.username||'sin_usuario'}\nID Telegram: ${user.telegram_user_id}\nProducto: ${label}\nTipo: ${order.kind}\nMonto: ${order.amount_cup} CUP\nDiamantes: ${order.diamonds}`,
    reply_markup:{inline_keyboard:[[{text:'✅ Aprobar',callback_data:`approve:${order.order_no}`},{text:'❌ Rechazar',callback_data:`reject:${order.order_no}`}]]}});
  } catch(e){ console.error('notifyOrder:',e.message); }
}
async function notifyWithdrawal(w,user){
  try { await telegram('sendMessage',{chat_id:CREATOR_ID,
    text:`💸 NUEVO RETIRO\nNúmero: ${w.request_no}\nUsuario: @${user.username||'sin_usuario'}\nID Telegram: ${user.telegram_user_id}\nMonto: ${w.amount_cup} CUP\nDestino: ${w.destination}`,
    reply_markup:{inline_keyboard:[[{text:'✅ Marcar pagado',callback_data:`withdraw_paid:${w.request_no}`}]]}});
  } catch(e){ console.error('notifyWithdrawal:',e.message); }
}
async function rewardReferral(referredUserId){
  const q=(await db(`select u.referred_by,r.id referrer_id,r.telegram_user_id from users u left join users r on r.referral_code=u.referred_by where u.id=$1`,[referredUserId])).rows[0];
  if(!q?.referrer_id) return;
  const ins=await db(`insert into referral_rewards(referrer_user_id,referred_user_id,reward_diamonds) values($1,$2,50) on conflict(referred_user_id) do nothing returning id`,[q.referrer_id,referredUserId]);
  if(ins.rowCount){ await db('update wallets set promotional_diamonds=promotional_diamonds+50 where user_id=$1',[q.referrer_id]); try{await telegram('sendMessage',{chat_id:q.telegram_user_id,text:'🎁 Tu referido completó su primera compra aprobada. Se acreditaron 50 💎 promocionales.'});}catch{} }
}
async function approveOrder(orderNo,actor){
  const client=await pool.connect();
  try{
    await client.query('begin'); const r=await client.query('select * from orders where order_no=$1 for update',[orderNo]);
    if(!r.rowCount || !['pending_payment','under_review'].includes(r.rows[0].status)){await client.query('rollback');return false;}
    const o=r.rows[0], p=product(o.kind,o.catalog_id); if(!p){await client.query('rollback');return false;}
    if(o.kind==='mining') await client.query('update wallets set purchased_diamonds=purchased_diamonds+$1 where user_id=$2',[o.diamonds,o.user_id]);
    else {
      const cost=o.diamonds, w=(await client.query('select * from wallets where user_id=$1 for update',[o.user_id])).rows[0];
      if(!w || Number(w.purchased_diamonds)+Number(w.promotional_diamonds)-Number(w.locked_diamonds)<cost){await client.query('rollback');return false;}
      await client.query('update wallets set locked_diamonds=locked_diamonds+$1 where user_id=$2',[cost,o.user_id]);
      const days=p.duration_days || 0; await client.query(`insert into entitlements(user_id,kind,catalog_id,ends_at) values($1,$2,$3,now()+($4||' days')::interval)`,[o.user_id,o.kind,o.catalog_id,days]);
    }
    await client.query('update orders set status=\'approved\' where id=$1',[o.id]);
    await client.query('commit'); await audit(actor,'approve_order','order',o.order_no,{kind:o.kind}); if(o.kind==='mining') await rewardReferral(o.user_id); return true;
  } catch(e){try{await client.query('rollback')}catch{}; throw e} finally{client.release()}
}

async function rejectOrder(orderNo,actor){
  const r=await db(`update orders set status='rejected' where order_no=$1 and status in ('pending_payment','under_review') returning *`,[orderNo]);
  if(r.rowCount){ await audit(actor,'reject_order','order',orderNo,{}); return true; } return false;
}

async function finalizeMining(userId){
  const r=await db(`update mining_sessions set status='completed' where user_id=$1 and status='running' and ends_at<=now() returning *`,[userId]);
  if(!r.rowCount) return null;
  const s=r.rows[0];
  if(s.package_id==='starter') await db('update wallets set available_cup=available_cup+25 where user_id=$1',[userId]);
  return s;
}

async function handleUpdate(update){
  if(update?.callback_query){
    const cq=update.callback_query, actor=String(cq.from?.id||'');
    if(actor!==CREATOR_ID) { try{await telegram('answerCallbackQuery',{callback_query_id:cq.id,text:'No autorizado'});}catch{}; return; }
    const [action,id]=String(cq.data||'').split(':');
    if(action==='approve') await approveOrder(id,actor);
    else if(action==='reject') await rejectOrder(id,actor);
    else if(action==='withdraw_paid') await db(`update withdrawals set status='paid' where request_no=$1 and status='requested'`,[id]);
    try{await telegram('answerCallbackQuery',{callback_query_id:cq.id,text:'Procesado'});}catch{}
    return;
  }
  if(update?.message){
    const m=update.message;
    if(m.web_app_data) return;
    if(m.text?.startsWith('/start')) { await ensureUser(m.from,m.text.split(/\s+/)[1]||''); await sendFreshMenu(m.chat.id); }
    else if(m.text) await sendFreshMenu(m.chat.id);
  }
}

async function start(){
  if(pool) await db(SCHEMA).catch(e=>console.error('schema:',e.message));
  const server=http.createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if(req.method==='GET' && u.pathname==='/health') return send(res,200,{ok:true,service:'maison-aurea'});
      if(req.method==='GET' && u.pathname==='/api/catalog') return send(res,200,{ok:true,catalog:CATALOG,starter:STARTER});
      if(req.method==='POST' && u.pathname==='/telegram/webhook') { if(WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token']!==WEBHOOK_SECRET) return send(res,403,{error:'forbidden'}); await handleUpdate(await readBody(req)); return send(res,200,{ok:true}); }
      if(req.method==='GET' && (u.pathname==='/app' || u.pathname==='/')) { const html=await fs.readFile(new URL('./public/index.html',import.meta.url),'utf8'); return send(res,200,html,'text/html'); }
      if(req.method==='GET' && u.pathname==='/api/payment-info') return send(res,200,{ok:true,info:paymentInstructions()});
      if(req.method==='POST' && u.pathname==='/api/order'){
        const user=await auth(req); if(!user) return send(res,401,{error:'unauthorized'}); const b=await readBody(req); const p=product(b.kind,b.catalog_id); if(!p) return send(res,400,{error:'invalid_product'});
        const amount=b.kind==='mining'?p.price_cup:0, diamonds=b.kind==='mining'?p.diamonds:p.price_diamonds; const order={order_no:makeId('ORD'),user_id:user.id,kind:b.kind,catalog_id:b.catalog_id,amount_cup:amount,diamonds,snapshot:p};
        const r=await db(`insert into orders(order_no,user_id,kind,catalog_id,amount_cup,diamonds,snapshot) values($1,$2,$3,$4,$5,$6,$7) returning *`,[order.order_no,order.user_id,order.kind,order.catalog_id,order.amount_cup,order.diamonds,JSON.stringify(order.snapshot)]); const o=r.rows[0];
        await notifyOrder(o,user);
        const label=p.name; const msg=`Maison Aurea — Pago\nOrden: ${o.order_no}\nUsuario: @${user.username||'sin_usuario'}\nID Telegram: ${user.telegram_user_id}\nProducto: ${label}\nMonto: ${amount} CUP\nDiamantes: ${diamonds}\n\n${paymentInstructions()}\n\nEnvía comprobante/captura del pago, tu número de teléfono y el número de operación. Espera 30–60 min. No envíes PIN, contraseña, CVV ni códigos SMS.`;
        return send(res,201,{ok:true,order:o,whatsapp:wa(msg)});
      }
      if(req.method==='GET' && u.pathname==='/api/me'){ const user=await auth(req); if(!user) return send(res,401,{error:'unauthorized'}); await finalizeMining(user.id); const w=(await db('select * from wallets where user_id=$1',[user.id])).rows[0]; return send(res,200,{ok:true,user,wallet:w,starter:STARTER}); }
      if(req.method==='POST' && u.pathname==='/api/mining/start'){ const user=await auth(req); if(!user) return send(res,401,{error:'unauthorized'}); const a=await db(`select 1 from mining_sessions where user_id=$1 and status='running'`,[user.id]); if(a.rowCount) return send(res,409,{error:'mining_already_active'}); const urow=(await db('select * from users where id=$1',[user.id])).rows[0]; if(urow.starter_mining_used) return send(res,409,{error:'starter_already_used'}); const end=new Date(Date.now()+30*60*1000); await db(`insert into mining_sessions(user_id,package_id,started_at,ends_at,status) values($1,'starter',now(),$2,'running')`,[user.id,end]); await db('update users set starter_mining_used=true where id=$1',[user.id]); return send(res,200,{ok:true,ends_at:end.toISOString(),duration_minutes:30,reward_cup:25}); }
      if(req.method==='POST' && u.pathname==='/api/withdraw'){ const user=await auth(req); if(!user) return send(res,401,{error:'unauthorized'}); const b=await readBody(req); const amount=Number(b.amount); const destination=String(b.destination||'').trim(); if(!Number.isInteger(amount)||amount<=0||!destination) return send(res,400,{error:'invalid_withdrawal'}); const client=await pool.connect(); try{await client.query('begin'); const w=(await client.query('select * from wallets where user_id=$1 for update',[user.id])).rows[0]; if(!w||Number(w.available_cup)-Number(w.pending_cup)<amount){await client.query('rollback');return send(res,400,{error:'insufficient_balance'});} const no=makeId('RET'); const r=await client.query(`insert into withdrawals(request_no,user_id,amount_cup,destination) values($1,$2,$3,$4) returning *`,[no,user.id,amount,destination]); await client.query('update wallets set pending_cup=pending_cup+$1,available_cup=available_cup-$1 where user_id=$2',[amount,user.id]); await client.query('commit'); const wrow=r.rows[0]; await notifyWithdrawal(wrow,user); const msg=`Maison Aurea — Retiro\nNúmero: ${no}\nUsuario: @${user.username||'sin_usuario'}\nID Telegram: ${user.telegram_user_id}\nMonto: ${amount} CUP\nDestino: ${destination}\n\nSolicitud enviada. Espera 30–60 min.`; return send(res,201,{ok:true,withdrawal:wrow,whatsapp:wa(msg)});}catch(e){try{await client.query('rollback')}catch{};throw e}finally{client.release()}}
      if(req.method==='GET' && u.pathname==='/api/admin'){ const user=await auth(req); if(!user||String(user.telegram_user_id)!==CREATOR_ID) return send(res,403,{error:'forbidden'}); return send(res,200,{ok:true,users:(await db('select count(*) from users')).rows[0].count,pending_orders:(await db(`select count(*) from orders where status in ('pending_payment','under_review')`)).rows[0].count,pending_withdrawals:(await db(`select count(*) from withdrawals where status='requested'`)).rows[0].count}); }
      if(req.method==='GET' && u.pathname.startsWith('/api/')) return send(res,404,{error:'not_found'});
      return send(res,404,{error:'not_found'});
    }catch(e){ console.error(e); return send(res,500,{error:'server_error'}); }
  });
  server.listen(PORT,()=>console.log(`Maison Aurea listening on ${PORT}`));
  if(BOT_TOKEN){ try{ await telegram('setWebhook',{url:`${APP_URL}/telegram/webhook`,secret_token:WEBHOOK_SECRET||undefined}); console.log('Telegram webhook configured'); }catch(e){console.error('webhook:',e.message)} }
}
start().catch(e=>{console.error(e);process.exit(1)});

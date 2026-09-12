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
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

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
function appUrl(screen){ return `${APP_URL}/app?screen=${encodeURIComponent(screen)}&v=20260912.4`; }
function playerKeyboard(){
  const rows=[[['⛏️ Minar','mining'],['🃏 Cartas','cards']],[['💎 Comprar diamantes','diamonds'],['👛 Billetera','wallet']],[['🤝 Referidos','referrals'],['👑 Membresías','members']],[['⚡ Aceleradores','accelerators'],['🆘 Soporte','support']],[['⚙️ Ajustes','settings'],['📋 Reglas','rules']]];
  return {keyboard:rows.map(row=>row.map(([text,screen])=>({text,web_app:{url:appUrl(screen)}}))),resize_keyboard:true,is_persistent:true};
}
async function sendFreshMenu(chatId){ await telegram('sendMessage',{chat_id:chatId,text:'',reply_markup:{remove_keyboard:true}}); await telegram('sendMessage',{chat_id:chatId,text:'💎 Maison Aurea\n\nSelecciona una sección. Cada botón abre directamente su pantalla.',reply_markup:playerKeyboard()}); }
async function notifyOrder(order,user){
  const label=product(order.kind,order.catalog_id)?.name || order.catalog_id;
  try { await telegram('sendMessage',{chat_id:CREATOR_ID,text:`🛒 NUEVA COMPRA\nOrden: ${order.order_no}\nUsuario: @${user.username||'sin_usuario'}\nID Telegram: ${user.telegram_user_id}\nProducto: ${label}\nTipo: ${order.kind}\nMonto: ${order.amount_cup} CUP\nDiamantes: ${order.diamonds}`,reply_markup:{inline_keyboard:[[{text:'✅ Aprobar',callback_data:`approve:${order.order_no}`},{text:'❌ Rechazar',callback_data:`reject:${order.order_no}`}]]}}); } catch(e){ console.error('notifyOrder:',e.message); }
}
async function notifyWithdrawal(w,user){
  try { await telegram('sendMessage',{chat_id:CREATOR_ID,text:`💸 NUEVO RETIRO\nNúmero: ${w.request_no}\nUsuario: @${user.username||'sin_usuario'}\nID Telegram: ${user.telegram_user_id}\nMonto: ${w.amount_cup} CUP\nDestino: ${w.destination}`,reply_markup:{inline_keyboard:[[{text:'✅ Marcar pagado',callback_data:`withdraw_paid:${w.request_no}`}]]}}); } catch(e){ console.error('notifyWithdrawal:',e.message); }
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
      const spendable=Number(w.purchased_diamonds)+Number(w.promotional_diamonds)-Number(w.locked_diamonds);
      if(spendable<cost){await client.query('rollback');await db('update orders set status=$1 where order_no=$2',['rejected',orderNo]);await audit(actor,'order_rejected_insufficient_diamonds','order',orderNo,{cost});return false;}
      let left=cost, promo=Math.min(Number(w.promotional_diamonds),left); left-=promo;
      await client.query('update wallets set promotional_diamonds=promotional_diamonds-$1,purchased_diamonds=purchased_diamonds-$2 where user_id=$3',[promo,left,o.user_id]);
      const days=p.duration_days||7; await client.query(`insert into entitlements(user_id,kind,catalog_id,ends_at) values($1,$2,$3,now()+($4||' days')::interval)`,[o.user_id,o.kind,o.catalog_id,String(days)]);
    }
    await client.query("update orders set status='approved' where id=$1",[o.id]); await client.query('commit'); await audit(actor,'order_approved','order',orderNo,{kind:o.kind}); await rewardReferral(o.user_id); return true;
  }catch(e){try{await client.query('rollback')}catch{};throw e}finally{client.release();}
}
async function rejectOrder(orderNo,actor){ const r=await db(`update orders set status='rejected' where order_no=$1 and status in ('pending_payment','under_review') returning *`,[orderNo]); if(r.rowCount) await audit(actor,'order_rejected','order',orderNo); return !!r.rowCount; }
async function markWithdrawalPaid(requestNo,actor){
  const client=await pool.connect(); try{ await client.query('begin'); const r=await client.query("select * from withdrawals where request_no=$1 for update",[requestNo]);
    if(!r.rowCount || r.rows[0].status!=='requested'){await client.query('rollback');return false;} const w=r.rows[0];
    await client.query("update withdrawals set status='paid' where id=$1",[w.id]); await client.query("update wallets set pending_cup=pending_cup-$1,paid_cup=paid_cup+$1 where user_id=$2",[w.amount_cup,w.user_id]); await client.query('commit'); await audit(actor,'withdrawal_paid','withdrawal',requestNo,{amount_cup:w.amount_cup}); return true;
  }catch(e){try{await client.query('rollback')}catch{};throw e}finally{client.release();}
}
async function finalizeMining(userId){
  const client=await pool.connect(); try{await client.query('begin'); const r=await client.query("select * from mining_sessions where user_id=$1 and status='running' and ends_at<=now() order by id desc limit 1 for update",[userId]);
    if(!r.rowCount){await client.query('rollback');return;} const m=r.rows[0],starter=m.package_id==='starter'; await client.query("update mining_sessions set status='completed' where id=$1",[m.id]); if(starter) await client.query('update wallets set available_cup=available_cup+25 where user_id=$1',[userId]); await client.query('commit'); await audit(null,'mining_completed','mining',String(m.id),{starter});
  }catch(e){try{await client.query('rollback')}catch{};throw e}finally{client.release();}
}
async function bot(update){
  if(update?.callback_query){ const q=update.callback_query; if(String(q.from?.id)!==CREATOR_ID) return telegram('answerCallbackQuery',{callback_query_id:q.id,text:'No autorizado',show_alert:true}); const [action,no]=String(q.data||'').split(':'); let ok=false;
    if(action==='approve')ok=await approveOrder(no,q.from.id); else if(action==='reject')ok=await rejectOrder(no,q.from.id); else if(action==='withdraw_paid')ok=await markWithdrawalPaid(no,q.from.id);
    await telegram('answerCallbackQuery',{callback_query_id:q.id,text:ok?'Operación completada':'Ya procesada o inválida'}); try{await telegram('editMessageReplyMarkup',{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}})}catch{} return; }
  const m=update?.message; if(!m?.chat?.id)return; const text=String(m.text||''); if(text.startsWith('/start')){await ensureUser(m.from,text.trim().split(/\s+/)[1]||'');await sendFreshMenu(m.chat.id);return;} await sendFreshMenu(m.chat.id);
}
async function api(req,res){
  const url=new URL(req.url,'http://localhost'), p=url.pathname;
  if(req.method==='GET'&&p==='/health')return send(res,200,{ok:true,service:'maison-aurea',time:new Date().toISOString()});
  if(req.method==='GET'&&p==='/api/catalog')return send(res,200,{...CATALOG,starter:STARTER});
  if(req.method==='GET'&&p==='/app'){try{return send(res,200,await fs.readFile(new URL('./public/index.html',import.meta.url),'utf8'),'text/html');}catch{return send(res,500,{error:'app_unavailable'});}}
  if(req.method==='POST'&&p==='/webhook'){if(WEBHOOK_SECRET&&req.headers['x-telegram-bot-api-secret-token']!==WEBHOOK_SECRET)return send(res,403,{error:'forbidden'});try{await bot(await readBody(req));return send(res,200,{ok:true});}catch(e){console.error('webhook',e);return send(res,200,{ok:true});}}
  const u=await auth(req); if(!u)return send(res,401,{error:'Abre Maison Aurea desde Telegram.'});
  if(req.method==='GET'&&p==='/api/me'){await finalizeMining(u.id);const user=(await db('select * from users where id=$1',[u.id])).rows[0];const wallet=(await db('select * from wallets where user_id=$1',[u.id])).rows[0];const mining=(await db("select id,package_id,started_at,ends_at,status from mining_sessions where user_id=$1 and status='running' order by id desc limit 1",[u.id])).rows[0]||null;const lastCompleted=(await db("select id,package_id,started_at,ends_at,status from mining_sessions where user_id=$1 and status='completed' order by id desc limit 1",[u.id])).rows[0]||null;return send(res,200,{user:{telegram_user_id:user.telegram_user_id,username:user.username,first_name:user.first_name,referral_code:user.referral_code,is_creator:String(user.telegram_user_id)===CREATOR_ID,starter_mining_used:user.starter_mining_used},wallet,mining,last_completed:lastCompleted});}
  if(p.startsWith('/api/admin/')){if(String(u.telegram_user_id)!==CREATOR_ID)return send(res,403,{error:'No autorizado'});if(req.method==='GET'&&p==='/api/admin/orders')return send(res,200,(await db("select order_no,kind,catalog_id,amount_cup,diamonds,status,created_at from orders where status in ('pending_payment','under_review') order by id desc")).rows);if(req.method==='GET'&&p==='/api/admin/withdrawals')return send(res,200,(await db("select w.request_no,w.amount_cup,w.destination,w.status,w.created_at,u.telegram_user_id,u.username from withdrawals w join users u on u.id=w.user_id where w.status='requested' order by w.id desc")).rows);if(req.method==='GET'&&p==='/api/admin/audit')return send(res,200,(await db("select actor_telegram_id,action,target_type,target_id,details,created_at from audit_log order by id desc limit 100")).rows);if(req.method==='GET'&&p==='/api/admin/users')return send(res,200,(await db('select count(*)::int users,count(*) filter(where created_at::date=current_date)::int today from users')).rows[0]);if(req.method==='POST'&&p.startsWith('/api/admin/orders/')){const no=decodeURIComponent(p.split('/').pop()),b=await readBody(req);if(b.action==='approve')return send(res,200,{ok:await approveOrder(no,u.telegram_user_id)});if(b.action==='reject')return send(res,200,{ok:await rejectOrder(no,u.telegram_user_id)});}if(req.method==='POST'&&p.startsWith('/api/admin/withdrawals/')){const no=decodeURIComponent(p.split('/').pop()),b=await readBody(req);if(b.action==='paid')return send(res,200,{ok:await markWithdrawalPaid(no,u.telegram_user_id)});}return send(res,404,{error:'not_found'});}
  if(req.method==='POST'&&p==='/api/mining/start'){const b=await readBody(req),key=String(b.package_id||''),client=await pool.connect();try{await client.query('begin');const us=(await client.query('select * from users where id=$1 for update',[u.id])).rows[0];if(key==='starter'){if(us.starter_mining_used){await client.query('rollback');return send(res,409,{error:'El bono inicial ya fue utilizado.'});}}else if(!product('mining',key)){await client.query('rollback');return send(res,400,{error:'Paquete inválido.'});}const active=await client.query("select id from mining_sessions where user_id=$1 and status='running' for update",[u.id]);if(active.rowCount){await client.query('rollback');return send(res,409,{error:'Ya tienes una minería activa.'});}const minutes=key==='starter'?30:(product('mining',key).duration_days*24*60),ends=new Date(Date.now()+minutes*60000);await client.query("insert into mining_sessions(user_id,package_id,started_at,ends_at,status,snapshot) values($1,$2,now(),$3,'running',$4)",[u.id,key,ends,JSON.stringify(key==='starter'?STARTER:product('mining',key))]);if(key==='starter')await client.query('update users set starter_mining_used=true where id=$1',[u.id]);const r=await client.query("select id,package_id,started_at,ends_at,status from mining_sessions where user_id=$1 and status='running' order by id desc limit 1",[u.id]);await client.query('commit');return send(res,200,r.rows[0]);}catch(e){try{await client.query('rollback')}catch{};if(e.code==='23505')return send(res,409,{error:'Ya tienes una minería activa.'});throw e}finally{client.release();}}
  if(req.method==='POST'&&p==='/api/orders'){const b=await readBody(req),kind=String(b.kind||''),cid=String(b.catalog_id||''),prod=product(kind,cid);if(!prod)return send(res,400,{error:'Producto inválido.'});const amount=kind==='mining'?prod.price_cup:0,diamonds=kind==='mining'?prod.diamonds:prod.price_diamonds,orderNo=makeId('ORD'),snapshot={...prod,kind,catalog_id:cid};const o=(await db(`insert into orders(order_no,user_id,kind,catalog_id,amount_cup,diamonds,status,snapshot) values($1,$2,$3,$4,$5,$6,'pending_payment',$7) returning *`,[orderNo,u.id,kind,cid,amount,diamonds,JSON.stringify(snapshot)])).rows[0];const text=`Maison Aurea\nNueva compra\nProducto: ${prod.name}\nMonto: ${amount} CUP\nDiamantes: ${diamonds}\nNúmero de orden: ${orderNo}\n\n${PAYMENT_INFO}\n\nEnvía captura, tu número telefónico y número de operación.\nEspera estimada: 30 minutos a 1 hora.`;const out={order_no:orderNo,status:o.status,whatsapp_url:wa(text),product:prod};await notifyOrder(o,u);return send(res,201,out);}
  if(req.method==='GET'&&p==='/api/referrals'){const inv=(await db('select telegram_user_id,username,created_at from users where referred_by=$1 order by id desc',[u.referral_code])).rows,reward=(await db('select coalesce(sum(reward_diamonds),0)::int total from referral_rewards where referrer_user_id=$1',[u.id])).rows[0];return send(res,200,{code:u.referral_code,link:`https://t.me/MaisonAureaGameBot?start=${encodeURIComponent(u.referral_code)}`,invited:inv,rewarded_diamonds:reward.total,share_text:'Únete a Maison Aurea 💎'});}
  if(req.method==='GET'&&p==='/api/support')return send(res,200,{phone:WA,email:EMAIL});
  if(req.method==='POST'&&p==='/api/support'){const b=await readBody(req),message=String(b.message||'').trim();if(!message)return send(res,400,{error:'Escribe el problema.'});const text=`Soporte Maison Aurea\nUsuario: @${u.username||'sin_usuario'}\nID de Telegram: ${u.telegram_user_id}\nDescripción: ${message}\nOrden/retiro: ${b.reference||'No indicado'}\n\nNo envíes PIN, contraseña, CVV ni códigos SMS.\nEspera estimada: 30 minutos a 1 hora.`;const t=(await db("insert into support_tickets(user_id,message,channel) values($1,$2,'whatsapp') returning id",[u.id,message])).rows[0];return send(res,201,{ticket_id:t.id,whatsapp_url:wa(text),email_url:`mailto:${EMAIL}?subject=${encodeURIComponent('Soporte Maison Aurea')}&body=${encodeURIComponent(text)}`});}
  if(req.method==='POST'&&p==='/api/withdrawals'){const b=await readBody(req),amount=Number(b.amount_cup),destination=String(b.destination||'').trim();if(!Number.isInteger(amount)||amount<=0)return send(res,400,{error:'El monto debe ser un entero positivo.'});if(!destination)return send(res,400,{error:'Indica el destino del pago.'});const client=await pool.connect();try{await client.query('begin');const w=(await client.query('select * from wallets where user_id=$1 for update',[u.id])).rows[0];if(Number(w.available_cup)<amount){await client.query('rollback');return send(res,400,{error:'Saldo disponible insuficiente.'});}const no=makeId('RET'),r=(await client.query("insert into withdrawals(request_no,user_id,amount_cup,destination,status) values($1,$2,$3,$4,'requested') returning *",[no,u.id,amount,destination])).rows[0];await client.query('update wallets set available_cup=available_cup-$1,pending_cup=pending_cup+$1 where user_id=$2',[amount,u.id]);await client.query('commit');await audit(u.telegram_user_id,'withdrawal_requested','withdrawal',no,{amount_cup:amount});const text=`Maison Aurea - Retiro\nNúmero de retiro: ${no}\nUsuario: @${u.username||'sin_usuario'}\nID de Telegram: ${u.telegram_user_id}\nMonto: ${amount} CUP\nDestino: ${destination}`;await notifyWithdrawal(r,u);return send(res,201,{request_no:no,status:r.status,whatsapp_url:wa(text)});}catch(e){try{await client.query('rollback')}catch{};throw e}finally{client.release();}}
  if(req.method==='POST'&&p==='/api/cards/enter'){const now=new Date(),hp=havanaParts(now),h=Number(hp.hour);if(!((h>=8&&h<12)||(h>=14&&h<22)))return send(res,400,{error:'Cartas disponibles de 08:00–12:00 y 14:00–22:00, hora de La Habana.'});const drawKey=`${hp.year}-${hp.month}-${hp.day}-${h<12?'AM':'PM'}`,client=await pool.connect();try{await client.query('begin');const w=(await client.query('select * from wallets where user_id=$1 for update',[u.id])).rows[0],spend=Number(w.purchased_diamonds)+Number(w.promotional_diamonds)-Number(w.locked_diamonds);if(spend<100){await client.query('rollback');return send(res,400,{error:'Necesitas 100 diamantes.'});}const exists=await client.query('select id from card_entries where user_id=$1 and draw_key=$2',[u.id,drawKey]);if(exists.rowCount){await client.query('rollback');return send(res,409,{error:'Ya participaste en este horario.'});}let promo=Math.min(Number(w.promotional_diamonds),100),purchased=100-promo;await client.query('update wallets set promotional_diamonds=promotional_diamonds-$1,purchased_diamonds=purchased_diamonds-$2 where user_id=$3',[promo,purchased,u.id]);const cards=['AUREA','ONYX','RUBÍ','ZAFIRO','ESMERALDA','PERLA'],selected=cards[crypto.randomInt(cards.length)];await client.query('insert into card_entries(user_id,draw_key,card) values($1,$2,$3)',[u.id,drawKey,selected]);await client.query('commit');return send(res,201,{ok:true,card:selected,draw_key:drawKey});}catch(e){try{await client.query('rollback')}catch{};throw e}finally{client.release();}}
  return send(res,404,{error:'Ruta no encontrada.'});
}
async function boot(){if(!pool)console.warn('DATABASE_URL no configurada');else await db(SCHEMA);const server=http.createServer(async(req,res)=>{try{await api(req,res)}catch(e){console.error(e);send(res,500,{error:'Error interno del servidor.'});}});server.listen(PORT,async()=>{console.log(`Maison Aurea listening on ${PORT}`);if(BOT_TOKEN)try{const payload={url:`${APP_URL}/webhook`};if(WEBHOOK_SECRET)payload.secret_token=WEBHOOK_SECRET;await telegram('setWebhook',payload);console.log('Telegram webhook configured');}catch(e){console.error('setWebhook:',e.message);}});}
boot().catch(e=>{console.error('BOOT FAILED',e);process.exit(1);});

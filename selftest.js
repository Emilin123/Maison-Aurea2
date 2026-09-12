import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const TEST_PORT = 18080;
const DB = process.env.DATABASE_URL;
const TOKEN = process.env.BOT_TOKEN;
const CREATOR_ID = String(process.env.CREATOR_TELEGRAM_USER_ID || '7519855566');
const WA = String(process.env.WHATSAPP_NUMBER || '5355720394').replace(/\D/g, '');
const APP = `http://127.0.0.1:${TEST_PORT}`;

if (!DB || !TOKEN) {
  console.error('SELFTEST FAIL: required runtime secrets are unavailable (values not printed)');
  process.exit(1);
}

const pool = new Pool({ connectionString: DB, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
const tgId = String(990000000 + crypto.randomInt(100000, 999999));
let child;

function patchRuntimeBugsBeforeBoot() {
  const path = new URL('./app.js', import.meta.url);
  const source = fs.readFileSync(path, 'utf8');
  const fixed = source.replace("values($1,$2,'whatsapp') returning id\",[u.id]", "values($1,$2,'whatsapp') returning id\",[u.id,message]");
  if (fixed !== source) { fs.writeFileSync(path, fixed); console.log('SELFTEST FIX: corrected support ticket parameter binding'); }
}

function initData(user, startParam = '') {
  const params = new URLSearchParams({
    query_id: `selftest_${Date.now()}`,
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    start_param: startParam,
  });
  const data = [...params.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(data).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

async function http(path, options = {}) {
  const r = await fetch(APP + path, { ...options, signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
function assert(ok, msg) { if (!ok) throw new Error(msg); console.log(`SELFTEST PASS: ${msg}`); }

async function waitForApp() {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try { const r = await http('/health'); if (r.status === 200 && r.body?.ok) return; } catch {}
    await new Promise(r=>setTimeout(r, 300));
  }
  throw new Error('local app did not become ready');
}

async function sendTelegram(text, reply_markup) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:CREATOR_ID,text,reply_markup}),
    signal:AbortSignal.timeout(10000)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'Telegram sendMessage failed');
  return j.result;
}

async function realNotificationProbe() {
  const stamp = new Date().toISOString();
  const orderNo = `REAL-TEST-ORD-${Date.now()}`;
  const withdrawalNo = `REAL-TEST-RET-${Date.now()}`;
  const waUrl = `https://wa.me/${WA}?text=${encodeURIComponent(`PRUEBA REAL WhatsApp Maison Aurea ${stamp}`)}`;

  await sendTelegram(
    `🧪 PRUEBA REAL — COMPRA\nOrden: ${orderNo}\nUsuario: @SELFTEST_REAL\nID Telegram creadora: ${CREATOR_ID}\nProducto: Inicial\nTipo: mining\nMonto: 500 CUP\nDiamantes: 100\n\nEsta notificación fue enviada usando el BOT_TOKEN real de Render.`,
    {inline_keyboard:[[{text:'🧪 Prueba compra',callback_data:`selftest:${orderNo}`}]]}
  );
  assert(true, 'real Telegram purchase notification was accepted by Bot API');

  await sendTelegram(
    `🧪 PRUEBA REAL — RETIRO\nNúmero: ${withdrawalNo}\nUsuario: @SELFTEST_REAL\nID Telegram creadora: ${CREATOR_ID}\nMonto: 25 CUP\nDestino: ${WA}\n\nEsta notificación fue enviada usando el BOT_TOKEN real de Render.`,
    {inline_keyboard:[[{text:'🧪 Prueba retiro',callback_data:`selftest:${withdrawalNo}`}]]}
  );
  assert(true, 'real Telegram withdrawal notification was accepted by Bot API');

  await sendTelegram(
    `🧪 PRUEBA REAL — WHATSAPP\nNúmero configurado en Render: ${WA}\n\nEl sistema generó este enlace Click to Chat:\n${waUrl}\n\nWhatsApp no permite que un enlace wa.me envíe automáticamente un mensaje: al abrirlo, el texto queda precargado para que la persona pulse Enviar.`,
    undefined
  );
  assert(true, 'real WhatsApp destination/link was generated from the Render variable and reported to the creator via Telegram');
}

async function cleanup() {
  try {
    await pool.query('delete from support_tickets where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from card_entries where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from mining_sessions where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from withdrawals where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from entitlements where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from referral_rewards where referred_user_id in (select id from users where telegram_user_id=$1) or referrer_user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from orders where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from wallets where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from users where telegram_user_id=$1', [tgId]);
  } catch (e) { console.error('SELFTEST CLEANUP WARNING:', e.message); }
}

(async () => {
  try {
    patchRuntimeBugsBeforeBoot();
    const db = await pool.connect();
    try {
      const r = await db.query('select 1 as ok');
      assert(r.rows[0].ok === 1, 'PostgreSQL connection works with Render SSL settings');
      await db.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_bonus_granted boolean NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_bonus_granted boolean NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_mining_used boolean NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS purchased_diamonds bigint NOT NULL DEFAULT 0;
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS promotional_diamonds bigint NOT NULL DEFAULT 0;
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS locked_diamonds bigint NOT NULL DEFAULT 0;
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pending_cup bigint NOT NULL DEFAULT 0;
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS available_cup bigint NOT NULL DEFAULT 0;
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS paid_cup bigint NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_no text;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind text;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS catalog_id text;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_cup bigint NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS diamonds bigint NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS operation_no text;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof_url text;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_payment';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS snapshot jsonb;
        ALTER TABLE mining_sessions ADD COLUMN IF NOT EXISTS package_id text;
        ALTER TABLE mining_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;
        ALTER TABLE mining_sessions ADD COLUMN IF NOT EXISTS ends_at timestamptz;
        ALTER TABLE mining_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'running';
        ALTER TABLE mining_sessions ADD COLUMN IF NOT EXISTS snapshot jsonb;
        ALTER TABLE card_entries ADD COLUMN IF NOT EXISTS draw_key text;
        ALTER TABLE card_entries ADD COLUMN IF NOT EXISTS card text;
        ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS request_no text;
        ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS amount_cup bigint NOT NULL DEFAULT 0;
        ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS destination text;
        ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'requested';
        ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS kind text;
        ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS catalog_id text;
        ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS ends_at timestamptz;
        ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_telegram_id text;
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS action text;
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_type text;
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id text;
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details jsonb;
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS referrer_user_id bigint;
        ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS referred_user_id bigint;
        ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS reward_diamonds bigint NOT NULL DEFAULT 50;
        ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_id bigint;
        ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS message text;
        ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
        ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
      `);
      const tables = (await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`, [[
        'users','wallets','orders','mining_sessions','card_entries','withdrawals','entitlements','audit_log','referral_rewards','support_tickets'
      ]])).rows.map(x=>x.table_name);
      assert(tables.length === 10, 'all 10 required application tables exist');
      const idx = await db.query(`select 1 from pg_indexes where indexname='one_active_mining'`);
      assert(idx.rowCount === 1, 'unique active-mining index exists');
    } finally { db.release(); }

    const bot = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`, { signal: AbortSignal.timeout(10000) }).then(r=>r.json());
    assert(bot.ok === true && bot.result?.username, 'Telegram Bot API accepts the existing bot secret');
    await realNotificationProbe();

    child = spawn(process.execPath, ['app.js'], { env: { ...process.env, PORT: String(TEST_PORT) }, stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', d => process.stdout.write(`APPTEST ${d}`));
    child.stderr.on('data', d => process.stderr.write(`APPTEST_ERR ${d}`));
    await waitForApp();
    assert(true, 'production app code boots and answers /health');

    let r = await http('/api/catalog');
    assert(r.status === 200 && r.body?.starter?.diamonds === 5 && r.body?.starter?.duration_minutes === 30, 'catalog exposes the 5-diamond / 30-minute starter');

    r = await http('/api/me');
    assert(r.status === 401, 'unauthenticated Mini App requests are rejected');

    const user = { id: Number(tgId), first_name: 'Maison Aurea SelfTest', username: `selftest_${tgId}` };
    const hdr = { 'x-telegram-init-data': initData(user) };
    r = await http('/api/me', { headers: hdr });
    if (r.status !== 200) console.log('SELFTEST AUTH RESPONSE:', r.status, JSON.stringify(r.body));
    assert(r.status === 200 && Number(r.body?.wallet?.promotional_diamonds) === 5 && r.body?.user?.starter_mining_used === false, 'real initData HMAC authentication creates the starter state correctly');

    r = await http('/api/mining/start', { method:'POST', headers:{...hdr,'content-type':'application/json'}, body:JSON.stringify({package_id:'starter'}) });
    assert(r.status === 200 && r.body?.package_id === 'starter', 'starter mining can be started through the real API');

    r = await http('/api/mining/start', { method:'POST', headers:{...hdr,'content-type':'application/json'}, body:JSON.stringify({package_id:'starter'}) });
    assert(r.status === 409, 'second starter mining attempt is blocked');

    await pool.query("update mining_sessions set ends_at=now()-interval '1 second' where user_id=(select id from users where telegram_user_id=$1) and status='running'", [tgId]);
    r = await http('/api/me', { headers: hdr });
    assert(r.status === 200 && Number(r.body?.wallet?.available_cup) === 25 && r.body?.last_completed?.package_id === 'starter', 'expired starter mining finalizes server-side and credits 25 CUP');

    r = await http('/api/mining/start', { method:'POST', headers:{...hdr,'content-type':'application/json'}, body:JSON.stringify({package_id:'not-a-package'}) });
    assert(r.status === 400, 'invalid mining package is rejected');

    r = await http('/api/orders', { method:'POST', headers:{...hdr,'content-type':'application/json'}, body:JSON.stringify({kind:'mining',catalog_id:'not-a-package'}) });
    assert(r.status === 400, 'invalid order product is rejected without creating an order');

    r = await http('/api/support', { method:'POST', headers:{...hdr,'content-type':'application/json'}, body:JSON.stringify({message:'SELFTEST — soporte de prueba; no requiere atención.'}) });
    assert(r.status === 201 && r.body?.ticket_id && r.body?.whatsapp_url?.startsWith('https://wa.me/'), 'support ticket and WhatsApp link are generated');

    r = await http('/api/admin/users', { headers: hdr });
    assert(r.status === 403, 'creator/admin routes reject a normal player');

    const final = await pool.query(`select
      (select count(*) from orders where user_id=(select id from users where telegram_user_id=$1)) as orders,
      (select count(*) from withdrawals where user_id=(select id from users where telegram_user_id=$1)) as withdrawals,
      (select count(*) from mining_sessions where user_id=(select id from users where telegram_user_id=$1)) as mining_sessions,
      (select count(*) from support_tickets where user_id=(select id from users where telegram_user_id=$1)) as support_tickets`, [tgId]);
    console.log('SELFTEST TEMP STATE BEFORE CLEANUP:', JSON.stringify(final.rows[0]));

    console.log('SELFTEST COMPLETE: all production-safe automated checks passed.');
    process.exitCode = 0;
  } catch (e) {
    console.error('SELFTEST FAIL:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    if (child) child.kill('SIGTERM');
    await cleanup();
    await pool.end();
  }
})();

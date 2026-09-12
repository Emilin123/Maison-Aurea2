import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const TEST_PORT = 18080;
const DB = process.env.DATABASE_URL;
const TOKEN = process.env.BOT_TOKEN;
const APP = `http://127.0.0.1:${TEST_PORT}`;

if (!DB || !TOKEN) {
  console.error('SELFTEST FAIL: required runtime secrets are unavailable (values not printed)');
  process.exit(1);
}

const pool = new Pool({ connectionString: DB, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
const tgId = String(990000000 + crypto.randomInt(100000, 999999));
let child;

function initData(user, startParam = '') {
  const params = new URLSearchParams({
    query_id: `selftest_${Date.now()}`,
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    start_param: startParam,
  });
  const data = [...params.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}=${v}`).join('\\n');
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

async function cleanup() {
  try {
    await pool.query('delete from support_tickets where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from card_entries where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from mining_sessions where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from withdrawals where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from entitlements where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from referral_rewards where referred_user_id in (select id from users where telegram_user_id=$1) or referrer_user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from audit_log where target_id in (select id::text from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from orders where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from wallets where user_id in (select id from users where telegram_user_id=$1)', [tgId]);
    await pool.query('delete from users where telegram_user_id=$1', [tgId]);
  } catch (e) { console.error('SELFTEST CLEANUP WARNING:', e.message); }
}

(async () => {
  try {
    const db = await pool.connect();
    try {
      const r = await db.query('select 1 as ok');
      assert(r.rows[0].ok === 1, 'PostgreSQL connection works with Render SSL settings');
      const tables = (await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`, [[
        'users','wallets','orders','mining_sessions','card_entries','withdrawals','entitlements','audit_log','referral_rewards','support_tickets'
      ]])).rows.map(x=>x.table_name);
      assert(tables.length === 10, 'all 10 required application tables exist');
      const idx = await db.query(`select 1 from pg_indexes where indexname='one_active_mining'`);
      assert(idx.rowCount === 1, 'unique active-mining index exists');
    } finally { db.release(); }

    const bot = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`, { signal: AbortSignal.timeout(10000) }).then(r=>r.json());
    assert(bot.ok === true && bot.result?.username, 'Telegram Bot API accepts the existing bot secret');

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
    assert(r.status === 200 && r.body?.wallet?.promotional_diamonds === 5 && r.body?.user?.starter_mining_used === false, 'real initData HMAC authentication creates the starter state correctly');

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

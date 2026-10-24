import 'dotenv/config'; import pg from 'pg';
for (const k of ['DATABASE_URL_SESSION','DATABASE_URL_DIRECT','DATABASE_URL']) {
  const c = new pg.Client({connectionString: process.env[k], ssl:{rejectUnauthorized:false}, connectionTimeoutMillis:8000});
  try { await c.connect();
    const t = await c.query("select table_name from information_schema.tables where table_schema='public'");
    const u = await c.query("select count(*) from auth.users");
    console.log(k,'OK public tables:',t.rows.map(r=>r.table_name),'auth users:',u.rows[0].count); await c.end(); break;
  } catch(e){ console.log(k,'FAIL',e.message); }
}

import 'dotenv/config'; import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL_SESSION, ssl:{rejectUnauthorized:false}}); await c.connect();
const r = await c.query(`select (select count(*) from students) students,(select count(*) from sessions) sessions,(select count(*) from leads) leads,(select count(*) from audit_events) audit,(select count(*) from auth.users) users,(select count(*) from schema_migrations) migrations, to_regclass('public.payouts') payouts_table`);
console.log(r.rows[0]); await c.end();

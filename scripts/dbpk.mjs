import 'dotenv/config'; import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL_SESSION, ssl:{rejectUnauthorized:false}}); await c.connect();
console.log((await c.query(`select conrelid::regclass t, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace and contype in ('p','u') and conrelid::regclass::text in ('student_contacts','availability_confirmations','teacher_availability_rules','enrollments') order by 1`)).rows.map(r=>r.t+': '+r.d).join('\n'));
// grants for anon/authenticated on public tables, and RLS flags
console.log((await c.query(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).rows.filter(r=>!r.relrowsecurity));
await c.end();

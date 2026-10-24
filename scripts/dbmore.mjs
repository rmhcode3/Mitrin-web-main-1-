import 'dotenv/config'; import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL_SESSION, ssl:{rejectUnauthorized:false}}); await c.connect();
const q=async s=>(await c.query(s)).rows;
console.log((await q(`select conrelid::regclass t, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace and contype in ('c','f','x') order by 1`)).map(r=>r.t+': '+r.d).join('\n'));
console.log('\nTRIGGERS'); console.log((await q(`select event_object_table t, trigger_name, action_timing||' '||event_manipulation e from information_schema.triggers where trigger_schema='public' order by 1`)).map(r=>`${r.t} ${r.trigger_name} ${r.e}`).join('\n'));
for (const t of ['leads','students','enrollments','sessions','demos','teacher_profiles','teacher_rates','credit_movements','teacher_availability_rules','teacher_leaves']) console.log('\n'+t, JSON.stringify(await q(`select * from ${t} limit 2`)));
console.log('\nlead sources', await q(`select source, stage, group_preference, count(*) from leads group by 1,2,3`));
console.log('\nauth settings'); 
await c.end();

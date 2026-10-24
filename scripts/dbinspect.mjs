import 'dotenv/config'; import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL_SESSION, ssl:{rejectUnauthorized:false}});
await c.connect();
const q = async (s)=> (await c.query(s)).rows;
const cols = await q(`select table_name, string_agg(column_name||':'||data_type||case when is_nullable='NO' then '!' else '' end, ', ' order by ordinal_position) cols from information_schema.columns where table_schema='public' group by table_name order by table_name`);
for (const r of cols) { const n=(await q(`select count(*) from public."${r.table_name}"`))[0].count; console.log(`\n## ${r.table_name} (${n} rows)\n${r.cols}`); }
console.log('\n## FUNCTIONS'); for (const r of await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_function_result(p.oid) res from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`)) console.log(r.proname+'('+r.args+') -> '+r.res);
console.log('\n## ENUMS'); for (const r of await q(`select t.typname, string_agg(e.enumlabel,'|' order by e.enumsortorder) v from pg_type t join pg_enum e on e.enumtypid=t.oid group by 1`)) console.log(r.typname+': '+r.v);
console.log('\n## MIGRATIONS'); try { console.log(await q(`select * from public.schema_migrations`)); } catch(e){console.log(e.message)}
console.log('\n## POLICIES count by table'); console.log(await q(`select tablename, count(*) from pg_policies where schemaname='public' group by 1 order by 1`));
console.log('\n## PROFILES'); console.log(await q(`select id,email,full_name,role,status from public.profiles`).catch(e=>e.message));
await c.end();

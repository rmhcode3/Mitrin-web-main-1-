import 'dotenv/config'; import pg from 'pg'; import fs from 'fs';
const c = new pg.Client({connectionString: process.env.DATABASE_URL_SESSION, ssl:{rejectUnauthorized:false}});
await c.connect(); const q=async s=>(await c.query(s)).rows; let out='';
for (const r of await q(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by p.proname`)) out+=r.d+';\n\n';
out+='\n-- POLICIES\n'; for (const r of await q(`select tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' order by 1,2`)) out+=`${r.tablename} | ${r.policyname} | ${r.cmd} | USING ${r.qual} | CHECK ${r.with_check}\n`;
out+='\n-- SETTINGS DEFS\n'+JSON.stringify(await q(`select * from setting_definitions`),null,1);
out+='\n-- PROFILES perms\n'+JSON.stringify(await q(`select email,role,admin_permissions from profiles`));
out+='\n-- VIEWS\n'; for (const r of await q(`select viewname, definition from pg_views where schemaname='public'`)) out+=r.viewname+':\n'+r.definition+'\n';
fs.writeFileSync(process.argv[2], out); console.log('bytes',out.length); await c.end();

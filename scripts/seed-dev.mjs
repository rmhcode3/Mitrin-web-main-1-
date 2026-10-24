// Development-only sample data: a handful of clearly labelled enquiries so the pipeline is not empty.
// Refuses to run unless ALLOW_DEV_SEED=true, and never touches students, fees, classes, or accounts.
import 'dotenv/config'
import pg from 'pg'

if (process.env.ALLOW_DEV_SEED !== 'true') { console.error('Refusing to seed: set ALLOW_DEV_SEED=true (development databases only).'); process.exit(1) }
if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed in production.'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_SESSION, ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  const existing = (await c.query(`select count(*)::int n from public.leads where notes like '%[sample data]%'`)).rows[0].n
  if (existing) { console.log(`Sample enquiries already present (${existing}). Nothing to do.`); process.exit(0) }
  const langs = (await c.query(`select id from public.languages where active order by name limit 3`)).rows
  if (!langs.length) { console.error('No languages exist yet. Add a language first.'); process.exit(1) }
  const sample = [
    ['Sample Parent One', 'Sample Learner One', '9100000001', 'new', 'Call'], ['Sample Parent Two', 'Sample Learner Two', '9100000002', 'contacted', 'WhatsApp'],
    ['Sample Parent Three', 'Sample Learner Three', '9100000003', 'new', 'Referral'], ['Sample Parent Four', 'Sample Learner Four', '9100000004', 'contacted', 'Email'],
  ]
  for (const [i, [enq, learner, phone, stage, source]] of sample.entries()) {
    await c.query(`insert into public.leads (enquirer_name, learner_name, phone, language_id, level, group_preference, source, stage, notes) values ($1,$2,$3,$4,'Beginner','either',$5,$6,'[sample data]')`, [enq, learner, phone, langs[i % langs.length].id, source, stage])
  }
  console.log(`Inserted ${sample.length} sample enquiries (marked "[sample data]" in their notes).`)
} finally { await c.end() }

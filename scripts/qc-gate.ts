// QC gate for one department shard. Usage: npx tsx scripts/_gate.ts "<Department>"
// Checks the department's outcome + data integrity on its done labs. Prints PASS/FAIL.
process.loadEnvFile('.env.local')
async function main() {
  const dept = process.argv[2]
  if (!dept) { console.log('usage: _gate.ts "<Department>"'); process.exit(1) }
  const { requireSql } = await import('../lib/db')
  const sql = requireSql(); const asRows=(r:any)=>(Array.isArray(r)?r:(r?.rows??[]))
  const normQ=(s:string)=>s.toLowerCase().replace(/[‘’ʼ´`]/g,"'").replace(/[“”]/g,'"').replace(/[‐–—]/g,'-').replace(/…/g,'...').replace(/\s+/g,' ').trim()

  const counts=asRows(await sql.query(`SELECT status, count(*)::int n FROM lab_profiles WHERE department=$1 GROUP BY 1`,[dept]))
  const by:Record<string,number>={}; for(const c of counts) by[c.status]=c.n
  const done=by.done||0, failed=by.failed||0, ns=by.no_sources||0, pending=by.pending||0
  const total=done+failed+ns+pending

  const labs=asRows(await sql.query(`SELECT lab_url, pi_name, pi_email, raw_pages FROM lab_profiles WHERE department=$1 AND status='done'`,[dept]))
  let vbTot=0,vbBad=0,dup=0,emailSet=0,emailUngrounded=0,overview=0,thin=0,chunkSum=0
  const badLabs:string[]=[]
  for(const lab of labs){
    const pages=(typeof lab.raw_pages==='string'?JSON.parse(lab.raw_pages):lab.raw_pages) as Record<string,string>
    const hay=normQ(Object.values(pages??{}).join('\n'))
    const chunks=asRows(await sql.query(`SELECT type,title,source_id,anchor_quote FROM lab_chunks WHERE lab_url=$1`,[lab.lab_url]))
    chunkSum+=chunks.length
    if(chunks.length<5) thin++
    if(chunks.some((c:any)=>c.type==='overview')) overview++
    const seen=new Map<string,number>()
    for(const c of chunks.filter((x:any)=>x.type==='paper')){const k=c.source_id||normQ(String(c.title||''));if(k)seen.set(k,(seen.get(k)||0)+1)}
    for(const[,n]of seen) if(n>1) dup+=n-1
    let labBad=0
    for(const c of chunks) if(c.anchor_quote){vbTot++;if(!hay.includes(normQ(String(c.anchor_quote)))){vbBad++;labBad++}}
    if(lab.pi_email){emailSet++;if(!hay.includes(normQ(String(lab.pi_email))))emailUngrounded++}
    if(labBad>0) badLabs.push(`${lab.pi_name}(${labBad})`)
  }
  const vbPct=vbTot?((1-vbBad/vbTot)*100).toFixed(1):'n/a'
  const doneRate=total?((done/total)*100).toFixed(0):'0'
  console.log(`\n═══ GATE: ${dept} ═══`)
  console.log(`  outcome: ${done} done / ${failed} failed / ${ns} no_sources / ${pending} pending  (done ${doneRate}%)`)
  console.log(`  quality (${labs.length} done): quotes ${vbPct}% verbatim, dup chunks=${dup}, ungrounded emails=${emailUngrounded}/${emailSet}, overview ${overview}/${labs.length}, thin(<5 chunks) ${thin}, avg chunks ${labs.length?(chunkSum/labs.length).toFixed(0):0}`)
  if(badLabs.length) console.log(`  ⚠ labs with non-verbatim quotes (vs full cache): ${badLabs.slice(0,8).join(', ')}`)
  // HARD FAIL (halts the batch) = a QUALITY/CORRECTNESS regression that signals a real bug.
  const fail=[]
  if(Number(vbPct)<99) fail.push(`verbatim ${vbPct}% <99`)
  if(dup>0) fail.push(`${dup} dup chunks`)
  if(emailUngrounded>0) fail.push(`${emailUngrounded} ungrounded emails`)
  // SOFT (warn, don't halt) = throughput/transient, recovered by the final --retry-failed sweep.
  const warn=[]
  if(pending>0) warn.push(`${pending} still pending`)
  if(total>4 && done/total<0.8) warn.push(`done rate ${doneRate}% <80 (load timeouts → retry sweep)`)
  if(warn.length) console.log(`  ⚠ warnings (non-halting): ${warn.join('; ')}`)
  console.log(fail.length?`  ❌ GATE FAIL (quality regression): ${fail.join('; ')}`:`  ✅ GATE PASS`)
  return fail.length === 0
}
main().then((ok)=>process.exit(ok?0:1)).catch(e=>{console.error(e?.message??e);process.exit(2)})

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
const names = ['loadCloudReports', 'syncCloudRecord', 'syncAllLocalReports'];
const source = names.map(name => html.split(/\r?\n/).find(line => line.startsWith(`async function ${name}(`))).join('\n');
function setup() {
  const saved = [];
  const context = vm.createContext({
    currentProfile: { id: 'collector-a', role: 'collector', district: 'เมืองศรีสะเกษ' },
    pendingReports: [], cloudLoading: false,
    db: { surveys: [], adr: [], rankings: [], measures: [] },
    persistPending: () => saved.push('pending'), save: () => saved.push('db'),
    updateCloudStatus: message => saved.push(message), isCloudAdmin: () => false,
    supabaseClient: { from: () => ({ upsert: () => ({ select: async () => ({error: {message: 'network failure'}}) }) }) }
  });
  vm.runInContext(source, context);
  return { context, saved };
}
(async () => {
  const { context: c } = setup();
  const record = { id: 'report-a', district: 'เมืองศรีสะเกษ' };
  assert.equal(await c.syncCloudRecord('surveys', record), false);
  assert.equal(c.pendingReports.length, 1, 'failed uploads remain queued');
  assert.equal(c.pendingReports[0].owner, 'collector-a');
  c.pendingReports.push({ owner: 'collector-b', type: 'surveys', record: {id: 'report-b'} });
  let uploads = 0;
  c.supabaseClient.from = () => ({ upsert: () => ({ select: async () => {
    uploads++; return {data: [{local_id: 'report-a'}], error: null};
  } }) });
  await c.syncAllLocalReports();
  assert.equal(uploads, 1, 'retry only uploads current account queue');
  assert.equal(c.pendingReports.length, 1);
  assert.equal(c.pendingReports[0].owner, 'collector-b');
  c.pendingReports.push({owner: 'collector-a', type: 'surveys', record});
  c.supabaseClient.from = () => ({ select: () => ({order(){return this}, range: async () => ({data: [], error: null})}) });
  await c.loadCloudReports();
  assert.equal(c.db.surveys.length, 1, 'cloud refresh preserves unuploaded report');
  assert.equal(c.db.surveys[0].id, 'report-a');
  c.supabaseClient.from = () => ({ select: () => ({order(){return this}, range: async () => ({data: null, error: {message:'offline'}})}) });
  await c.loadCloudReports();
  assert.equal(c.db.surveys.length, 1, 'failed refresh does not erase reports');
  let pages = 0;
  c.pendingReports = [];
  c.supabaseClient.from = () => ({ select: () => ({order(){return this}, range: async offset => {
    pages++; return {data: offset === 0 ? Array.from({length:1000}, (_,i)=>({report_type:'surveys',payload:{id:String(i)}})) : [{report_type:'surveys',payload:{id:'1000'}}],error:null};
  }}) });
  await c.loadCloudReports();
  assert.equal(pages, 2);
  assert.equal(c.db.surveys.length, 1001, 'read all pages of provincial reports');
  c.pendingReports=[{owner:'collector-a',type:'surveys',record:{id:'same',store:'edited',updated:'new'}}];
  c.supabaseClient.from=()=>({select:()=>({order(){return this},range:async()=>({data:[{report_type:'surveys',local_id:'same',collector_id:'collector-a',payload:{id:'same',store:'old'},updated_at:'old'}],error:null})})});
  await c.loadCloudReports();
  assert.equal(c.db.surveys[0].store,'edited','queued edit wins over stale cloud version');
  c.pendingReports=[];await c.loadCloudReports();
  assert.equal(c.db.surveys[0]._collectorId,'collector-a','ownership comes from the row, not payload');
  assert.equal(await c.syncCloudRecord('surveys',{id:'other',_collectorId:'collector-b'}),false,'collector cannot edit another owner');
  assert.equal(c.pendingReports.length,0,'unauthorized changes are not queued');
  c.currentProfile={id:'admin',role:'provincial_admin'};
  let written;
  c.supabaseClient.from=()=>({upsert:row=>{written=row;return {select:async()=>({data:[{local_id:row.local_id}],error:null})}}});
  await c.syncCloudRecord('surveys',{id:'same',_collectorId:'collector-a',district:'เมืองศรีสะเกษ'});
  assert.equal(written.collector_id,'collector-a','admin editing preserves original ownership');
  console.log('PASS: script syntax, durable retry, account isolation, refresh preservation, pagination');
})().catch(error => {console.error(error); process.exitCode = 1});

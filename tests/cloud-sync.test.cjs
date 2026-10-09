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
  console.log('PASS: script syntax, durable retry, account isolation, refresh preservation, pagination');
})().catch(error => {console.error(error); process.exitCode = 1});

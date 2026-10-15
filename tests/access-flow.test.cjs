const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/function renderDashboard\(\)\{[\s\S]*?\}\nfunction switchPage\(/);
assert.ok(match, 'dashboard renderer should be present');

const nodes = new Map();
const $ = selector => {
  if (!nodes.has(selector)) nodes.set(selector, {textContent: '', innerHTML: ''});
  return nodes.get(selector);
};
const context = {
  $, districts: ['เมืองศรีสะเกษ', 'กันทรลักษ์'],
  provinceSummary: [
    {district: 'เมืองศรีสะเกษ', surveys: 3, high_risk: 1, adr: 2, rankings: 1, measures: 0, problem_score: 25, report_types: 3},
    {district: 'กันทรลักษ์', surveys: 2, high_risk: 1, adr: 1, rankings: 0, measures: 1, problem_score: 20, report_types: 3},
  ],
  db: {surveys: [{district: 'เมืองศรีสะเกษ', store: 'ร้านทดสอบส่วนตัว', score: 20, date: '2026-10-15'}], adr: [], rankings: [], measures: []},
  isCloudAdmin: () => false,
  esc: value => String(value),
  level: () => ['มาก', 'risk-high'],
};
vm.createContext(context);
vm.runInContext(match[0].replace(/\nfunction switchPage\($/, ''), context);
context.renderDashboard();
assert.equal($('#mSurvey').textContent, 5, 'reporter sees province totals, not own-report count');
assert.equal($('#mAdr').textContent, 3);
assert.ok($('#priorityRows').innerHTML.includes('กันทรลักษ์'));
assert.ok(!$('#priorityRows').innerHTML.includes('ร้านทดสอบส่วนตัว'), 'reporter priority table must not expose raw store names');
context.isCloudAdmin = () => true;
context.renderDashboard();
assert.ok($('#priorityRows').innerHTML.includes('ร้านทดสอบส่วนตัว'), 'admin retains detailed priority list');

for (const [number, view] of [[1, 'survey'], [2, 'adr'], [3, 'ranking'], [4, 'measures']]) {
  const wrapper = fs.readFileSync(path.join(root, `report-${number}.html`), 'utf8');
  assert.ok(wrapper.includes(`location.replace('index.html?view=${view}')`));
  assert.ok(!wrapper.includes('<iframe'), 'report link must not nest a second login/app');
}
console.log('PASS: province aggregates, reporter privacy, admin detail, single-window report routes');

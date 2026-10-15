/* Report editing v3. Database RLS remains the authority; UI never infers ownership from district. */
(function () {
  'use strict';
  const types = {surveys:'surveyForm', adr:'adrForm', rankings:'rankingForm', measures:'measuresForm'};
  const pages = {surveys:'survey', adr:'adr', rankings:'ranking', measures:'measures'};
  const editing = new Map();
  const saving = new Set();
  let restoring = false;
  let draftOwner = null;
  const val = (root, name) => root.querySelector(`[name="${name}"]`)?.value || '';
  const canEdit = record => !supabaseClient || Boolean(currentProfile && (
    record._collectorId === currentProfile.id || ['provincial_admin','system_admin'].includes(currentProfile.role)));
  const controls = form => [...form.querySelectorAll('input,select,textarea')].filter(x => x.type !== 'file');
  function controlKey(x) { return x.name || x.id || (x.dataset.code ? x.classList[0]+':'+x.dataset.code : x.classList.contains('nar') ? 'nar:'+x.dataset.q : ''); }
  function snapshot(form) {
    return controls(form).filter(controlKey).map(x => ({key:controlKey(x), value:x.value, checked:x.checked, selectedIndex:x.tagName==='SELECT'?x.selectedIndex:undefined}));
  }
  function applySnapshot(form, items) {
    const buckets = new Map();
    (items||[]).forEach(x => { if(!buckets.has(x.key))buckets.set(x.key,[]); buckets.get(x.key).push(x); });
    controls(form).forEach(x => {
      const saved = buckets.get(controlKey(x))?.shift(); if(!saved)return;
      if(x.type==='checkbox'||x.type==='radio')x.checked=Boolean(saved.checked);
      else { x.value=saved.value; if(x.classList.contains('nar')&&saved.selectedIndex!==undefined)x.selectedIndex=saved.selectedIndex; }
    });
  }
  function setFields(root, data) {
    root.querySelectorAll('[name]').forEach(x => {
      if(x.type==='file'||!(x.name in data))return;
      const value=data[x.name];
      if(x.type==='checkbox'||x.type==='radio')x.checked=Array.isArray(value)?value.includes(x.value):String(value)===x.value;
      else if(value!==null&&typeof value!=='object'){
        if(x.tagName==='SELECT'&&value&&!Array.from(x.options).some(o=>o.value===String(value)))x.add(new Option(String(value),String(value)));
        x.value=value??'';
      }
    });
  }
  function itemNames(problem) {
    if(Array.isArray(problem?.items))return problem.items.map(x=>typeof x==='string'?x:x.name||'');
    if(!problem)return [];
    // Legacy free text is deliberately NOT split on commas: that would invent drug identities.
    const names=Array.from({length:Math.max(1,Number(problem.count)||1)},()=> '');
    names[0]=problem.item||''; return names;
  }
  function drugInputs(code) { return $$(`.drug-list[data-code="${code}"] .drug-name`); }
  function addDrug(code, name='', focus=false) {
    const list=$(`.drug-list[data-code="${code}"] .drug-entries`), row=document.createElement('div');
    row.className='drug-entry';
    const input=document.createElement('input'); input.className='drug-name';input.name='drugName:'+code;input.value=name;input.placeholder='ชื่อยา / ชื่อการค้า (ถ้าไม่ทราบ ให้ระบุไม่ทราบชื่อ)';
    const remove=document.createElement('button');remove.type='button';remove.className='btn small';remove.textContent='ลบ';
    remove.onclick=()=>{if(input.value.trim()&&!confirm('ลบรายการยา “'+input.value+'” หรือไม่?'))return;row.remove();if(!drugInputs(code).length)$(`.problem-found[data-code="${code}"]`).checked=false;syncDrugs(code);queueDraft($('#surveyForm'));};
    row.append(input,remove);list.append(row);syncDrugs(code);if(focus)input.focus();
  }
  function syncDrugs(code) {
    const active=$(`.problem-found[data-code="${code}"]`).checked, inputs=drugInputs(code);
    $(`.problem-count[data-code="${code}"]`).value=active?inputs.length:0;
    $(`.problem-item[data-code="${code}"]`).value=inputs.map(x=>x.value.trim()).filter(Boolean).join('\n');
    inputs.forEach((x,i)=>{x.disabled=!active;x.setAttribute('aria-label',`${code} ชื่อยารายการที่ ${i+1}`);x.nextElementSibling.setAttribute('aria-label',`${code} ลบยารายการที่ ${i+1}`);});
    $(`.drug-list[data-code="${code}"]`).hidden=!active;
    if(!restoring)surveyScore();
  }
  const originalSetProblemEnabled=setProblemEnabled;
  setProblemEnabled=function(code,enabled){
    originalSetProblemEnabled(code,enabled);
    if(code==='D-613')return;
    const list=$(`.drug-list[data-code="${code}"]`);if(!list)return;
    if(enabled&&!drugInputs(code).length)addDrug(code);
    if(!enabled)list.querySelector('.drug-entries').replaceChildren();
    syncDrugs(code);
  };
  problems.forEach(([code])=>{
    const count=$(`.problem-count[data-code="${code}"]`);count.readOnly=true;
    if(code==='D-613')return;
    const list=document.createElement('div');list.className='drug-list';list.dataset.code=code;list.hidden=true;
    list.innerHTML='<div class="drug-entries"></div><button type="button" class="btn drug-add">+ เพิ่มชื่อรายการยา</button><p class="drug-list-note">1 ช่อง = 1 รายการ · จำนวนและคะแนนคำนวณอัตโนมัติ</p>';
    list.querySelector('button').onclick=()=>{addDrug(code,'',true);queueDraft($('#surveyForm'));};
    $(`.problem-item[data-code="${code}"]`).after(list);
  });
  $('#problemRows').addEventListener('input',e=>{if(e.target.matches('.drug-name'))syncDrugs(e.target.closest('.drug-list').dataset.code);});

  function collect(type, form) {
    const base=formObj(form);
    // Repeated controls are represented by typed arrays, never by FormData's last-value entry.
    for(const name of Object.keys(base))if(/^(drugName:|med[A-Z]|event[A-Z]|substance[A-Z]|r(Store|Owner|Address|Score)$|cause$|issue$|method$)/.test(name))delete base[name];
    if(type==='surveys') {
      const score=surveyScore(),causeTotal=causeScore();
      return {...base,score,weightScore:+$('#weightScore').textContent||0,causeScore:causeTotal,totalScore:score+causeTotal,noSurveyIssue:$('#noSurveyIssue').checked,
        found:problems.map(([code,name,points])=>{
          const prior=editing.get('surveys')?.found?.find(x=>x.code===code),names=drugInputs(code).map(x=>x.value.trim());
          const unchangedLegacy=prior&&!Array.isArray(prior.items)&&JSON.stringify(names)===JSON.stringify(itemNames(prior));
          return {code,name,points,count:+$(`.problem-count[data-code="${code}"]`).value||0,item:$(`.problem-item[data-code="${code}"]`).value.trim(),
            ...(code==='D-613'||unchangedLegacy?{}:{items:names})};
        }).filter(x=>x.count),
        substances:$$('#substances .substance').map(x=>({type:val(x,'substanceType'),name:val(x,'substanceName'),detail:val(x,'substanceDetail'),count:+val(x,'substanceCount')||0,photoName:x.querySelector('[name=substancePhoto]').files[0]?.name||x.dataset.photoName||''})),causes:checked(form,'cause')};
    }
    if(type==='adr') {
      const meds=$$('#medications .medication').map(x=>({name:val(x,'medName'),dose:val(x,'medDose'),reason:val(x,'medReason'),start:val(x,'medStart'),end:val(x,'medEnd'),source:val(x,'medSource'),reaction:x.querySelector('[name=medReaction]').checked}));
      const events=$$('#adrEvents .event').map(x=>({med:val(x,'eventMed'),date:val(x,'eventDate'),lag:val(x,'eventLag'),symptom:val(x,'eventSymptom'),systems:checked(x,'eventSystems'),system:checked(x,'eventSystems').join(', '),systemOther:val(x,'eventSystemOther'),severity:val(x,'eventSeverity'),actions:checked(x,'eventActions'),actionOther:val(x,'eventActionOther'),impacts:checked(x,'eventImpacts'),impactOther:val(x,'eventImpactOther'),outcome:val(x,'eventOutcome'),naranjo:x.dataset.legacyNaranjo!==undefined?+x.dataset.legacyNaranjo:+x.querySelector('.narScore').textContent,
        naranjoAnswers:x.dataset.legacyNaranjo!==undefined?null:[...x.querySelectorAll('.nar')].map(s=>({question:+s.dataset.q,score:+s.value,selectedIndex:s.selectedIndex}))}));
      const noMedication=$('#noMedication').checked;
      const meaningfulMeds=noMedication?[]:meds.filter(x=>x.name.trim()||x.dose.trim()||x.reason.trim()||x.source||x.reaction);
      const meaningfulEvents=noMedication?[]:events.filter(x=>x.symptom.trim()||x.systems.length||x.actions.length||x.impacts.length||x.date||x.naranjo);
      return {...base,noMedication,meds:meaningfulMeds,events:meaningfulEvents,totalNaranjo:meaningfulEvents.reduce((n,x)=>n+(x.naranjo||0),0),formRows:{meds,events}};
    }
    if(type==='rankings') {const items=$$('#rankRows tr').map(x=>({store:val(x,'rStore'),owner:val(x,'rOwner'),address:val(x,'rAddress'),score:Math.max(0,Math.round(+val(x,'rScore')||0))}));return {...base,items:items.filter(x=>x.store.trim()||x.owner.trim()||x.address.trim()||x.score),totalScore:items.reduce((n,x)=>n+x.score,0),formRows:{items}};}
    const issues=checked(form,'issue'),methods=checked(form,'method');return {...base,issues,methods,selectedCount:issues.length+methods.length};
  }
  function refreshForm(type) {
    if(type==='surveys'){
      problems.forEach(([code])=>{if(code!=='D-613')syncDrugs(code)});
      ['#surveyProblemsWrap','#surveySubstancesSection','#surveyCauseSection'].forEach(s=>$(s).classList.toggle('hidden',$('#noSurveyIssue').checked));surveyScore();causeScore();
    }
    if(type==='adr'){
      ['#medications','#adrEventSection'].forEach(s=>$(s).classList.toggle('hidden',$('#noMedication').checked));
      $$('#adrEvents fieldset').forEach(f=>{const input=f.querySelector('.other-detail');if(input)input.disabled=![...f.querySelectorAll('input:checked')].some(x=>x.value==='อื่น ๆ');});updateAdrTotals();
    }
    if(type==='rankings')enforceRankIntegers();if(type==='measures')updateMeasureLock();
  }
  function populate(type, record) {
    restoring=true;
    const form=$('#'+types[type]);
    controls(form).forEach(x=>{if(x.type==='checkbox'||x.type==='radio')x.checked=false;else if(x.tagName==='SELECT')x.selectedIndex=0;else x.value='';});
    const district=form.querySelector('[name=district]');
    if(record.district&&!Array.from(district.options).some(x=>x.value===record.district))district.add(new Option(record.district,record.district));
    district.value=record.district||currentProfile?.district||'';district.dispatchEvent(new Event('change'));
    setFields(form,record);
    if(type==='surveys'){
      problems.forEach(([code])=>{
        const p=(record.found||[]).find(x=>x.code===code);$(`.problem-found[data-code="${code}"]`).checked=Boolean(p);
        originalSetProblemEnabled(code,Boolean(p));$(`.problem-count[data-code="${code}"]`).value=p?.count||0;
        if(code!=='D-613'){$(`.drug-list[data-code="${code}"] .drug-entries`).replaceChildren();if(p)itemNames(p).forEach(name=>addDrug(code,name));}
      });
      $('#substances').replaceChildren();(record.substances||[]).forEach(s=>{addSubstance(s);$('#substances .substance:last-child').dataset.photoName=s.photoName||'';});
      surveyScore();$$('#causeGridRows [name=cause]').forEach(x=>x.checked=(record.causes||[]).includes(x.value));$('#noSurveyIssue').checked=Boolean(record.noSurveyIssue);
    }
    if(type==='adr'){
      $('#medications').replaceChildren();$('#adrEvents').replaceChildren();(record.formRows?.meds||record.meds||[]).forEach(addMedication);
      (record.formRows?.events||record.events||[]).forEach(data=>{
        addEvent(data);const el=$('#adrEvents .event:last-child');normalizeNaranjo(el);
        setFields(el,{eventSystems:data.systems||String(data.system||'').split(', '),eventSystemOther:data.systemOther||'',eventSeverity:data.severity,eventActions:data.actions||[],eventActionOther:data.actionOther||data.action||'',eventImpacts:data.impacts||[],eventImpactOther:data.impactOther||''});
        if(data.naranjoAnswers) data.naranjoAnswers.forEach(a=>{const s=el.querySelector(`.nar[data-q="${a.question}"]`);if(s)s.selectedIndex=a.selectedIndex;});
        else if(data.naranjo!==undefined){el.dataset.legacyNaranjo=data.naranjo;el.querySelector('.naranjo-list').insertAdjacentHTML('beforebegin','<p class="hint">ข้อมูลเก่ามีเฉพาะคะแนนรวม ไม่มีคำตอบรายข้อ ระบบเก็บคะแนนเดิมไว้จนกว่าจะแก้คำตอบ Naranjo</p>');}
        calcNaranjo(el);if(el.dataset.legacyNaranjo!==undefined)el.querySelector('.narScore').textContent=data.naranjo;
      });$('#noMedication').checked=Boolean(record.noMedication);
    }
    if(type==='rankings'){$('#rankRows').replaceChildren();(record.formRows?.items||record.items||[]).forEach(addRankRow);}
    if(type==='measures')setFields(form,{issue:record.issues||[],method:record.methods||[]});
    if(record.formState)applySnapshot(form,record.formState);
    restoring=false;refreshForm(type);
  }
  document.addEventListener('change',e=>{if(e.target.matches('.nar'))delete e.target.closest('.event').dataset.legacyNaranjo;});

  function editBanner(type,record) {
    const form=$('#'+types[type]);let banner=form.querySelector('.edit-banner');
    if(!banner){banner=document.createElement('div');banner.className='edit-banner';form.prepend(banner);}
    banner.textContent=record?'กำลังแก้ไขรายงานเดิม · '+(record.store||record.caseId||record.date||record.id)+' · บันทึกแล้วจะปรับปรุงรายการเดิม ไม่สร้างซ้ำ':'กำลังสร้างรายงานใหม่';
    form.querySelector('[type=submit]').textContent=record?'บันทึกการแก้ไข':'บันทึกรายงาน';
  }
  function openRecord(type,id) {
    const record=db[type].find(x=>x.id===id);if(!record||!canEdit(record))return toast('ไม่มีสิทธิ์แก้ไขรายงานนี้');
    const form=$('#'+types[type]);if(saving.has(type))return toast('กำลังบันทึก กรุณารอสักครู่');if(dirtyForms.has(form.id)&&!confirm('มีแบบร่างค้างอยู่ ต้องการแทนที่ด้วยรายงานที่เลือกหรือไม่?'))return;
    clearDraft(form);editing.set(type,structuredClone(record));populate(type,record);editBanner(type,record);switchPage(pages[type]);
    form.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function newReport(type) {
    if(saving.has(type))return toast('กำลังบันทึก กรุณารอสักครู่');
    const form=$('#'+types[type]),context=commonContext(form);clearDraft(form);editing.delete(type);
    populate(type,{...context,date:context.date||today,meds:type==='adr'?[{}]:undefined,events:type==='adr'?[{}]:undefined,items:type==='rankings'?[{}]:undefined});
    editBanner(type,null);$('#surveyResultModal').hidden=true;$('#reportResultModal').hidden=true;
  }
  const history=document.createElement('section');history.className='card';history.id='myReports';
  history.innerHTML='<h2>รายงานของฉัน</h2><p class="sub">เปิดแก้ไขรายงานหลังบันทึก · บันทึกทับรายการเดิมโดยไม่เพิ่มจำนวนรายงาน</p><div class="report-history-tools"><select aria-label="กรองประเภทรายงาน" id="myReportType"><option value="">ทุกประเภท</option></select><input id="myReportSearch" aria-label="ค้นหารายงานของฉัน" placeholder="ค้นหาชื่อร้าน / รหัส / วันที่"></div><div class="report-history-list" id="myReportList"></div>';
  $('#dashboard').append(history);
  Object.entries(reportLabels).forEach(([type,label])=>$('#myReportType').add(new Option(label,type)));
  function renderHistory() {
    const filter=$('#myReportType').value,search=$('#myReportSearch').value.trim().toLowerCase();
    const rows=Object.entries(db).flatMap(([type,records])=>records.filter(r=>canEdit(r)&&(!supabaseClient||r._collectorId===currentProfile?.id||['provincial_admin','system_admin'].includes(currentProfile?.role))).map(record=>({type,record})))
      .filter(({type,record:r})=>(!filter||type===filter)&&[r.store,r.collectionCode,r.caseId,r.district,r.date].join(' ').toLowerCase().includes(search))
      .sort((a,b)=>String(b.record.updated||b.record.created||'').localeCompare(String(a.record.updated||a.record.created||'')));
    $('#myReportList').replaceChildren();
    if(!rows.length){$('#myReportList').textContent='ยังไม่มีรายงานที่แก้ไขได้ หรือไม่พบตามคำค้นหา';return;}
    rows.forEach(({type,record:r})=>{
      const el=document.createElement('div');el.className='report-history-item';
      const text=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p'),button=document.createElement('button');
      title.textContent=reportLabels[type]+' · '+(r.store||r.caseId||r.collectionCode||'');detail.textContent=[r.district,r.date,r.collectionCode,cloudSaveMessage(r)].filter(Boolean).join(' · ');
      button.type='button';button.className='btn primary';button.textContent='เปิดแก้ไข';button.onclick=()=>openRecord(type,r.id);text.append(title,detail);el.append(text,button);$('#myReportList').append(el);
    });
  }
  $('#myReportType').onchange=renderHistory;$('#myReportSearch').oninput=renderHistory;
  Object.entries(types).forEach(([type,id])=>{
    const button=document.createElement('button');button.type='button';button.className='btn history-button';button.textContent='รายงานของฉัน / เปิดแก้ไข';
    button.onclick=()=>{switchPage('dashboard');$('#myReportType').value=type;renderHistory();history.scrollIntoView({behavior:'smooth'});};$('#'+id).prepend(button);
  });
  const originalDashboard=renderDashboard;renderDashboard=function(){originalDashboard();renderHistory();restoreAccountDrafts();};

  // Drafts carry the original record identity and dynamic rows, and are scoped to the signed-in account.
  function draftKey(form){return 'sisaketReportDraftV3:'+(currentProfile?.id||'local')+':'+form.id;}
  clearDraft=function(form){clearTimeout(draftTimer);localStorage.removeItem(draftKey(form));dirtyForms.delete(form.id);};
  saveDraft=function(form){
    if(restoring||cloudRequested&&!currentProfile)return;
    const type=Object.keys(types).find(t=>types[t]===form.id);if(!type)return;
    const record={...collect(type,form),formState:snapshot(form)};
    localStorage.setItem(draftKey(form),JSON.stringify({record,original:editing.get(type)||null}));dirtyForms.add(form.id);
    const label=draftStateEl(form);if(label)label.textContent='บันทึกร่างอัตโนมัติแล้ว';
  };
  queueDraft=function(form){if(restoring)return;dirtyForms.add(form.id);clearTimeout(draftTimer);draftTimer=setTimeout(()=>{for(const id of dirtyForms){const f=$('#'+id);if(f)saveDraft(f);}},450);};
  function restoreAccountDrafts(){
    if(cloudRequested&&!currentProfile)return;const owner=currentProfile?.id||'local';if(draftOwner===owner)return;draftOwner=owner;
    Object.entries(types).forEach(([type,id])=>{
      try{const draft=JSON.parse(localStorage.getItem(draftKey($('#'+id)))||'null');if(!draft)return;
        if(draft.original&&!canEdit(draft.original))return;
        if(draft.original)editing.set(type,draft.original);populate(type,draft.record);editBanner(type,draft.original);dirtyForms.add(id);
      }catch(error){console.warn('Draft could not be restored',id,error.name);}
    });
  }
  // Flush all changed forms on page departure, before the existing unsaved-data warning.
  window.addEventListener('beforeunload',()=>{clearTimeout(draftTimer);for(const id of dirtyForms){const f=$('#'+id);if(f)saveDraft(f);}});
  document.addEventListener('reset',e=>{
    const type=Object.keys(types).find(t=>types[t]===e.target.id);if(!type)return;
    e.preventDefault();e.stopImmediatePropagation();if(confirm('ล้างแบบฟอร์มและเริ่มรายงานใหม่หรือไม่? รายงานที่บันทึกไว้จะไม่ถูกลบ'))newReport(type);
  },true);
  $('#nextStore').onclick=()=>newReport('surveys');$('#nextReport').onclick=()=>activeReportRecord&&newReport(activeReportRecord.report);

  document.addEventListener('click',e=>{
    if(e.target.closest('#logoutButton'))for(const id of dirtyForms){const form=$('#'+id);if(form)saveDraft(form);}
  },true);
  const originalAccess=setAccess;
  setAccess=function(allowed){
    originalAccess(allowed);
    if(!allowed){
      clearTimeout(draftTimer);editing.clear();dirtyForms.clear();draftOwner=null;
      Object.keys(types).forEach(type=>{populate(type,{date:today,round:1,meds:type==='adr'?[{}]:undefined,events:type==='adr'?[{}]:undefined,items:type==='rankings'?[{}]:undefined});editBanner(type,null);});
      $('#surveyResultModal').hidden=true;$('#reportResultModal').hidden=true;renderHistory();
    }
  };

  document.addEventListener('submit',async e=>{
    const type=Object.keys(types).find(t=>types[t]===e.target.id);if(!type)return;
    e.preventDefault();e.stopImmediatePropagation();const form=e.target;if(saving.has(type))return;
    if(cloudRequested&&!currentProfile)return toast('กรุณาเข้าสู่ระบบก่อนบันทึก');
    if(!validateForm(form))return;
    const original=editing.get(type);if(original&&!canEdit(original))return toast('ไม่มีสิทธิ์แก้ไขรายงานนี้');
    saving.add(type);const button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      const fields=collect(type,form),stamp=new Date().toISOString();
      const record={...original,...fields,id:original?.id||crypto.randomUUID(),created:original?.created||stamp,updated:stamp,schemaVersion:3,
        _collectorId:original?._collectorId||currentProfile?.id,formState:snapshot(form)};
      form.inert=true;
      const i=db[type].findIndex(x=>x.id===record.id);if(i<0)db[type].push(record);else db[type][i]=record;
      save();const sent=await syncCloudRecord(type,record);if(sent)loadProvinceSummary();clearDraft(form);editing.set(type,structuredClone(record));editBanner(type,record);renderHistory();
      const status=$('#'+(type==='surveys'?'survey':type==='rankings'?'ranking':type==='measures'?'measures':'adr')+'Status');status.textContent=cloudSaveMessage(record);
      if(type==='surveys')showSurveyResult(record);else showReportResult(type,record);
      toast(sent||!supabaseClient?(original?'บันทึกการแก้ไขแล้ว':'บันทึกรายงานแล้ว'):'เก็บการแก้ไขในเครื่องแล้ว ยังส่งฐานกลางไม่สำเร็จ ระบบจะลองใหม่');
    }catch(error){saveDraft(form);toast('บันทึกไม่สำเร็จ: '+error.message+' กรุณาอย่าปิดหน้าจนกว่าจะสำรองข้อมูล');}
    finally{saving.delete(type);button.disabled=false;form.inert=false;}
  },true);

  function analysisSheets(type,records) {
    // Each existing export row is explicitly linked to its source, including ranking's one-row-per-store export.
    const rows=records.flatMap(r=>exportRows(type,[r]).map(row=>({report_id:r.id,created_at:r.created||'',updated_at:r.updated||r.created||'',...row})));
    return [{name:reportLabels[type],rows},...(type==='surveys'?ReportAnalysis.surveyTables(records):[])];
  }
  function downloadAnalysis(sheets,filename) {
    const blob=new Blob([ReportAnalysis.workbook([...sheets,{name:'คำอธิบายข้อมูล',rows:ReportAnalysis.dictionary}])],{type:'application/vnd.ms-excel;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  exportExcel=function(){
    const type=$('#exportReport').value,district=$('#exportDistrict').value;if(!type)return toast('กรุณาเลือกรายงาน');
    const records=db[type].filter(r=>!district||r.district===district);if(!records.length)return toast('ไม่พบข้อมูลตามตัวกรอง');
    downloadAnalysis(analysisSheets(type,records),`${type}-${district||'ทุกอำเภอ'}-${today}.xml`);toast('ส่งออก Excel พร้อมตารางสำหรับวิเคราะห์แล้ว');
  };
  $('#exportExcel').onclick=exportExcel;
  downloadProvinceWorkbook=function(){
    if(!Object.values(db).some(a=>a.length))return toast('ยังไม่มีรายงาน');
    downloadAnalysis(Object.entries(db).flatMap(([type,records])=>analysisSheets(type,records)),`รายงานรวมจังหวัดศรีสะเกษ-${today}.xml`);
  };
  renderHistory();restoreAccountDrafts();
})();

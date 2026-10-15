/* One report, one problem, one medicine: separate analysis tables linked by report_id. */
(function(root){
  'use strict';
  function surveyTables(records){
    const problems=[],medicines=[],causes=[];
    records.forEach(r=>{
      const context={report_id:r.id,district:r.district||'',subdistrict:r.subdistrict||'',study_group:r.studyGroup||'',store_code:r.collectionCode||r.storeNumber||'',store_name:r.store||'',survey_date:r.date||''};
      (r.found||[]).forEach(p=>{
        const named=Array.isArray(p.items),count=Number(p.count)||0;
        problems.push({...context,problem_code:p.code,problem_name:p.name||'',weight:Number(p.points)||0,item_count:count,problem_score:(Number(p.points)||0)*count,legacy_item_text:named?'':p.item||'',data_format:named?'itemized':p.code==='D-613'?'literacy':'legacy_text'});
        if(p.code==='D-613')return; // Literacy-derived counts are not medicines.
        if(named)p.items.forEach((item,i)=>{
          const name=typeof item==='string'?item:item.name||'';
          medicines.push({...context,problem_code:p.code,item_number:i+1,medicine_name:name,name_status:name.trim()?'ระบุชื่อ':'ยังไม่ระบุชื่อ',legacy_item_text:'',legacy_reported_count:'',data_format:'itemized'});
        });
        else medicines.push({...context,problem_code:p.code,item_number:'',medicine_name:'',name_status:'ข้อมูลเก่าแบบข้อความรวม',legacy_item_text:p.item||'',legacy_reported_count:count,data_format:'legacy_text'});
      });
      (r.causes||[]).forEach(value=>{const [group,code]=value.split('|');causes.push({...context,problem_group:group,cause_code:code||'',selected:1});});
    });
    return [{name:'ปัญหายา',rows:problems},{name:'รายการยา',rows:medicines},{name:'สาเหตุ',rows:causes}];
  }
  const dictionary=[
    {field:'report_id',meaning:'รหัสรายงานถาวร ใช้เชื่อมทุกตาราง การแก้ไขใช้รหัสเดิม'},
    {field:'survey_date',meaning:'วันที่สำรวจ ISO YYYY-MM-DD ปี ค.ศ. เพื่อเรียงและวิเคราะห์'},
    {field:'item_number',meaning:'ลำดับรายการภายใน report_id + problem_code ไม่ใช่รหัสยามาตรฐาน'},
    {field:'item_count',meaning:'จำนวนช่องรายการยา รวมช่องที่ยังไม่ระบุชื่อ; D-613 เป็นจำนวนตามเกณฑ์ความรอบรู้ ไม่ใช่จำนวนยา'},
    {field:'medicine_name',meaning:'ชื่อยาตามผู้กรอก ยังไม่ได้ทำมาตรฐานชื่อสามัญ/ชื่อการค้า'},
    {field:'problem_score',meaning:'weight × item_count; รวมจากตารางปัญหายา อย่ารวมคะแนนรายงานซ้ำจากตารางยา'},
    {field:'legacy_text',meaning:'ข้อมูลเก่าเป็นข้อความรวม เก็บตามเดิม ไม่แยกคำหรือสร้างชื่อยาโดยคาดเดา'},
    {field:'legacy_reported_count',meaning:'จำนวนเดิมที่รายงาน ไม่ใช่จำนวนแถวในตารางรายการยา'},
    {field:'data_format',meaning:'itemized = แยกรายการ; legacy_text = ข้อความรวมเดิม; literacy = ความรอบรู้'},
    {field:'updated_at',meaning:'เวลาบันทึกแก้ไขล่าสุด ISO timestamp; created_at เป็นเวลาสร้างเดิม'},
    {field:'รายการยา',meaning:'ยาเดียวกันอาจพบหลายรหัสปัญหา จึงไม่ใช่จำนวนชื่อยาที่ไม่ซ้ำทั้งร้าน'}
  ];
  const escape=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function workbook(sheets){
    const cell=(v,header=false)=>`<Cell${header?' ss:StyleID="Header"':''}><Data ss:Type="${!header&&typeof v==='number'&&Number.isFinite(v)?'Number':'String'}">${escape(v)}</Data></Cell>`;
    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E5F3EF" ss:Pattern="Solid"/></Style></Styles>'+sheets.filter(s=>s.rows.length).map(s=>{
      const headers=[...new Set(s.rows.flatMap(Object.keys))];
      return `<Worksheet ss:Name="${escape(s.name.slice(0,31))}"><Table><Row>${headers.map(h=>cell(h,true)).join('')}</Row>${s.rows.map(r=>'<Row>'+headers.map(h=>cell(r[h])).join('')+'</Row>').join('')}</Table></Worksheet>`;
    }).join('')+'</Workbook>';
  }
  const api={surveyTables,dictionary,workbook};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReportAnalysis=api;
})(globalThis);

'use strict';
process.env.TZ='America/Toronto';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..'),T=Date.parse('2026-05-30T10:00:00Z'),M=60000;
// Small DOM adapter for action wiring and clock updates; not a visual renderer.
function harness(at=T,{blank=false}={}){
 const nodes=new Map(),children={},listeners={},intervals=[],frames=[];let document,instant=at,estimates=[];
 const camel=s=>s.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 function node(id=''){
  let html='';return{id,dataset:{},checked:false,disabled:false,hidden:false,scrollTop:0,textContent:'',className:'',value:'',
   focus(){document.activeElement=this;},scrollIntoView(options){this.scrolled=options;},closest(){return this;},querySelectorAll(){return[];},
   hasAttribute(name){return name.startsWith('data-')&&Object.hasOwn(this.dataset,camel(name.slice(5)));},
   get innerHTML(){return html;},set innerHTML(value){
    for(const old of children[id]||[])nodes.delete(old);children[id]=[];html=value;
    for(const match of value.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){
     const el=node(match[1]);el.checked=/\schecked(?:\s|>|=)/.test(match[0]);el.disabled=/\sdisabled(?:\s|>|=)/.test(match[0]);el.hidden=/\shidden(?:\s|>|=)/.test(match[0]);el.open=/\sopen(?:\s|>|=)/.test(match[0]);el.value=match[0].match(/\bvalue="([^"]*)"/)?.[1]||'';
     for(const attr of match[0].matchAll(/\bdata-([\w-]+)(?:="([^"]*)")?/g))el.dataset[camel(attr[1])]=attr[2]||'';
     nodes.set(el.id,el);children[id].push(el.id);
    }
    for(const match of value.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
     const option=[...match[2].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];const selected=option.find(o=>o[1].includes('selected'))||option[0];
     if(selected)nodes.get(match[1]).value=selected[1].match(/value="([^"]*)"/)?.[1]||selected[2];
    }
    if(id==='phone-app'||id==='room-list'){
     estimates=[];
     for(const match of value.matchAll(/<[^>]*\bdata-estimate="([^"]+)"[^>]*>([^<]*)/g)){
      const el=node();el.dataset.estimate=match[1];el.textContent=match[2];
      el.dataset.estimatePrefix=match[0].match(/data-estimate-prefix="([^"]*)"/)?.[1]||'';estimates.push(el);
     }
    }
   }};
 }
 for(const match of fs.readFileSync(path.join(ROOT,'index.html'),'utf8').matchAll(/\bid="([^"]+)"/g))nodes.set(match[1],node(match[1]));
 const content=node(),modal=node();
 document={activeElement:null,hidden:false,styles:{},documentElement:{style:{setProperty(k,v){document.styles[k]=v;}}},
  addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){
   if(selector.startsWith('#'))return nodes.get(selector.slice(1))||null;
   if(selector==='.app-content')return nodes.get('phone-app').innerHTML.includes('app-content')?content:null;
   if(selector.startsWith('.modal'))return nodes.get('modal-root').innerHTML?modal:null;
   if(selector==='[data-action="start"]')return nodes.get('start-job')||null;return null;
  },querySelectorAll(selector){return selector==='[data-estimate]'?estimates:[];}};
 class FormDataAdapter{constructor(form){this.data=form.fields;}get(k){return this.data[k]??null;}getAll(k){return this.data[k]||[];}has(k){return!!this.data[k];}}
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
 const fail=()=>{throw new Error('Unexpected network or persistence access');};
 const ctx=vm.createContext({document,console,Date:ClockDate,FormData:FormDataAdapter,setTimeout(){},clearTimeout(){},
  setInterval(fn,delay){intervals.push({fn,delay});},requestAnimationFrame(fn){frames.push(fn);},fetch:fail,localStorage:new Proxy({},{get:fail}),sessionStorage:new Proxy({},{get:fail})});
 vm.runInContext(fs.readFileSync(path.join(ROOT,'domain.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'app.js'),'utf8'),ctx);
 const run=source=>vm.runInContext(source,ctx);
 if(blank)run('simulation=Domain.newState(Date.now(),{seedDemo:false});state=Domain.snapshot(simulation);render();');
 async function click(dataset){const el=dataset.action==='start'&&nodes.has('start-job')?nodes.get('start-job'):node();el.dataset={...el.dataset,...dataset};await listeners.click({target:el});}
 async function change(id,checked){const el=nodes.get(id);assert.ok(el,`${id} exists`);el.checked=checked;await listeners.change({target:el});}
 async function submit(fields){await listeners.submit({target:{id:'request-form',fields},preventDefault(){}});}
 function seed(payloads=[{room_id:'4127',cleaning_class:'enhanced',priority:'urgent',ppe:['Gloves','Gown','Medical mask'],notes:'Please include the area under the bed.',equipment:'Retain and clean the reusable stethoscope.'},
  {room_id:'2150',cleaning_class:'standard',priority:'routine',ppe:[]}]){
  ctx.testPayloads=payloads;run('simulation=Domain.newState(Date.now(),{seedDemo:false});for(const payload of testPayloads)simulation=Domain.transact(simulation,"request",payload);state=Domain.snapshot(simulation);render();');delete ctx.testPayloads;
 }
 return{run,click,change,submit,seed,flushFrames(){while(frames.length)frames.shift()();},async summary(){await listeners.click({target:nodes.get('request-extra-summary')});nodes.get('request-extra-fields').open=!nodes.get('request-extra-fields').open;},nodes,ctx,document,intervals,listeners,estimates:()=>estimates,advance(ms){instant+=ms;},tick(){for(const t of intervals)t.fn();},html:()=>nodes.get('phone-app').innerHTML,rooms:()=>nodes.get('room-list').innerHTML};
}
async function worker(h,id='J001'){await h.click({demo:'evs'});await h.click({task:id});}
async function start(h,id='J001'){await h.change('ppe-confirmed',true);await h.click({action:'start',job:id});}

test('new page has the three demos, one default task, and no storage/network',async()=>{
 const h=harness();for(const text of['Nurse Demo','EVS Worker Demo','EVS Admin Demo'])assert.ok(h.html().includes(text));
 assert.equal(h.run('state.jobs.length'),1);assert.equal(h.run('state.jobs[0].room_id'),'2150');assert.equal(h.run('state.rooms.length'),62);assert.equal(h.run('state.settings.automatic_assignment'),false);
 await h.click({demo:'nurse'});assert.equal([...h.rooms().matchAll(/class="room-card"/g)].length,62);
 assert.ok(!/Unknown|Occupied|Vacant|Ready|As of/.test(h.rooms()));assert.equal([...h.rooms().matchAll(/class="room-state"/g)].length,1);
});
test('blank room detail shows its unit and request entry with no invented status or timestamp',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4127'});
 assert.ok(h.html().includes('Oncology'));assert.ok(h.html().includes('Request cleaning'));
 assert.ok(!/Unknown|Occupied|Vacant|Ready|As of|class="badge/.test(h.html()));
});
test('worker and admin show the one Pediatrics demo request and gain new nurse requests',async()=>{
 const h=harness();await h.click({demo:'evs'});assert.ok(h.html().includes('Room 2150'));
 await h.click({demo:'admin'});assert.ok(h.html().includes('Room 2150'));
 await h.click({demo:'nurse'});await h.click({action:'new-request'});
 await h.submit({room_id:'4100',cleaning_class:'standard',priority:'routine',ppe:[]});
 assert.equal(h.run('state.jobs.length'),2);assert.equal(h.run('state.jobs[1].requested_at'),T);
 await h.click({demo:'evs'});assert.ok(h.html().includes('Room 4100'));
});
test('worker task list is urgent first with PPE and excludes other workers',async()=>{
 const h=harness();h.seed();h.run('simulation=Domain.transact(simulation,"request",{room_id:"4100"});simulation=Domain.transact(simulation,"assign",{job_id:"J003",worker_id:"sam"});state=Domain.snapshot(simulation);');
 await h.click({demo:'evs'});assert.ok(h.html().indexOf('data-task="J001"')<h.html().indexOf('data-task="J002"'));
 for(const text of['Gloves','Gown','No PPE required','task-card urgent'])assert.ok(h.html().includes(text));
 assert.ok(!h.html().includes('Room 4100'));assert.ok(!h.html().includes('evs-worker'));
});
test('accepting without acknowledgement preserves paired controls and room status Requested',async()=>{
 const h=harness();h.seed();await worker(h);assert.equal(h.nodes.get('start-job').disabled,true);assert.ok(h.html().includes('Accept job'));
 await h.click({action:'accept-job',job:'J001'});assert.equal(h.run('state.jobs[0].status'),'assigned');assert.ok(h.html().includes('Cancel job'));
 assert.ok(!h.html().includes('Accept job'));assert.equal(h.nodes.get('start-job').disabled,true);
 await h.click({demo:'nurse'});await h.click({room:'4127'});assert.ok(h.html().includes('Requested'));assert.ok(!h.html().includes('>Assigned<'));
});
test('checkbox gates direct start; start has Cancel job and Mark as done side by side',async()=>{
 const h=harness();h.seed();await worker(h);await h.click({action:'start',job:'J001'});assert.equal(h.run('state.jobs[0].status'),'queued');
 await start(h);assert.equal(h.run('state.jobs[0].status'),'cleaning');
 assert.match(h.html(),/worker-actions paired-actions">.*>Cancel job<\/button>.*>Mark as done<\/button>/);
 assert.ok(!h.html().includes('Accept job'));assert.ok(!h.nodes.has('ppe-confirmed'));
});
test('worker cancel releases active cleaning back to Requested and restores original controls',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({action:'release-job',job:'J001'});
 assert.equal(h.run('state.jobs[0].status'),'queued');assert.ok(h.html().includes('Accept job'));assert.equal(h.nodes.get('start-job').disabled,true);
 assert.equal(h.run('state.rooms.find(r=>r.id==="4127").last_cleaned_at'),null);
});
test('acknowledgement persists when the same task is accepted before starting',async()=>{
 const h=harness();h.seed();await worker(h);await h.change('ppe-confirmed',true);await h.click({action:'accept-job',job:'J001'});
 assert.equal(h.nodes.get('ppe-confirmed').checked,true);assert.equal(h.nodes.get('start-job').disabled,false);
});
test('role switching preserves requests, claims, and settings',async()=>{
 const h=harness();h.seed();await worker(h);await h.click({action:'accept-job',job:'J001'});await h.click({action:'main-menu'});
 assert.equal(h.run('role'),'menu');await h.click({demo:'nurse'});await h.click({room:'4127'});assert.ok(h.html().includes('Maya Chen'));
 assert.equal(h.run('state.jobs[0].status'),'assigned');
});
test('admin auto-assignment is off initially and applies only to new requests',async()=>{
 const h=harness();h.seed();await h.click({demo:'admin'});await h.click({adminScreen:'settings'});assert.equal(h.nodes.get('auto-assign').checked,false);
 await h.change('auto-assign',true);await h.click({demo:'nurse'});await h.click({action:'new-request'});
 await h.submit({room_id:'4100',cleaning_class:'standard',priority:'routine',ppe:[]});
 assert.equal(h.run('state.jobs[2].worker_id'),'maya');assert.equal(h.run('state.jobs[0].status'),'queued');assert.ok(h.html().includes('No PPE required'));
});
test('admin can assign to the demo worker and the worker sees Cancel job',async()=>{
 const h=harness();h.seed();await h.click({demo:'admin'});await h.click({adminTask:'J001'});await h.click({action:'admin-assign',job:'J001'});
 assert.equal(h.run('state.jobs[0].worker_id'),'maya');await worker(h);assert.ok(h.html().includes('Cancel job'));
});
test('request form uses all new room ranges, optional PPE, and 20/30-minute defaults',async()=>{
 const h=harness(T,{blank:true});await h.click({demo:'nurse'});await h.click({action:'new-request'});
 for(const text of['Standard (20 min)','Enhanced (30 min)','Urgent','(optional)','4100 · Cardiology','4120 · Cardiology','4121 · Oncology','4140 · Oncology','2150 · Pediatrics','2170 · Pediatrics'])assert.ok(h.html().includes(text),text);
 assert.ok(!h.html().includes('Medicine'));assert.ok(!h.html().includes('vacant'));assert.ok(h.html().includes('Available for cleaning'));assert.ok(h.html().includes('value="now" checked'));assert.ok(!h.html().includes('name="available"'));
 await h.submit({room_id:'2150',cleaning_class:'enhanced',priority:'urgent',ppe:[]});assert.equal(h.run('state.jobs[0].duration'),30);
});
test('nurse detail has paired Edit/Cancel and the Edit form is prefilled and saves one request',async()=>{
 const h=harness();h.seed();await h.click({demo:'nurse'});await h.click({room:'4127'});
 assert.match(h.html(),/class="paired-actions">.*>Edit<\/button>.*>Cancel<\/button>/);assert.ok(!h.html().includes('data-action="priority"'));
 await h.click({action:'edit-request',job:'J001'});assert.ok(h.html().includes('Save changes'));assert.equal(h.nodes.get('request-room').disabled,true);
 assert.match(h.html(),/<option value="enhanced" selected>/);assert.match(h.html(),/value="urgent" checked/);
 for(const ppe of ['Gloves','Gown','Medical mask'])assert.ok(h.html().includes(`value="${ppe}" checked`));
 assert.ok(h.html().includes('Please include the area under the bed.'));assert.ok(h.html().includes('value="Retain and clean'));assert.ok(!h.html().includes('name="available"'));
 await h.submit({cleaning_class:'standard',priority:'routine',ppe:[],equipment:'',notes:'Updated instructions'});
 assert.equal(h.run('screen'),'detail');assert.equal(h.run('state.jobs.length'),2);assert.equal(h.run('state.jobs[0].duration'),20);
 await worker(h);assert.ok(h.html().includes('Updated instructions'));assert.ok(h.html().includes('No PPE required'));
});
test('back from Edit changes nothing; confirmed Nurse Cancel leaves no cleaning information',async()=>{
 const h=harness();h.seed();await h.click({demo:'nurse'});await h.click({room:'4127'});await h.click({action:'edit-request',job:'J001'});
 await h.click({screen:'detail'});assert.equal(h.run('state.jobs[0].priority'),'urgent');
 await h.click({action:'cancel-request',job:'J001'});assert.equal(h.run('state.jobs[0].status'),'queued');
 await h.click({action:'close-modal'});assert.equal(h.run('state.jobs[0].status'),'queued');
 await h.click({action:'cancel-request',job:'J001'});await h.click({action:'confirm-cancel',job:'J001'});
 assert.equal(h.run('state.jobs[0].status'),'cancelled');assert.ok(!/Unknown|Vacant|Ready|As of|class="badge/.test(h.html()));
});
test('completion uses real elapsed time and displays a quiet Cleaned timestamp',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);h.advance(14*M);await h.click({action:'complete-job',job:'J001'});
 assert.equal(h.run('screen'),'tasks');assert.ok(!h.html().includes('data-task="J001"'));assert.equal(h.run('state.jobs[0].completed_at'),T+14*M);
 await h.click({demo:'nurse'});assert.ok(h.rooms().includes('As of 06:14, 05/30'));assert.ok(h.rooms().includes('badge cleaned'));
 assert.ok(!h.rooms().includes('Ready'));await h.click({room:'4127'});assert.ok(h.html().includes('As of 06:14, 05/30'));
 assert.ok(!h.html().includes('data-action="edit-request"'));h.advance(60*M);h.tick();assert.ok(h.html().includes('As of 06:14, 05/30'));
});
test('Nurse lists sort Cleaning, Requested, Cleaned, then rooms with no history',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({action:'complete-job',job:'J001'});
 await worker(h,'J002');await start(h,'J002');await h.click({demo:'nurse'});await h.click({action:'new-request'});
 await h.submit({room_id:'4100',cleaning_class:'standard',priority:'routine',ppe:[]});await h.click({screen:'rooms'});
 const ids=[...h.rooms().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]);assert.deepEqual(ids.slice(0,3),['2150','4100','4127']);assert.equal(ids.length,62);
 await h.click({filter:'cleaned'});assert.deepEqual([...h.rooms().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]),['4127']);
 await h.click({filter:'requested'});assert.deepEqual([...h.rooms().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]),['4100']);
 await h.click({filter:'all'});const unit=h.nodes.get('unit-filter');unit.value='Pediatrics';await h.listeners.change({target:unit});
 assert.equal([...h.rooms().matchAll(/class="room-card"/g)].length,21);assert.ok(!h.rooms().includes('Oncology'));
 await h.click({screen:'requests'});assert.deepEqual([...h.html().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]),['2150','4100','4127']);
});
test('actual clock formatting handles local midnight and dates without day rollover errors',()=>{
 const h=harness(Date.parse('2026-05-31T03:59:00Z'));assert.equal(h.nodes.get('phone-time').textContent,'23:59');
 assert.equal(h.run('asOf(Date.now())'),'As of 23:59, 05/30');h.advance(2*M);h.tick();
 assert.equal(h.nodes.get('phone-time').textContent,'00:01');assert.equal(h.run('asOf(Date.now())'),'As of 00:01, 05/31');
});
test('live estimates update text without replacing controls or clearing acknowledgement',async()=>{
 const h=harness();h.seed();await worker(h);await h.click({action:'accept-job',job:'J001'});await h.change('ppe-confirmed',true);
 const checkbox=h.nodes.get('ppe-confirmed'),button=h.nodes.get('start-job'),before=h.estimates()[0].textContent;
 h.advance(5*M);h.tick();assert.equal(h.nodes.get('ppe-confirmed'),checkbox);assert.equal(checkbox.checked,true);assert.equal(h.nodes.get('start-job'),button);
 assert.notEqual(h.estimates()[0].textContent,before);assert.equal(h.estimates()[0].textContent,'06:42, 05/30');assert.equal(h.nodes.get('start-job').disabled,false);
});
test('clock refresh preserves unsaved form fields and refreshes immediately on visibility return',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'new-request'});
 const note=h.nodes.get('nurse-note');note.value='Unsent note';h.advance(2*M);h.tick();assert.equal(h.nodes.get('nurse-note'),note);assert.equal(note.value,'Unsent note');
 h.advance(3*M);h.listeners.visibilitychange();assert.equal(h.nodes.get('phone-time').textContent,'06:05');
});
test('withdrawal after a repeat request displays the earlier cleaning timestamp again',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({action:'complete-job',job:'J001'});h.advance(60*M);
 await h.click({demo:'nurse'});await h.click({room:'4127'});await h.click({action:'new-request',roomId:'4127'});
 await h.submit({room_id:'4127',cleaning_class:'standard',priority:'routine',ppe:[]});
 await h.click({action:'cancel-request',job:'J003'});await h.click({action:'confirm-cancel',job:'J003'});
 assert.ok(h.html().includes('Cleaned'));assert.ok(h.html().includes('As of 06:00, 05/30'));
});
test('user instructions stay escaped in detail, cards, and prefilled edit fields',async()=>{
 const h=harness();h.seed();h.run('simulation.jobs[0].notes="<img src=x onerror=alert(1)>";simulation.jobs[0].equipment="\\\" onfocus=alert(1)";state=Domain.snapshot(simulation);selectedRoom="4127";selectedTask="J001";');
 for(const fn of['nurseDetail','evsDetail']){const html=h.run(`${fn}()`);assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'));}
 await h.click({demo:'nurse'});await h.click({room:'4127'});await h.click({action:'edit-request',job:'J001'});
 assert.ok(h.html().includes('&quot; onfocus'));assert.ok(!h.html().includes('value="" onfocus='));
});
test('fresh page resets to just the default request at its actual current time',async()=>{
 const a=harness();a.seed();await worker(a);await hAccept(a);const b=harness(T+60*M);
 assert.equal(b.run('role'),'menu');assert.equal(b.run('state.jobs.length'),1);assert.equal(b.run('state.jobs[0].room_id'),'2150');assert.equal(b.run('state.settings.now'),T+60*M);
 assert.equal(b.run('state.rooms.every(r=>r.last_cleaned_at===null)'),true);
 async function hAccept(h){await h.click({action:'accept-job',job:'J001'});}
});
test('persistent demo footer and relative assets still support phone and GitHub project URLs',()=>{
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');assert.ok(html.indexOf('data-action="main-menu"')>html.indexOf('id="phone-app"'));
 assert.ok(html.indexOf('data-action="main-menu"')<html.indexOf('class="phone-safe-area"'));assert.ok(!html.includes('08:00'));
 for(const asset of [...html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)].map(m=>m[1])){
  assert.ok(fs.existsSync(path.join(ROOT,asset)));assert.ok(new URL(asset,'https://example.github.io/evsync/').pathname.startsWith('/evsync/'));
 }
});
test('mobile viewport adapter tracks the keyboard and preserves user zoom',()=>{
 const h=harness();h.ctx.window={visualViewport:{height:740,scale:1},innerHeight:800};h.run('fitViewport()');assert.equal(h.document.styles['--app-height'],'740px');
 h.ctx.window.visualViewport.height=420;h.run('fitViewport()');assert.equal(h.document.styles['--app-height'],'420px');
 h.ctx.window.visualViewport.scale=2;h.ctx.window.visualViewport.height=200;h.run('fitViewport()');assert.equal(h.document.styles['--app-height'],'420px');
});

test('the single default request demonstrates the original stethoscope instruction',async()=>{
 const h=harness();await worker(h);assert.ok(h.html().includes('Room 2150'));assert.ok(h.html().includes('Pediatrics'));
 assert.ok(h.html().includes('Retain and clean the reusable stethoscope. Do not discard.'));
 await h.click({demo:'nurse'});await h.click({room:'2150'});await h.click({action:'edit-request',job:'J001'});
 assert.equal(h.nodes.get('use-floor-defaults').checked,true);assert.equal(h.nodes.get('equipment').value,'');
});
test('opening the large notes section scrolls new content into view, while closing does not',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'new-request'});
 assert.equal(h.nodes.get('request-extra-fields').open,false);await h.summary();h.flushFrames();
 assert.equal(h.nodes.get('request-extras').scrolled.block,'start');assert.equal(h.nodes.get('request-extras').scrolled.behavior,'smooth');
 h.nodes.get('request-extras').scrolled=null;await h.summary();h.flushFrames();assert.equal(h.nodes.get('request-extras').scrolled,null);
});
test('floor default preview follows room selection without overwriting notes or custom equipment',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'new-request'});
 assert.equal(h.nodes.get('floor-default-options').hidden,false);assert.equal(h.nodes.get('use-floor-defaults').checked,false);
 h.nodes.get('nurse-note').value='Keep this note';h.nodes.get('equipment').value='Keep monitor';
 const select=h.nodes.get('request-room');select.value='4100';await h.listeners.change({target:select});
 assert.equal(h.nodes.get('floor-default-options').hidden,true);assert.equal(h.nodes.get('use-floor-defaults').disabled,true);
 select.value='2151';await h.listeners.change({target:select});assert.equal(h.nodes.get('floor-default-options').hidden,false);
 assert.match(h.nodes.get('floor-default-preview').textContent,/stethoscope/);assert.equal(h.nodes.get('nurse-note').value,'Keep this note');assert.equal(h.nodes.get('equipment').value,'Keep monitor');
});
test('selected floor defaults appear with custom instructions in Nurse and EVS details',async()=>{
 const h=harness(T,{blank:true});await h.click({demo:'nurse'});await h.click({action:'new-request'});
 await h.submit({room_id:'2151',cleaning_class:'standard',priority:'routine',ppe:[],availability_mode:'now',use_floor_defaults:true,equipment:'Keep monitor.',notes:'Please knock.'});
 for(const phrase of['Do not discard.','Keep monitor.','Please knock.'])assert.ok(h.html().includes(phrase));
 await worker(h);assert.ok(h.html().includes('Do not discard.'));assert.ok(h.html().includes('Keep monitor.'));
});
test('Now is selected by default and future date controls are hidden and disabled',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'new-request'});
 assert.equal(h.nodes.get('availability-now').checked,true);assert.equal(h.nodes.get('availability-fields').hidden,true);assert.equal(h.nodes.get('availability-fields').disabled,true);
 assert.equal(h.nodes.get('available-from').value,'2026-05-30T06:30');assert.equal(h.nodes.get('available-until').value,'2026-05-30T07:30');
 assert.ok(!h.html().includes('Room is available for cleaning.'));
});
test('Later reveals and scrolls the time window; accepting early leaves Start now disabled',async()=>{
 const h=harness(T,{blank:true});await h.click({demo:'nurse'});await h.click({action:'new-request'});
 await h.change('availability-later',true);h.flushFrames();assert.equal(h.nodes.get('availability-fields').hidden,false);assert.equal(h.nodes.get('availability-fields').disabled,false);
 assert.equal(h.nodes.get('availability-fields').scrolled.block,'start');
 await h.submit({room_id:'4127',cleaning_class:'standard',priority:'routine',ppe:[],availability_mode:'later',available_from:'2026-05-30T06:30',available_until:'2026-05-30T07:30'});
 assert.equal(h.run('state.jobs[0].available_from'),T+30*M);assert.ok(h.html().includes('06:30, 05/30'));
 await h.click({demo:'evs'});assert.ok(h.html().includes('From 06:30, 05/30'));await h.click({task:'J001'});
 await h.click({action:'accept-job',job:'J001'});await h.change('ppe-confirmed',true);
 assert.equal(h.nodes.get('start-job').disabled,true);assert.match(h.nodes.get('start-restriction').textContent,/not available/);
 h.advance(30*M);h.tick();assert.equal(h.nodes.get('start-job').disabled,false);assert.equal(h.nodes.get('start-restriction').hidden,true);
 await h.click({action:'start',job:'J001'});assert.equal(h.run('state.jobs[0].started_at'),T+30*M);
});
test('a window that no longer has room for cleaning disables Start now while retaining the claim',async()=>{
 const h=harness();h.seed([{room_id:'4100',availability_mode:'later',available_from:T+30*M,available_until:T+60*M}]);
 await worker(h);await h.click({action:'accept-job',job:'J001'});await h.change('ppe-confirmed',true);h.advance(41*M);h.tick();
 assert.equal(h.nodes.get('start-job').disabled,true);assert.match(h.nodes.get('start-restriction').textContent,/no longer fits/);
 await h.click({action:'start',job:'J001'});assert.equal(h.run('state.jobs[0].status'),'assigned');assert.ok(h.html().includes('Cancel job'));
});
test('future windows can have no end, and the edit form preserves local dates',async()=>{
 const h=harness(T,{blank:true});await h.click({demo:'nurse'});await h.click({action:'new-request'});
 await h.submit({room_id:'2151',cleaning_class:'standard',priority:'routine',ppe:[],availability_mode:'later',available_from:'2026-05-30T06:30',available_until:''});
 assert.equal(h.run('state.jobs[0].available_until'),null);await h.click({action:'edit-request',job:'J001'});
 assert.equal(h.nodes.get('availability-later').checked,true);assert.equal(h.nodes.get('available-from').value,'2026-05-30T06:30');assert.equal(h.nodes.get('available-until').value,'');
 await h.submit({cleaning_class:'standard',priority:'routine',ppe:[],availability_mode:'now'});
 assert.equal(h.run('state.jobs[0].availability_mode'),'now');assert.equal(h.run('state.jobs.length'),1);
});
test('invalid scheduled dates show a form error and preserve unsaved text',async()=>{
 const h=harness(T,{blank:true});await h.click({demo:'nurse'});await h.click({action:'new-request'});
 const note=h.nodes.get('nurse-note');note.value='Unsent note';
 await h.submit({room_id:'2151',cleaning_class:'standard',priority:'routine',ppe:[],availability_mode:'later',available_from:'2026-05-30T05:30'});
 assert.equal(h.run('state.jobs.length'),0);assert.match(h.nodes.get('form-error').textContent,/future start/);
 assert.equal(h.nodes.get('nurse-note'),note);assert.equal(note.value,'Unsent note');
});

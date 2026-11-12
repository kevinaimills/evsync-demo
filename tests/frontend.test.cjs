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
   focus(){document.activeElement=this;},scrollIntoView(options){this.scrolled=options;},rect:{top:0,bottom:0,height:0},getBoundingClientRect(){return this.rect;},scrollTo(options){this.scrolled=options;this.scrollTop=options.top;},closest(){return this;},querySelectorAll(){return[];},
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
    for(const match of value.matchAll(/<textarea[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))nodes.get(match[1]).value=match[2];
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
 const content=node(),modal=node();content.rect={top:100,bottom:600,height:500};
 document={activeElement:null,hidden:false,styles:{},themeMeta:{content:'#e8eef5',setAttribute(name,value){this[name]=value;}},documentElement:{dataset:{},style:{setProperty(k,v){document.styles[k]=v;}}},
  addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){
   if(selector==='meta[name="theme-color"]')return document.themeMeta;
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
 async function change(id,value){const el=nodes.get(id);assert.ok(el,`${id} exists`);if(typeof value==='boolean')el.checked=value;else el.value=String(value);await listeners.change({target:el});}

 async function submit(fields,id='request-form'){await listeners.submit({target:{id,fields},preventDefault(){}});}
 function seed(payloads=[{room_id:'4127',cleaning_class:'extra',priority:'urgent',ppe:['Gloves','Gown','Medical mask'],notes:'Please include the area under the bed.'},
  {room_id:'2150',cleaning_class:'basic',priority:'routine',ppe:[]}]){
  ctx.testPayloads=payloads;run('simulation=Domain.newState(Date.now(),{seedDemo:false});for(const payload of testPayloads)simulation=Domain.transact(simulation,"request",payload);state=Domain.snapshot(simulation);render();');delete ctx.testPayloads;
 }
 return{run,click,change,submit,seed,flushFrames(){while(frames.length)frames.shift()();},nodes,ctx,document,content,intervals,listeners,estimates:()=>estimates,advance(ms){instant+=ms;},tick(){for(const t of intervals)t.fn();},html:()=>nodes.get('phone-app').innerHTML,rooms:()=>nodes.get('room-list').innerHTML};
}
async function worker(h,id='J001'){await h.click({demo:'evs'});await h.click({task:id});}
async function start(h,id='J001'){await h.change('ppe-confirmed',true);await h.click({action:'start',job:id});}

const requestFields=(extra={})=>{const data={room_id:'4100',cleaning_class:'basic',priority:'routine',ppe:[],notes:'',availability_option:'now',...extra};if(extra.availability_mode)data.availability_option=extra.availability_mode==='later'?'custom':'now';delete data.availability_mode;return data;};
const actionArea=h=>h.html().slice(h.html().indexOf('worker-action-area'));

test('initial menu and single demo request retain the 62-room local-only setup',async()=>{
 const h=harness();for(const text of['Nurse Demo','EVS Worker Demo','EVS Admin Demo'])assert.ok(h.html().includes(text));
 assert.equal(h.run('state.jobs.length'),1);assert.equal(h.run('state.jobs[0].room_id'),'2150');assert.equal(h.run('state.settings.automatic_assignment'),false);
 await h.click({demo:'nurse'});assert.equal([...h.rooms().matchAll(/class="room-card"/g)].length,62);assert.ok(!/Unknown|Occupied|Vacant|Ready|As of/.test(h.rooms()));
});
test('Nurse Rooms and Requests have styled icon headings',async()=>{
 const h=harness();await h.click({demo:'nurse'});assert.match(h.html(),/class="screen-title"><span class="title-mark"/);assert.ok(h.html().includes('<span>Rooms</span>'));
 await h.click({screen:'requests'});assert.ok(h.html().includes('<span>My requests</span>'));assert.ok(h.html().includes('class="title-mark"'));
});
test('an inactive room opens its preselected request form directly',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4127'});
 assert.equal(h.run('screen'),'form');assert.equal(h.nodes.get('request-room').value,'4127');assert.ok(h.html().includes('Request cleaning'));
 assert.ok(h.html().includes('Send request'));assert.ok(!h.html().includes('No active cleaning request'));
 await h.submit(requestFields({room_id:'4127'}));assert.equal(h.run('screen'),'detail');assert.equal(h.run('state.jobs[1].room_id'),'4127');
});
test('active rooms still open details with Edit and Cancel',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'2150'});assert.equal(h.run('screen'),'detail');
 assert.match(h.html(),/paired-actions">.*>Edit<\/button>.*>Cancel<\/button>/);assert.ok(h.html().includes('data-action="edit-request"'));
});
test('Back returns to the originating Nurse list and Edit returns to active details',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({screen:'requests'});await h.click({room:'2150'});
 assert.match(h.html(),/class="back-button" data-screen="requests"/);await h.click({action:'edit-request',job:'J001'});assert.match(h.html(),/data-screen="detail"/);
 await h.click({screen:'detail'});await h.click({screen:'requests'});assert.equal(h.run('screen'),'requests');
 await h.click({screen:'rooms'});await h.click({room:'4100'});assert.match(h.html(),/class="back-button" data-screen="rooms"/);
});
test('a Cleaned room opens a new form without changing its historical timestamp',async()=>{
 const h=harness();await worker(h);await start(h);h.advance(14*M);await h.click({action:'complete-job',job:'J001'});
 await h.click({demo:'nurse'});assert.ok(h.rooms().includes('Cleaned 05/30/26, 06:14'));await h.click({room:'2150'});
 assert.equal(h.run('screen'),'form');assert.equal(h.nodes.get('request-room').value,'2150');assert.equal(h.run('state.jobs.length'),1);
 await h.click({screen:'rooms'});assert.ok(h.rooms().includes('Cleaned 05/30/26, 06:14'));
});
test('Nurse cancellation asks for confirmation, then returns to the list',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'2150'});await h.click({action:'cancel-request',job:'J001'});
 assert.equal(h.run('state.jobs[0].status'),'queued');await h.click({action:'close-modal'});assert.equal(h.run('state.jobs[0].status'),'queued');
 await h.click({action:'cancel-request',job:'J001'});await h.click({action:'confirm-cancel',job:'J001'});
 assert.equal(h.run('screen'),'rooms');assert.equal(h.run('state.jobs[0].status'),'cancelled');await h.click({room:'2150'});assert.equal(h.run('screen'),'form');
});
test('the request form uses clear questions, Basic/Extra choices, and one notes field',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});
 for(const text of['Which room?','When will the room be available?','How much cleaning is required?','How urgent is this request?','What PPE is required?','Any additional instructions?','Basic','Extra','20 min','30 min'])assert.ok(h.html().includes(text),text);
 assert.equal([...h.html().matchAll(/name="cleaning_class"/g)].length,2);assert.equal([...h.html().matchAll(/<textarea/g)].length,1);
 assert.ok(!/Enhanced|Specialist|Standard|Equipment instructions|Use floor defaults/.test(h.html()));assert.ok(!h.html().includes('<details'));
});
test('worker details have one initial Start cleaning now button; acknowledgement gates it',async()=>{
 const h=harness();await worker(h);assert.ok(h.html().includes('Retain and clean the reusable stethoscope. Do not discard.'));
 assert.ok(actionArea(h).includes('Start cleaning now'));assert.equal([...actionArea(h).matchAll(/<button/g)].length,1);assert.equal(h.nodes.get('start-job').disabled,true);
 assert.ok(!/Accept job|Cancel job|Start now/.test(h.html()));await h.click({action:'start',job:'J001'});assert.equal(h.run('state.jobs[0].status'),'queued');
 await start(h);assert.equal(h.run('state.jobs[0].status'),'cleaning');assert.match(actionArea(h),/paired-actions">.*>Cancel<\/button>.*>Mark as done<\/button>/);
 assert.equal([...actionArea(h).matchAll(/<button/g)].length,2);
});
test('worker Cancel restores a single start button and keeps the request available',async()=>{
 const h=harness();await worker(h);await start(h);await h.click({action:'release-job',job:'J001'});
 assert.equal(h.run('state.jobs[0].status'),'queued');assert.equal([...actionArea(h).matchAll(/<button/g)].length,1);assert.ok(h.html().includes('Start cleaning now'));
 assert.equal(h.nodes.get('start-job').disabled,true);assert.match(h.html(),/stethoscope/);assert.equal(h.run('state.rooms.find(r=>r.id==="2150").last_cleaned_at'),null);
});
test('Mark as done records actual completion and removes the task from the worker list',async()=>{
 const h=harness();await worker(h);await start(h);h.advance(14*M);await h.click({action:'complete-job',job:'J001'});
 assert.equal(h.run('screen'),'tasks');assert.ok(!h.html().includes('data-task="J001"'));assert.equal(h.run('state.jobs[0].completed_at'),T+14*M);
 await h.click({demo:'nurse'});assert.ok(h.rooms().includes('Cleaned'));assert.ok(h.rooms().includes('Cleaned 05/30/26, 06:14'));assert.ok(!h.rooms().includes('Ready'));
});
test('an Admin-assigned task still presents just Start cleaning now to the worker',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminTask:'J001'});await h.click({action:'choose-employee',job:'J001'});await h.click({assignWorker:'maya'});
 assert.equal(h.run('state.jobs[0].status'),'assigned');await worker(h);assert.equal([...actionArea(h).matchAll(/<button/g)].length,1);
 assert.ok(actionArea(h).includes('Start cleaning now'));await start(h);assert.equal(h.run('state.jobs[0].status'),'cleaning');
});
test('Now defaults on; Later has only one availability date/time input',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});
 assert.equal(h.nodes.get('availability-option').value,'now');assert.equal(h.nodes.get('availability-fields').hidden,true);assert.equal(h.nodes.get('availability-fields').disabled,true);
 assert.equal([...h.html().matchAll(/type="datetime-local"/g)].length,1);assert.ok(!h.html().includes('available-until'));assert.ok(!h.html().includes('Until'));
 assert.equal(h.nodes.get('available-from').value,'2026-05-30T06:30');
});
test('Later does not scroll when the choices and date input already fit',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});
 h.nodes.get('availability-option').rect={top:102,bottom:157};h.nodes.get('availability-fields').rect={top:167,bottom:598};
 await h.change('availability-option','custom');h.flushFrames();assert.equal(h.nodes.get('availability-fields').hidden,false);assert.equal(h.content.scrolled,undefined);
});
test('Later scrolls the minimum required while keeping Now/Later in view',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});h.content.scrollTop=100;
 h.nodes.get('availability-option').rect={top:250,bottom:300};h.nodes.get('availability-fields').rect={top:310,bottom:640};
 await h.change('availability-option','custom');h.flushFrames();assert.equal(h.content.scrolled.top,148);assert.equal(h.content.scrolled.behavior,'smooth');
 assert.ok(250-(h.content.scrolled.top-100)>=h.content.rect.top+8);
});
test('in a short viewport, Later keeps its choices visible even if the entire block cannot fit',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});h.content.scrollTop=100;h.content.rect={top:100,bottom:280,height:180};
 h.nodes.get('availability-option').rect={top:130,bottom:180};h.nodes.get('availability-fields').rect={top:195,bottom:350};
 await h.change('availability-option','custom');h.flushFrames();assert.equal(h.content.scrolled.top,122);assert.equal(130-(h.content.scrolled.top-100),108);
});
test('Later respects reduced motion, and switching to Now does not add a scroll',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});h.ctx.matchMedia=()=>({matches:true});
 h.nodes.get('availability-option').rect={top:250,bottom:300};h.nodes.get('availability-fields').rect={top:310,bottom:640};
 await h.change('availability-option','custom');h.flushFrames();assert.equal(h.content.scrolled.behavior,'auto');const prior=h.content.scrolled;
 await h.change('availability-option','now');h.flushFrames();assert.equal(h.content.scrolled,prior);assert.equal(h.nodes.get('availability-fields').hidden,true);
});
test('future requests cannot start early; the live clock enables starting without clearing acknowledgement',async()=>{
 const h=harness(T,{blank:true});await h.click({demo:'nurse'});await h.click({room:'4127'});
 await h.submit(requestFields({room_id:'4127',availability_mode:'later',available_from:'2026-05-30T06:30'}));assert.equal(h.run('state.jobs[0].available_from'),T+30*M);
 await h.click({demo:'evs'});assert.ok(h.html().includes('From 06:30, 05/30'));await h.click({task:'J001'});await h.change('ppe-confirmed',true);
 assert.equal(h.nodes.get('start-job').disabled,true);assert.match(h.nodes.get('start-restriction').textContent,/not available/);assert.equal([...actionArea(h).matchAll(/<button/g)].length,1);
 const checkbox=h.nodes.get('ppe-confirmed');h.advance(30*M);h.tick();assert.equal(h.nodes.get('start-job').disabled,false);assert.equal(checkbox.checked,true);assert.equal(h.nodes.get('ppe-confirmed'),checkbox);
 await h.click({action:'start',job:'J001'});assert.equal(h.run('state.jobs[0].started_at'),T+30*M);
});
test('availability has no expiry and can be edited back to Now',async()=>{
 const h=harness(T,{blank:true});h.seed([{room_id:'4100',availability_mode:'later',available_from:T+30*M}]);await worker(h);await h.change('ppe-confirmed',true);
 h.advance(24*60*M);h.tick();assert.equal(h.nodes.get('start-job').disabled,false);
 await h.click({demo:'nurse'});await h.click({room:'4100'});await h.click({action:'edit-request',job:'J001'});assert.equal(h.nodes.get('available-from').value,'2026-05-30T06:30');
 await h.submit(requestFields({availability_mode:'now'}));assert.equal(h.run('state.jobs.length'),1);assert.equal(h.run('state.jobs[0].availability_mode'),'now');
});
test('request edits retain one note and current requirements without a floor-default control',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'2150'});await h.click({action:'edit-request',job:'J001'});
 assert.equal(h.nodes.get('request-room').disabled,true);assert.ok(!h.nodes.has('use-floor-defaults'));assert.ok(!h.nodes.has('equipment'));
 await h.submit(requestFields({cleaning_class:'extra',notes:'Clean the bed rails.'}));assert.equal(h.run('state.jobs.length'),1);assert.equal(h.run('state.jobs[0].duration'),30);
 await worker(h);assert.ok(h.html().includes('Do not discard.'));assert.ok(h.html().includes('Clean the bed rails.'));
});
test('clearing the Nurse note cannot remove the floor instruction shown to EVS',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'2150'});await h.click({action:'edit-request',job:'J001'});
 await h.submit(requestFields({notes:''}));assert.ok(!h.html().includes('stethoscope'));await worker(h);assert.ok(h.html().includes('Retain and clean the reusable stethoscope. Do not discard.'));
});
test('Admin floor settings show Pediatrics instructions and save changes for the existing task',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminScreen:'settings'});
 assert.ok(h.html().includes('<h2>Default floor instructions</h2>'));assert.equal(h.nodes.get('defaults-unit').value,'Pediatrics');assert.match(h.nodes.get('floor-instructions').value,/stethoscope/);assert.ok(!h.html().includes('Always displayed prominently to EVS workers in this unit.'));
 await h.submit({unit:'Pediatrics',instructions:'Retain reusable equipment.'},'floor-instructions-form');await worker(h);assert.ok(h.html().includes('Retain reusable equipment.'));assert.ok(!h.html().includes('stethoscope'));
});
test('Admin can configure instructions per unit, retaining nurse notes',async()=>{
 const h=harness();h.seed([{room_id:'4100',notes:'Clean bed rails.'}]);await h.click({demo:'admin'});await h.click({adminScreen:'settings'});
 const unit=h.nodes.get('defaults-unit');unit.value='Cardiology';await h.listeners.change({target:unit});assert.equal(h.nodes.get('floor-instructions').value,'');
 await h.submit({unit:'Cardiology',instructions:'Keep the monitor.'},'floor-instructions-form');await worker(h);
 assert.ok(h.html().includes('Keep the monitor.'));assert.ok(h.html().includes('Clean bed rails.'));
});
test('clock refresh and assignment toggle preserve unsaved Admin instruction text',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminScreen:'settings'});const text=h.nodes.get('floor-instructions');text.value='Unsent changes';
 h.advance(M);h.tick();await h.change('auto-assign',true);assert.equal(h.nodes.get('floor-instructions'),text);assert.equal(text.value,'Unsent changes');
 assert.match(h.run('state.settings.floor_instructions.Pediatrics'),/stethoscope/);assert.equal(h.run('state.settings.automatic_assignment'),true);
});
test('automatic assignment affects only new requests and requires the same single start action',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminScreen:'settings'});await h.change('auto-assign',true);
 await h.click({demo:'nurse'});await h.click({room:'4100'});await h.submit(requestFields());assert.equal(h.run('state.jobs[0].status'),'queued');assert.equal(h.run('state.jobs[1].status'),'assigned');
 await worker(h,'J002');assert.equal([...actionArea(h).matchAll(/<button/g)].length,1);await start(h,'J002');assert.equal(h.run('state.jobs[1].status'),'cleaning');
});
test('Nurse room and request lists keep the status order and support filtering',async()=>{
 const h=harness(T,{blank:true});h.seed([{room_id:'4120'}]);await worker(h);await start(h);await h.click({action:'complete-job',job:'J001'});
 h.run('simulation=Domain.transact(simulation,"request",{room_id:"2160"});simulation=Domain.transact(simulation,"start",{job_id:"J002",ppe_confirmed:true});simulation=Domain.transact(simulation,"request",{room_id:"4100"});state=Domain.snapshot(simulation);');
 await h.click({demo:'nurse'});assert.deepEqual([...h.rooms().matchAll(/data-room="(\d+)"/g)].slice(0,3).map(m=>m[1]),['2160','4100','4120']);
 await h.click({filter:'cleaned'});assert.deepEqual([...h.rooms().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]),['4120']);await h.click({screen:'requests'});
 assert.deepEqual([...h.html().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]),['2160','4100']);await h.click({requestTab:'completed'});assert.ok(h.html().includes('Room 4120'));assert.ok(h.html().includes('Cleaned by'));
});
test('worker lists remain urgent-first and exclude another worker’s assignments',async()=>{
 const h=harness();h.seed();h.run('simulation=Domain.transact(simulation,"request",{room_id:"4100"});simulation=Domain.transact(simulation,"assign",{job_id:"J003",worker_id:"sam"});state=Domain.snapshot(simulation);');
 await h.click({demo:'evs'});assert.ok(h.html().indexOf('data-task="J001"')<h.html().indexOf('data-task="J002"'));assert.ok(!h.html().includes('Room 4100'));assert.ok(h.html().includes('Gloves'));assert.ok(h.html().includes('No PPE required'));
});
test('invalid dates display a form error without losing the single unsaved note',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});const note=h.nodes.get('nurse-note');note.value='Unsent note';
 await h.submit(requestFields({availability_mode:'later',available_from:'2026-05-30T05:30'}));assert.equal(h.run('state.jobs.length'),1);assert.match(h.nodes.get('form-error').textContent,/future availability/);
 assert.equal(h.nodes.get('nurse-note'),note);assert.equal(note.value,'Unsent note');h.advance(M);h.tick();assert.equal(note.value,'Unsent note');
});
test('instructions stay escaped in Admin settings, worker details, and Nurse editing',async()=>{
 const h=harness();h.run('simulation.settings.floor_instructions.Pediatrics="<img src=x onerror=alert(1)>";simulation.jobs[0].notes="</textarea><script>bad()</script>";state=Domain.snapshot(simulation);');
 await worker(h);assert.ok(h.html().includes('&lt;img'));assert.ok(!h.html().includes('<img src=x'));assert.ok(!h.html().includes('<script>bad'));
 await h.click({demo:'nurse'});await h.click({room:'2150'});await h.click({action:'edit-request',job:'J001'});assert.ok(h.html().includes('&lt;/textarea&gt;'));
 await h.click({demo:'admin'});await h.click({adminScreen:'settings'});assert.ok(h.html().includes('&lt;img'));
});
test('menu role switches preserve started tasks and saved settings',async()=>{
 const h=harness();await worker(h);await start(h);await h.click({action:'main-menu'});assert.equal(h.run('role'),'menu');
 await h.click({demo:'nurse'});await h.click({room:'2150'});assert.ok(h.html().includes('EVS worker 1'));assert.equal(h.run('state.jobs[0].status'),'cleaning');
});
test('time display handles local midnight and year rollover',()=>{
 const h=harness(Date.parse('2027-01-01T04:59:00Z'));assert.equal(h.nodes.get('phone-time').textContent,'23:59');assert.equal(h.run('cleanedOn(Date.now())'),'Cleaned 12/31/26, 23:59');
 h.advance(2*M);h.tick();assert.equal(h.nodes.get('phone-time').textContent,'00:01');assert.equal(h.run('cleanedOn(Date.now())'),'Cleaned 01/01/27, 00:01');
});
test('new page resets claims and floor settings to the single seeded request at its current time',async()=>{
 const a=harness();await worker(a);await start(a);const b=harness(T+60*M);assert.equal(b.run('role'),'menu');assert.equal(b.run('state.jobs.length'),1);
 assert.equal(b.run('state.jobs[0].status'),'queued');assert.equal(b.run('state.jobs[0].requested_at'),T+60*M);assert.equal(b.run('state.settings.automatic_assignment'),false);
});
test('persistent demo footer and relative assets retain GitHub Pages support',()=>{
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');assert.ok(html.indexOf('data-action="main-menu"')>html.indexOf('id="phone-app"'));
 assert.ok(html.indexOf('data-action="main-menu"')<html.indexOf('class="phone-safe-area"'));
 for(const asset of [...html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)].map(m=>m[1])){assert.ok(fs.existsSync(path.join(ROOT,asset)));assert.ok(new URL(asset,'https://example.github.io/evsync/').pathname.startsWith('/evsync/'));}
});
test('phone viewport sizing follows the keyboard without interfering with zoom',()=>{
 const h=harness();h.ctx.window={visualViewport:{height:740,scale:1},innerHeight:800};h.run('fitViewport()');assert.equal(h.document.styles['--app-height'],'740px');
 h.ctx.window.visualViewport.height=420;h.run('fitViewport()');assert.equal(h.document.styles['--app-height'],'420px');h.ctx.window.visualViewport.scale=2;h.ctx.window.visualViewport.height=200;h.run('fitViewport()');assert.equal(h.document.styles['--app-height'],'420px');
});

const modalHtml=h=>h.nodes.get('modal-root').innerHTML;
async function input(h,id,value){const el=h.nodes.get(id);assert.ok(el,`${id} exists`);el.value=value;await h.listeners.input({target:el});}
async function adminSettings(h){await h.click({demo:'admin'});await h.click({adminScreen:'settings'});}
async function sampleSummary(h){await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});await h.click({action:'sample-feedback'});await h.click({action:'summarize-feedback'});}

test('Nurse report entry opens both open orders and recent completed work',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({action:'complete-job',job:'J001'});await h.click({demo:'nurse'});
 assert.ok(h.html().includes('data-action="begin-report"'));await h.click({action:'begin-report'});
 assert.equal(h.run('screen'),'report-menu');assert.ok(h.html().includes('data-action="report-general"'));assert.ok(h.html().includes('data-action="report-specific"'));assert.ok(!h.html().includes('Open work orders'));await h.click({action:'report-specific'});assert.equal(h.run('screen'),'report-picker');assert.ok(h.html().includes('Open work orders'));assert.ok(h.html().includes('Recently cleaned'));
 assert.ok(h.html().includes('data-report-task="J001"'));assert.ok(h.html().includes('data-report-task="J002"'));assert.ok(!h.html().includes('data-action="report-general"'));
});
test('reporting a general process issue requires no room or work order',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'begin-report'});await h.click({action:'report-general'});
 assert.ok(h.html().includes('No room or work order required'));assert.ok(h.html().includes('data-dictate="report-description"'));
 await h.submit({unit:'',category:'other',description:'The EVS workers keep fooing when they should bar.'},'report-form');
 assert.equal(h.run('screen'),'rooms');assert.equal(h.run('state.reports.length'),1);assert.equal(h.run('state.reports[0].room_id'),null);assert.equal(h.run('state.reports[0].job_id'),null);assert.equal(h.run('state.reports[0].unit'),null);assert.equal(h.run('state.jobs.length'),1);
});
test('a general issue may target a unit without a particular room',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'begin-report'});await h.click({action:'report-general'});
 await h.submit({unit:'Pediatrics',category:'equipment',description:'Keep reusable stethoscopes.'},'report-form');
 assert.equal(h.run('state.reports[0].unit'),'Pediatrics');assert.equal(h.run('state.reports[0].room_id'),null);
});
test('open work-order reports retain linkage and do not change cleaning status',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'begin-report'});await h.click({action:'report-specific'});await h.click({reportTask:'J001'});
 await h.submit({category:'equipment',description:'The stethoscope is missing.'},'report-form');
 assert.equal(h.run('state.reports[0].job_id'),'J001');assert.equal(h.run('state.reports[0].room_id'),'2150');assert.equal(h.run('state.jobs[0].status'),'queued');
});
test('worker reports are prefilled from a task and use EVS as reporter',async()=>{
 const h=harness();await worker(h);await h.click({action:'begin-report',job:'J001'});assert.equal(h.run('screen'),'report-form');assert.ok(h.html().includes('Room 2150'));
 await h.submit({category:'supplies',description:'Supplies are missing.'},'report-form');assert.equal(h.run('screen'),'task');assert.equal(h.run('state.reports[0].reporter_role'),'evs');assert.equal(h.run('state.reports[0].reporter_name'),'EVS worker 1');
});
test('room search can report a room without work and changing source retains dictated text',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'begin-report',job:'J001'});await input(h,'report-description','Keep this draft.');await h.click({action:'report-back'});
 await input(h,'report-room-search','4100');assert.ok(h.nodes.get('report-options').innerHTML.includes('data-report-room="4100"'));await h.click({reportRoom:'4100'});
 assert.equal(h.nodes.get('report-description').value,'Keep this draft.');await h.submit({category:'other',description:'Keep this draft.'},'report-form');
 assert.equal(h.run('state.reports[0].room_id'),'4100');assert.equal(h.run('state.reports[0].job_id'),null);assert.equal(h.run('state.jobs.length'),1);
});
test('My requests shows completed history without a completion counter or prompt',async()=>{
 const h=harness();await worker(h);await start(h);h.advance(10*M);await h.click({action:'complete-job',job:'J001'});await h.click({demo:'nurse'});
 assert.ok(!h.html().includes('newly completed'));assert.ok(!h.html().includes('nav-count'));assert.ok(!/was cleaned|requests were completed/.test(h.nodes.get('toast').textContent));
 await h.click({screen:'requests'});assert.ok(h.html().includes('Active 0'));assert.match(h.html(),/>Completed<\/button>/);assert.ok(!/Completed \d/.test(h.html()));await h.click({requestTab:'completed'});
 assert.equal(h.run('Domain.unreadCompletions(state).length'),0);assert.ok(h.html().includes('Cleaned by EVS worker 1'));assert.ok(h.html().includes('Cleaned 05/30/26, 06:10'));
 await h.click({action:'begin-report',job:'J001'});await h.submit({category:'cleaning',description:'An area was missed.'},'report-form');
 assert.equal(h.run('screen'),'requests');assert.equal(h.run('requestsTab'),'completed');assert.equal(h.run('state.reports[0].job_id'),'J001');
});
test('active My requests expose Edit, support urgency changes, and log the change',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({screen:'requests'});assert.ok(h.html().includes('data-action="edit-request"'));
 await h.click({action:'edit-request',job:'J001'});await h.submit(requestFields({priority:'urgent',notes:'Additional instruction.'}));
 assert.equal(h.run('state.jobs[0].priority'),'urgent');assert.equal(h.run('state.events.find(e=>e.kind==="edit").changes.priority.before'),'routine');assert.ok(h.html().includes('Urgent'));
});
test('availability shortcuts are anchored to submission, while editing preserves the absolute time',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});
 for(const label of['In 15 minutes','In 30 minutes','In 45 minutes','In 60 minutes','Choose date/time…'])assert.ok(h.html().includes(label));
 await h.change('availability-option','15');assert.equal(h.nodes.get('availability-fields').hidden,true);h.advance(5*M);
 await h.submit(requestFields({availability_option:'15'}));assert.equal(h.run('state.jobs[1].available_from'),T+20*M);
 await h.click({action:'edit-request',job:'J002'});assert.equal(h.nodes.get('availability-option').value,'custom');assert.equal(h.nodes.get('available-from').value,'2026-05-30T06:20');
 h.advance(2*M);await h.submit(requestFields({availability_option:'custom',available_from:'2026-05-30T06:20'}));assert.equal(h.run('state.jobs[1].available_from'),T+20*M);
});
test('current cleaning stays pinned above urgent waiting work and availability groups are clear',async()=>{
 const h=harness();h.seed([{room_id:'2150'},{room_id:'4100',priority:'urgent',availability_mode:'later',available_from:T+30*M},{room_id:'4127'}]);
 await worker(h);await start(h);await h.click({backTasks:''});const html=h.html();assert.ok(html.includes('Cleaning now'));assert.ok(html.includes('Urgent · available later'));assert.ok(html.includes('Available now'));
 assert.ok(html.indexOf('data-task="J001"')<html.indexOf('data-task="J002"'));assert.ok(html.indexOf('data-task="J002"')<html.indexOf('data-task="J003"'));
});
test('estimate changes work before starting and while cleaning, with optional dictated reasons',async()=>{
 const h=harness();await worker(h);await h.click({action:'estimate-dialog',job:'J001'});
 assert.ok(modalHtml(h).includes('How long will cleaning take?'));assert.ok(modalHtml(h).includes('data-dictate="estimate-reason"'));
 await h.submit({minutes:'40',reason:'Extra work expected.'},'estimate-form');assert.equal(h.run('state.jobs[0].expected_minutes'),40);assert.equal(h.run('state.jobs[0].status'),'queued');
 await start(h);h.advance(5*M);await h.click({action:'estimate-dialog',job:'J001'});assert.ok(modalHtml(h).includes('How many minutes remain?'));
 await h.submit({minutes:'10',reason:'Nearly finished.'},'estimate-form');assert.equal(h.run('state.jobs[0].forecast_finish'),T+15*M);assert.equal(h.run('state.jobs[0].initial_estimated_finish'),T+40*M);
 await h.click({demo:'nurse'});await h.click({room:'2150'});assert.ok(h.html().includes('06:15, 05/30'));
});
test('dictation buttons focus every writing field and explain keyboard dictation without recording',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});await h.click({dictate:'nurse-note'});
 assert.equal(h.document.activeElement,h.nodes.get('nurse-note'));assert.match(h.nodes.get('toast').textContent,/keyboard/);
 await adminSettings(h);assert.ok(h.html().includes('data-dictate="floor-instructions"'));await h.click({dictate:'floor-instructions'});assert.equal(h.document.activeElement,h.nodes.get('floor-instructions'));
});
test('starting the next task opens an explicit prior-completion check, not a silent completion',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({backTasks:''});await h.click({task:'J002'});await h.change('ppe-confirmed',true);
 assert.equal(h.nodes.get('start-job').disabled,false);await h.click({action:'start',job:'J002'});
 assert.ok(modalHtml(h).includes('Is Room 4127 finished?'));assert.equal(h.run('state.jobs[0].status'),'cleaning');assert.equal(h.run('state.jobs[1].status'),'queued');
 await h.click({action:'handoff-still'});assert.equal(h.run('selectedTask'),'J001');assert.equal(modalHtml(h),'');assert.equal(h.run('state.jobs[1].status'),'queued');
});
test('forgotten completion can be backdated with its entry time preserved before starting next',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);h.advance(20*M);await h.click({backTasks:''});await h.click({task:'J002'});await h.change('ppe-confirmed',true);await h.click({action:'start',job:'J002'});
 await h.click({action:'handoff-finished'});await h.change('finish-earlier',true);assert.equal(h.nodes.get('handoff-time').hidden,false);
 await h.submit({finish_mode:'earlier',completed_at:'2026-05-30T06:10'},'handoff-form');
 assert.equal(h.run('state.jobs[0].completed_at'),T+10*M);assert.equal(h.run('state.jobs[0].completion_recorded_at'),T+20*M);assert.equal(h.run('state.jobs[1].started_at'),T+20*M);assert.equal(h.run('selectedTask'),'J002');assert.equal(modalHtml(h),'');
});
test('could not finish reports the reason, releases the previous request, and starts next',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({backTasks:''});await h.click({task:'J002'});await h.change('ppe-confirmed',true);await h.click({action:'start',job:'J002'});await h.click({action:'handoff-unfinished'});
 assert.ok(modalHtml(h).includes('data-dictate="handoff-reason"'));await h.submit({reason:'Supplies were missing.'},'handoff-form');
 assert.equal(h.run('state.jobs[0].status'),'queued');assert.equal(h.run('state.jobs[0].completed_at'),null);assert.equal(h.run('state.jobs[1].status'),'cleaning');assert.equal(h.run('state.reports[0].job_id'),'J001');assert.equal(h.run('state.reports[0].reporter_role'),'evs');
});
test('closing the previous-completion dialog leaves both tasks unchanged',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);await h.click({backTasks:''});await h.click({task:'J002'});await h.change('ppe-confirmed',true);await h.click({action:'start',job:'J002'});await h.click({action:'close-modal'});
 assert.equal(h.run('state.jobs[0].status'),'cleaning');assert.equal(h.run('state.jobs[1].status'),'queued');assert.equal(h.run('pendingStart'),null);
});
test('Admin Feedback shows reports, filters, review status, and explicitly labelled sample data',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});assert.ok(h.html().includes('No matching reports.'));await h.click({action:'sample-feedback'});
 assert.equal(h.run('state.jobs.length'),1);assert.equal(h.run('state.reports.length'),5);assert.ok(h.html().includes('Example'));await h.click({viewReport:'R001'});assert.ok(h.html().includes('Example report for demonstration'));
 await h.change('report-status','resolved');assert.equal(h.run('state.reports.find(r=>r.id==="R001").status'),'resolved');await h.click({screen:'feedback'});await h.click({feedbackFilter:'resolved'});
 assert.ok(h.html().includes('data-view-report="R001"'));assert.ok(!h.html().includes('data-view-report="R002"'));
});
test('Feedback summary describes the displayed reports with a concise simulation label',async()=>{
 const h=harness();const original=h.run('state.settings.floor_instructions.Pediatrics');await sampleSummary(h);
 assert.equal(h.run('screen'),'feedback-summary');assert.ok(h.html().includes('(Simulated; no AI model currently connected)'));assert.ok(h.html().includes('4 displayed reports'));
 for(const text of['2 Pediatrics reports describe reusable stethoscopes being discarded','missed cleaning under a bed','needed supplies being unavailable'])assert.ok(h.html().includes(text),text);
 assert.ok(!/This summary uses only|Update floor instructions|Review instruction update|draft-unit|Append update|Replace all/.test(h.html()));assert.equal(h.run('state.settings.floor_instructions.Pediatrics'),original);assert.equal(h.run('state.recommendations.length'),0);
 await h.click({screen:'feedback'});await h.change('feedback-timeframe','all');await h.click({action:'summarize-feedback'});assert.ok(h.html().includes('5 displayed reports'));assert.ok(h.html().includes('unavailable at its scheduled cleaning time'));
});
test('summary source reports return to the summary without modifying instructions',async()=>{
 const h=harness();await sampleSummary(h);const paragraphs=h.run('JSON.stringify(currentFeedbackSummary().paragraphs)');await h.click({viewReport:'R001'});assert.equal(h.run('screen'),'feedback-report');assert.match(h.html(),/data-screen="feedback-summary"/);await h.click({screen:'feedback-summary'});assert.equal(h.run('JSON.stringify(currentFeedbackSummary().paragraphs)'),paragraphs);
});
test('an unknown general issue is summarized using the actual reported content',async()=>{
 const h=harness();h.run('simulation=Domain.transact(simulation,"report",{reporter_role:"nurse",description:"Workers keep fooing when they should bar."});state=Domain.snapshot(simulation);');await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});await h.click({action:'summarize-feedback'});
 assert.ok(h.html().includes('1 displayed report'));assert.ok(h.html().includes('Workers keep fooing when they should bar.'));assert.ok(h.html().includes('data-view-report="R001"'));assert.equal(h.run('state.recommendations.length'),0);
});
test('Settings contains no AI or reminder toggle and retains unsaved floor edits on clock refresh',async()=>{
 const h=harness();await adminSettings(h);const field=h.nodes.get('floor-instructions');field.value='Unsent edits';h.advance(M);h.tick();
 assert.equal(h.run('screen'),'settings');assert.equal(h.run('state.recommendations.length'),0);assert.equal(h.nodes.get('floor-instructions'),field);assert.equal(field.value,'Unsent edits');assert.ok(!/AI Recommendation|ai-recommendation|highlight/i.test(h.html()));
 assert.ok(h.html().includes('When enabled, new tasks are assigned to the most available worker automatically.'));
});
test('issue descriptions and generated summary text remain escaped in every review view',async()=>{
 const h=harness();h.run('simulation=Domain.transact(simulation,"report",{reporter_role:"nurse",description:"<img src=x onerror=alert(1)>"});state=Domain.snapshot(simulation);');await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});assert.ok(h.html().includes('&lt;img'));assert.ok(!h.html().includes('<img src=x'));
 await h.click({viewReport:'R001'});assert.ok(h.html().includes('&lt;img'));await h.click({adminScreen:'feedback'});await h.click({action:'summarize-feedback'});assert.ok(h.html().includes('&lt;img'));assert.ok(!h.html().includes('<img src=x'));
});

test('editing a relative availability time preserves seconds even after the room became available',async()=>{
 const h=harness(T+30123);await h.click({demo:'nurse'});await h.click({room:'4100'});await h.submit(requestFields({availability_option:'15'}));
 assert.equal(h.run('state.jobs[1].available_from'),T+15*M+30123);h.advance(60*M);await h.click({action:'edit-request',job:'J002'});
 const displayed=h.nodes.get('available-from').value;await h.submit(requestFields({availability_option:'custom',available_from:displayed,priority:'urgent',notes:'Changed after availability.'}));
 assert.equal(h.run('screen'),'detail');assert.equal(h.run('state.jobs[1].available_from'),T+15*M+30123);assert.equal(h.run('state.jobs[1].priority'),'urgent');
});
test('returning to an already-selected Completed tab acknowledges newly visible completions',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({screen:'requests'});await h.click({requestTab:'completed'});await worker(h);await start(h);await h.click({action:'complete-job',job:'J001'});
 await h.click({demo:'nurse'});assert.equal(h.run('Domain.unreadCompletions(state).length'),1);await h.click({screen:'requests'});assert.equal(h.run('requestsTab'),'completed');assert.equal(h.run('Domain.unreadCompletions(state).length'),0);
});

test('completed work reviewed from a report shows the historical starting instructions',async()=>{
 const h=harness();await worker(h);await start(h);await h.click({action:'complete-job',job:'J001'});await adminSettings(h);await h.submit({unit:'Pediatrics',instructions:'Updated instructions.'},'floor-instructions-form');
 await h.click({adminTask:'J001'});assert.ok(h.html().includes('Instructions at cleaning start'));assert.ok(h.html().includes('Retain and clean the reusable stethoscope.'));assert.ok(!h.html().includes('Updated instructions.'));
});

test('cleaned room cards have a dated muted-red report button linked to the latest completed job',async()=>{
 const h=harness();await worker(h);await start(h);h.advance(14*M);await h.click({action:'complete-job',job:'J001'});
 h.run('simulation=Domain.transact(simulation,"request",{room_id:"2150"});simulation=Domain.transact(simulation,"start",{job_id:"J002",ppe_confirmed:true});state=Domain.snapshot(simulation);');h.advance(M);h.run('simulation=Domain.transact(simulation,"complete",{job_id:"J002",checks_confirmed:true});state=Domain.snapshot(simulation);');
 await h.click({demo:'nurse'});const html=h.rooms();assert.match(html,/<article class="room-card cleaned-room-card">/);assert.match(html,/Cleaned 05\/30\/26, 06:15/);assert.match(html,/class="report-issue-muted" data-action="begin-report" data-job="J002"/);assert.ok(html.indexOf('Cleaned 05/30/26, 06:15')<html.indexOf('Report an issue'));
 await h.click({action:'begin-report',job:'J002'});assert.equal(h.run('reportContext.job_id'),'J002');assert.ok(h.html().includes('Cleaned 05/30/26, 06:15'));assert.ok(h.html().includes('Cleaned by EVS worker 1'));assert.ok(!/Change room|general issue<\/button>|class="badge cleaned"/.test(h.html()));
 const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');assert.match(css,/\.report-issue-muted \{[^}]*min-height:44px[^}]*background:#fff5f3[^}]*color:#985852/);
});
test('report form uses one dictated problem field and Back retains its draft for another source',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({action:'begin-report'});assert.ok(h.html().includes('Report an issue with a specific job'));await h.click({action:'report-specific'});assert.ok(h.html().includes('Report an issue with a specific job'));assert.ok(!h.html().includes('Find a room or work order'));
 await h.click({reportTask:'J001'});assert.ok(h.html().includes('What is the problem?'));assert.equal([...h.html().matchAll(/<textarea/g)].length,1);assert.ok(!/<select|What is the issue about|report-category/.test(h.html()));await h.click({dictate:'report-description'});assert.equal(h.document.activeElement,h.nodes.get('report-description'));
 await input(h,'report-description','Keep this dictated problem.');await h.click({action:'report-back'});assert.equal(h.run('screen'),'report-picker');await h.click({action:'report-back'});assert.equal(h.run('screen'),'report-menu');await h.click({action:'report-general'});assert.equal(h.nodes.get('report-description').value,'Keep this dictated problem.');
});
test('estimate picker scrolls through six ten-minute options including 60+ before and during cleaning',async()=>{
 const h=harness();await worker(h);await h.click({action:'estimate-dialog',job:'J001'});assert.match(modalHtml(h),/<select id="estimate-minutes"[^>]*size="4"/);assert.deepEqual([...modalHtml(h).matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['10','20','30','40','50','60+']);assert.ok(!modalHtml(h).includes('type="number"'));
 await h.submit({minutes:'60+',reason:'Additional work.'},'estimate-form');assert.equal(h.run('state.jobs[0].expected_at_least'),true);assert.ok(h.html().includes('60+ min'));await start(h);h.advance(70*M);h.tick();assert.ok(!h.estimates().some(e=>e.textContent.includes('overdue')));assert.equal(h.run('state.jobs[0].overdue'),false);
 await h.click({action:'estimate-dialog',job:'J001'});assert.equal(h.nodes.get('estimate-minutes').value,'60+');await h.submit({minutes:'10',reason:''},'estimate-form');assert.equal(h.run('state.jobs[0].forecast_at_least'),false);
});
test('Admin assigns to a chosen employee and the selected worker gets an in-app notification',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminTask:'J001'});assert.ok(h.html().includes('Assign to an employee'));await h.click({action:'choose-employee',job:'J001'});
 assert.equal(h.run('screen'),'assign-worker');assert.ok(h.html().includes('Available workers'));assert.ok(h.html().includes('All workers'));assert.equal([...h.html().matchAll(/data-assign-worker=/g)].length,4);
 await h.click({assignWorker:'jordan'});assert.equal(h.run('state.jobs[0].worker_id'),'jordan');assert.equal(h.run('screen'),'tasks');assert.ok(h.html().includes('data-admin-task="J001"'));await h.click({demo:'evs'});assert.ok(!h.html().includes('You have been assigned Room 2150.'));await h.change('demo-worker','jordan');assert.match(h.html(),/New assignment/);assert.ok(h.html().includes('You have been assigned Room 2150.'));assert.ok(h.html().includes('data-task="J001"'));assert.equal(h.nodes.get('toast').textContent,'You have been assigned Room 2150.');
 await h.click({action:'dismiss-assignments'});assert.ok(!h.html().includes('New assignment'));await h.click({task:'J001'});await start(h);assert.equal(h.run('state.jobs[0].worker_id'),'jordan');assert.ok(!/Maya|Sam|Jordan|Avery/.test(h.html()));
});
test('Available employee filter omits active cleaners while All allows queued assignment to them',async()=>{
 const h=harness();await worker(h);await start(h);h.run('simulation=Domain.transact(simulation,"request",{room_id:"4100"});state=Domain.snapshot(simulation);');await h.click({demo:'admin'});await h.click({adminTask:'J002'});await h.click({action:'choose-employee',job:'J002'});
 assert.ok(!h.html().includes('data-assign-worker="maya"'));await h.click({assignmentFilter:'all'});assert.ok(h.html().includes('data-assign-worker="maya"'));assert.ok(h.html().includes('Cleaning Room 2150'));await h.click({assignWorker:'maya'});assert.equal(h.run('state.jobs[1].status'),'assigned');
 await h.click({adminTask:'J001'});assert.ok(!h.html().includes('Assign to an employee'));
});
test('reassignment moves the notification to the new worker and opening the job acknowledges it',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminTask:'J001'});await h.click({action:'choose-employee',job:'J001'});await h.click({assignWorker:'sam'});assert.equal(h.run('screen'),'tasks');assert.equal(h.run('selectedTask'),null);await h.click({adminTask:'J001'});assert.ok(h.html().includes('Change assignment'));assert.ok(!h.html().includes('>Assign to an employee</button>'));await h.click({action:'choose-employee',job:'J001'});await h.click({assignWorker:'avery'});
 await h.click({demo:'evs'});await h.change('demo-worker','sam');assert.ok(!h.html().includes('New assignment'));assert.ok(!h.html().includes('data-task="J001"'));await h.change('demo-worker','avery');assert.ok(h.html().includes('New assignment'));await h.click({task:'J001'});await h.click({backTasks:''});assert.ok(!h.html().includes('New assignment'));
});
test('Feedback summary honors the exact displayed timeframe, unit and status filters',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});await h.click({action:'sample-feedback'});await h.click({viewReport:'R001'});await h.change('report-status','resolved');await h.click({screen:'feedback'});await h.click({feedbackFilter:'resolved'});await h.change('feedback-unit','Pediatrics');await h.change('feedback-timeframe','week');
 const displayed=h.run('JSON.stringify(displayedReports().map(r=>r.id))');assert.equal(displayed,'["R001"]');await h.click({action:'summarize-feedback'});assert.equal(h.run('JSON.stringify(currentFeedbackSummary().report_ids)'),displayed);assert.ok(h.html().includes('This week · Pediatrics · Resolved'));assert.ok(h.html().includes('reusable stethoscopes being discarded'));assert.ok(!h.html().includes('needed supplies being unavailable'));
});
test('Feedback Today refreshes at local midnight so summarized reports match the visible list',async()=>{
 const h=harness(Date.parse('2026-05-30T23:59:00-04:00'));h.run('simulation=Domain.transact(simulation,"report",{reporter_role:"nurse",description:"A reported issue."});state=Domain.snapshot(simulation);');await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});await h.change('feedback-timeframe','today');assert.ok(h.html().includes('1 report shown'));h.advance(2*M);h.tick();assert.ok(h.html().includes('0 reports shown'));assert.match(h.html(),/data-action="summarize-feedback" disabled/);
});
test('summary content follows the selected unit without leaking unrelated reports',async()=>{
 const h=harness();h.run('simulation=Domain.transact(simulation,"report",{reporter_role:"nurse",unit:"Pediatrics",description:"Keep reusable stethoscopes."});simulation=Domain.transact(simulation,"report",{reporter_role:"nurse",unit:"Oncology",description:"Supplies missing."});state=Domain.snapshot(simulation);');await h.click({demo:'admin'});await h.click({adminScreen:'feedback'});await h.change('feedback-unit','Oncology');await h.click({action:'summarize-feedback'});assert.equal(h.run('JSON.stringify(currentFeedbackSummary().report_ids)'),'["R002"]');assert.ok(h.html().includes('Supplies missing.'));assert.ok(!h.html().includes('Keep reusable stethoscopes.'));assert.ok(!h.html().includes('data-view-report="R001"'));
});

test('Nurse Report branches and Back preserve the draft and return to the originating list',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({screen:'requests'});await h.click({action:'begin-report'});
 assert.equal(h.run('screen'),'report-menu');assert.match(h.html(),/data-action="report-general"/);assert.match(h.html(),/data-action="report-specific"/);assert.ok(!h.html().includes('report-room-search'));
 await h.click({action:'report-general'});assert.equal(h.run('screen'),'report-form');assert.ok(h.html().includes('General issue'));assert.ok(!h.html().includes('Room 2150'));await input(h,'report-description','A general concern.');await h.click({action:'report-back'});assert.equal(h.run('screen'),'report-menu');
 await h.click({action:'report-specific'});assert.equal(h.run('screen'),'report-picker');assert.ok(h.html().includes('data-report-task="J001"'));await h.click({reportTask:'J001'});assert.equal(h.run('screen'),'report-form');assert.equal(h.nodes.get('report-description').value,'A general concern.');assert.ok(h.html().includes('Room 2150'));
 await h.click({action:'report-back'});assert.equal(h.run('screen'),'report-picker');await h.click({action:'report-back'});assert.equal(h.run('screen'),'report-menu');await h.click({action:'report-back'});assert.equal(h.run('screen'),'requests');assert.equal(h.run('state.reports.length'),0);
});
test('EVS Report opens the general/specific menu and returns to the originating view',async()=>{
 const h=harness();await h.click({demo:'evs'});await h.click({action:'begin-report'});assert.equal(h.run('screen'),'report-menu');assert.ok(h.html().includes('Report an issue with a specific job'));await h.click({action:'report-general'});await input(h,'report-description','An EVS concern.');await h.click({action:'report-back'});assert.equal(h.run('screen'),'report-menu');await h.click({action:'report-specific'});assert.equal(h.run('screen'),'report-picker');await h.click({action:'report-back'});await h.click({action:'report-back'});assert.equal(h.run('screen'),'tasks');assert.equal(h.run('role'),'evs');
});

test('new requests confirm success above details and both Back controls return to the originating Nurse list',async()=>{
 for(const origin of ['rooms','requests']){
  const h=harness();await h.click({demo:'nurse'});await h.click({screen:origin});await h.click({action:'new-request'});await h.submit(requestFields());assert.equal(h.run('screen'),'detail');assert.match(h.html(),/class="request-confirmation" role="status">[\s\S]*?<span>Job requested!<\/span><\/p>/);assert.ok(h.html().indexOf('Job requested!')<h.html().indexOf('detail-grid'));assert.ok(h.html().includes('Go back to main menu'));
  const backs=[...h.html().matchAll(/class="back-button" data-screen="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(backs,[origin,origin]);assert.ok(h.html().indexOf('Go back to main menu')>h.html().indexOf('>Cancel</button>'));assert.equal(h.run('state.jobs.length'),2);
  await h.click({screen:origin});await h.click({room:'4100'});assert.ok(!h.html().includes('Job requested!'));await h.click({action:'edit-request',job:'J002'});await h.submit(requestFields({notes:'An updated instruction.'}));assert.ok(!h.html().includes('Job requested!'));assert.equal(h.run('state.jobs.length'),2);
 }
});
test('invalid requests do not show a successful request confirmation',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});await h.submit(requestFields({availability_option:'custom',available_from:'invalid'}));assert.equal(h.run('screen'),'form');assert.ok(!h.html().includes('Job requested!'));assert.equal(h.run('requestConfirmation'),null);
});
test('EVS header Report never preselects the current task and supports both reporting routes',async()=>{
 const h=harness();h.seed();await worker(h);await start(h);
 const clickHeader=async()=>{const header=h.html().slice(0,h.html().indexOf('</header>'));const tag=header.match(/<button[^>]*data-action="begin-report"[^>]*>/)?.[0];assert.ok(tag);assert.ok(!/data-job=/.test(tag));await h.click({action:'begin-report'});assert.equal(h.run('screen'),'report-menu');};
 await clickHeader();await h.click({action:'report-general'});assert.equal(h.run('reportContext.job_id'),null);await h.submit({unit:'',description:'An issue across the unit.'},'report-form');assert.equal(h.run('screen'),'task');assert.equal(h.run('selectedTask'),'J001');assert.equal(h.run('state.reports[0].job_id'),null);
 await clickHeader();await h.click({action:'report-specific'});await h.click({reportTask:'J002'});await h.submit({description:'An issue with the other job.'},'report-form');assert.equal(h.run('screen'),'task');assert.equal(h.run('selectedTask'),'J001');assert.equal(h.run('state.reports.find(r=>r.id==="R002").job_id'),'J002');assert.equal(h.run('state.jobs[0].status'),'cleaning');
});

test('Admin exposes Tasks, Feedback and Settings, with the retired Summary routes returning to Tasks',async()=>{
 const h=harness();await h.click({demo:'admin'});assert.deepEqual([...h.html().matchAll(/data-admin-screen="([^"]+)"/g)].map(m=>m[1]),['tasks','feedback','settings']);assert.ok(!h.html().includes('>Summary</button>'));
 for(const retired of['summary','activity']){await h.click({adminScreen:retired});assert.equal(h.run('screen'),'tasks');assert.ok(!/Load sample performance|Performance|View activity log/.test(h.html()));}
 await h.click({adminScreen:'feedback'});await h.click({action:'sample-feedback'});await h.click({action:'summarize-feedback'});assert.equal(h.run('screen'),'feedback-summary');assert.ok(h.html().includes('reusable stethoscopes'));await h.click({adminScreen:'settings'});assert.ok(h.html().includes('Default floor instructions'));
});

test('demo menu starts in Bold with an accessible colour toggle',()=>{
 const h=harness();assert.equal(h.document.documentElement.dataset.colourScheme,'bold');assert.equal(h.document.themeMeta.content,'#e8eef5');assert.ok(h.html().includes('Colour scheme'));assert.match(h.html(),/id="bold-colours"[^>]*role="switch"[^>]*aria-label="Use bold colours"[^>]*checked/);assert.equal(h.nodes.get('bold-colours').checked,true);
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');assert.ok(html.indexOf('href="./bold.css"')>html.indexOf('href="./style.css"'));assert.ok(fs.existsSync(path.join(ROOT,'bold.css')));
});
test('switching colour schemes updates the whole app without resetting requests, assignments or feedback',async()=>{
 const h=harness();await worker(h);await start(h);h.run('simulation=Domain.transact(simulation,"report",{reporter_role:"nurse",job_id:"J001",description:"Keep the reusable stethoscope."});state=Domain.snapshot(simulation);');
 await h.click({action:'main-menu'});const original=h.run('JSON.stringify(simulation)'),control=h.nodes.get('bold-colours');control.focus();await h.change('bold-colours',false);assert.equal(h.document.documentElement.dataset.colourScheme,'original');assert.equal(h.document.themeMeta.content,'#153f3b');assert.equal(h.nodes.get('colour-scheme-name').textContent,'Original (v0.14)');assert.equal(h.document.activeElement,control);assert.equal(h.nodes.get('bold-colours'),control);assert.equal(h.run('JSON.stringify(simulation)'),original);
 for(const role of ['nurse','evs','admin']){await h.click({demo:role});assert.equal(h.document.documentElement.dataset.colourScheme,'original');assert.equal(h.run('state.jobs[0].status'),'cleaning');assert.equal(h.run('state.reports.length'),1);}
 await h.click({action:'main-menu'});assert.equal(h.nodes.get('bold-colours').checked,false);assert.ok(h.html().includes('Original (v0.14)'));await h.change('bold-colours',true);assert.equal(h.document.documentElement.dataset.colourScheme,'bold');assert.equal(h.nodes.get('colour-scheme-name').textContent,'Bold');assert.equal(h.run('JSON.stringify(simulation)'),original);
});
test('the scheme toggle stays on the main menu and a new page starts in Bold again',async()=>{
 const a=harness();await a.change('bold-colours',false);await a.click({demo:'nurse'});assert.ok(!a.html().includes('id="bold-colours"'));await a.click({action:'main-menu'});assert.equal(a.nodes.get('bold-colours').checked,false);const b=harness();assert.equal(b.nodes.get('bold-colours').checked,true);assert.equal(b.document.documentElement.dataset.colourScheme,'bold');
});

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
 async function change(id,checked){const el=nodes.get(id);assert.ok(el,`${id} exists`);el.checked=checked;if(id==='availability-later'&&checked)nodes.get('availability-now').checked=false;if(id==='availability-now'&&checked)nodes.get('availability-later').checked=false;await listeners.change({target:el});}
 async function submit(fields,id='request-form'){await listeners.submit({target:{id,fields},preventDefault(){}});}
 function seed(payloads=[{room_id:'4127',cleaning_class:'extra',priority:'urgent',ppe:['Gloves','Gown','Medical mask'],notes:'Please include the area under the bed.'},
  {room_id:'2150',cleaning_class:'basic',priority:'routine',ppe:[]}]){
  ctx.testPayloads=payloads;run('simulation=Domain.newState(Date.now(),{seedDemo:false});for(const payload of testPayloads)simulation=Domain.transact(simulation,"request",payload);state=Domain.snapshot(simulation);render();');delete ctx.testPayloads;
 }
 return{run,click,change,submit,seed,flushFrames(){while(frames.length)frames.shift()();},nodes,ctx,document,content,intervals,listeners,estimates:()=>estimates,advance(ms){instant+=ms;},tick(){for(const t of intervals)t.fn();},html:()=>nodes.get('phone-app').innerHTML,rooms:()=>nodes.get('room-list').innerHTML};
}
async function worker(h,id='J001'){await h.click({demo:'evs'});await h.click({task:id});}
async function start(h,id='J001'){await h.change('ppe-confirmed',true);await h.click({action:'start',job:id});}

const requestFields=(extra={})=>({room_id:'4100',cleaning_class:'basic',priority:'routine',ppe:[],notes:'',availability_mode:'now',...extra});
const actionArea=h=>h.html().slice(h.html().indexOf('worker-action-area'));

test('initial menu and single demo request retain the 62-room local-only setup',async()=>{
 const h=harness();for(const text of['Nurse Demo','EVS Worker Demo','EVS Admin Demo'])assert.ok(h.html().includes(text));
 assert.equal(h.run('state.jobs.length'),1);assert.equal(h.run('state.jobs[0].room_id'),'2150');assert.equal(h.run('state.settings.automatic_assignment'),false);
 await h.click({demo:'nurse'});assert.equal([...h.rooms().matchAll(/class="room-card"/g)].length,62);assert.ok(!/Unknown|Occupied|Vacant|Ready|As of/.test(h.rooms()));
});
test('Nurse Rooms and Requests have styled icon headings',async()=>{
 const h=harness();await h.click({demo:'nurse'});assert.match(h.html(),/class="screen-title"><span class="title-mark"/);assert.ok(h.html().includes('<span>Rooms</span>'));
 await h.click({screen:'requests'});assert.ok(h.html().includes('<span>Requests</span>'));assert.ok(h.html().includes('class="title-mark"'));
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
 await h.click({demo:'nurse'});assert.ok(h.rooms().includes('As of 06:14, 05/30'));await h.click({room:'2150'});
 assert.equal(h.run('screen'),'form');assert.equal(h.nodes.get('request-room').value,'2150');assert.equal(h.run('state.jobs.length'),1);
 await h.click({screen:'rooms'});assert.ok(h.rooms().includes('As of 06:14, 05/30'));
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
 await h.click({demo:'nurse'});assert.ok(h.rooms().includes('Cleaned'));assert.ok(h.rooms().includes('As of 06:14, 05/30'));assert.ok(!h.rooms().includes('Ready'));
});
test('an Admin-assigned task still presents just Start cleaning now to the worker',async()=>{
 const h=harness();await h.click({demo:'admin'});await h.click({adminTask:'J001'});await h.click({action:'admin-assign',job:'J001'});
 assert.equal(h.run('state.jobs[0].status'),'assigned');await worker(h);assert.equal([...actionArea(h).matchAll(/<button/g)].length,1);
 assert.ok(actionArea(h).includes('Start cleaning now'));await start(h);assert.equal(h.run('state.jobs[0].status'),'cleaning');
});
test('Now defaults on; Later has only one availability date/time input',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});
 assert.equal(h.nodes.get('availability-now').checked,true);assert.equal(h.nodes.get('availability-fields').hidden,true);assert.equal(h.nodes.get('availability-fields').disabled,true);
 assert.equal([...h.html().matchAll(/type="datetime-local"/g)].length,1);assert.ok(!h.html().includes('available-until'));assert.ok(!h.html().includes('Until'));
 assert.equal(h.nodes.get('available-from').value,'2026-05-30T06:30');
});
test('Later does not scroll when the choices and date input already fit',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});
 h.nodes.get('availability-buttons').rect={top:102,bottom:157};h.nodes.get('availability-fields').rect={top:167,bottom:598};
 await h.change('availability-later',true);h.flushFrames();assert.equal(h.nodes.get('availability-fields').hidden,false);assert.equal(h.content.scrolled,undefined);
});
test('Later scrolls the minimum required while keeping Now/Later in view',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});h.content.scrollTop=100;
 h.nodes.get('availability-buttons').rect={top:250,bottom:300};h.nodes.get('availability-fields').rect={top:310,bottom:640};
 await h.change('availability-later',true);h.flushFrames();assert.equal(h.content.scrolled.top,148);assert.equal(h.content.scrolled.behavior,'smooth');
 assert.ok(250-(h.content.scrolled.top-100)>=h.content.rect.top+8);
});
test('in a short viewport, Later keeps its choices visible even if the entire block cannot fit',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});h.content.scrollTop=100;h.content.rect={top:100,bottom:280,height:180};
 h.nodes.get('availability-buttons').rect={top:130,bottom:180};h.nodes.get('availability-fields').rect={top:195,bottom:350};
 await h.change('availability-later',true);h.flushFrames();assert.equal(h.content.scrolled.top,122);assert.equal(130-(h.content.scrolled.top-100),108);
});
test('Later respects reduced motion, and switching to Now does not add a scroll',async()=>{
 const h=harness();await h.click({demo:'nurse'});await h.click({room:'4100'});h.ctx.matchMedia=()=>({matches:true});
 h.nodes.get('availability-buttons').rect={top:250,bottom:300};h.nodes.get('availability-fields').rect={top:310,bottom:640};
 await h.change('availability-later',true);h.flushFrames();assert.equal(h.content.scrolled.behavior,'auto');const prior=h.content.scrolled;
 await h.change('availability-now',true);h.flushFrames();assert.equal(h.content.scrolled,prior);assert.equal(h.nodes.get('availability-fields').hidden,true);
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
 assert.equal(h.nodes.get('defaults-unit').value,'Pediatrics');assert.match(h.nodes.get('floor-instructions').value,/stethoscope/);
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
 assert.deepEqual([...h.html().matchAll(/data-room="(\d+)"/g)].map(m=>m[1]),['2160','4100','4120']);
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
 await h.click({demo:'nurse'});await h.click({room:'2150'});assert.ok(h.html().includes('Maya Chen'));assert.equal(h.run('state.jobs[0].status'),'cleaning');
});
test('time display handles local midnight and year rollover',()=>{
 const h=harness(Date.parse('2027-01-01T04:59:00Z'));assert.equal(h.nodes.get('phone-time').textContent,'23:59');assert.equal(h.run('asOf(Date.now())'),'As of 23:59, 12/31');
 h.advance(2*M);h.tick();assert.equal(h.nodes.get('phone-time').textContent,'00:01');assert.equal(h.run('asOf(Date.now())'),'As of 00:01, 01/01');
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

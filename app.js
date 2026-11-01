'use strict';
const $=id=>document.getElementById(id);
const DB=(()=>{let p;const open=()=>p||(p=new Promise((ok,no)=>{const r=indexedDB.open('trip-mileage',1);
r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)}));
const tx=(m,f)=>open().then(d=>new Promise((ok,no)=>{const t=d.transaction('kv',m),q=f(t.objectStore('kv'));t.oncomplete=()=>ok(q&&q.result);t.onerror=()=>no(t.error)}));
return{get:async k=>{try{const v=await tx('readonly',s=>s.get(k));if(v!==undefined)return v}catch(e){}const l=localStorage.getItem(k);return l?JSON.parse(l):undefined},
set:async(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}try{await tx('readwrite',s=>s.put(v,k))}catch(e){}}}})();
let S={trips:[],places:[],current:null,settings:{profile:{}}};
const save=()=>Promise.all(['trips','places','current','settings'].map(k=>DB.set(k,S[k])));
const status=t=>$('status').textContent=t||'';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clean=s=>ExpenseSheet.clean(s);
let busy=false;
function lock(){if(busy)return false;busy=true;return true}
function unlock(){busy=false}
function todayISO(){const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())}
function defaultForm(){return{date:todayISO(),time:'0800',client:'',reason:'',parking:''}}
function formOf(t){return Object.assign(defaultForm(),t&&t.form||{})}
function profile(){return ExpenseSheet.profileOf(S.settings&&S.settings.profile)}
function timeChoices(){const out=[];for(let h=0;h<24;h++)for(const m of [0,30]){const ap=h<12?'上午':'下午';let h12=h%12;if(!h12)h12=12;out.push({value:String(h).padStart(2,'0')+String(m).padStart(2,'0'),label:ap+' '+String(h12).padStart(2,'0')+':'+String(m).padStart(2,'0')})}return out}
const TIMES=timeChoices();
$('fTime').innerHTML=TIMES.map(t=>`<option value="${t.value}">${t.label}</option>`).join('');
function timeLabel(v){const hit=TIMES.find(t=>t.value===v);return hit?hit.label:v}
function timeSelect(value,attrs){return `<select ${attrs||''}>`+TIMES.map(t=>`<option value="${t.value}"${t.value===value?' selected':''}>${t.label}</option>`).join('')+'</select>'}
function walkOf(t){return ExpenseSheet.walkKm(t)}
let lastNom=0;async function nom(path){const w=lastNom+1100-Date.now();if(w>0)await new Promise(r=>setTimeout(r,w));lastNom=Date.now();
const r=await fetch('https://nominatim.openstreetmap.org/'+path+'&format=jsonv2&accept-language=zh-TW');if(!r.ok)throw new Error('Nominatim '+r.status);return r.json()}
function shortName(j){const a=j.address||{};return j.name||[a.city||a.county,a.town||a.suburb||a.city_district,a.road].filter(Boolean).join('')||j.display_name}
function dist(a,b){const R=6371e3,t=x=>x*Math.PI/180,dl=t(b.lat-a.lat),dg=t(b.lng-a.lng);
const h=Math.sin(dl/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const nearPlace=p=>S.places.map(x=>[x,dist(x,p)]).filter(x=>x[1]<=300).sort((a,b)=>a[1]-b[1])[0]?.[0];
let pendingGeo=0;
function reverseGeocode(p){pendingGeo++;nom(`reverse?lat=${p.lat}&lon=${p.lng}&zoom=18`).then(async j=>{p.address=j.display_name;if(!p.renamed)p.name=shortName(j);await save();render()}).catch(()=>status('地址查詢失敗（仍已記錄座標）')).finally(()=>{pendingGeo--})}
function waitGeo(){if(!pendingGeo)return Promise.resolve();return new Promise(resolve=>{const start=Date.now();const tick=()=>pendingGeo&&Date.now()-start<8000?setTimeout(tick,80):resolve();tick()})}
function readLiveForm(){if(!S.current)return;const f=S.current.form=Object.assign(defaultForm(),S.current.form);
if($('fDate'))f.date=$('fDate').value||f.date;
if($('fTime'))f.time=$('fTime').value||'0800';
if($('fClient'))f.client=clean($('fClient').value);
if($('fReason'))f.reason=clean($('fReason').value);
if($('fPark'))f.parking=$('fPark').value}
function fillIfIdle(el,value){if(!el||document.activeElement===el)return;if(el.value!==value)el.value=value}
function fillLiveForm(){if(!S.current)return;const f=Object.assign(defaultForm(),S.current.form);S.current.form=f;
fillIfIdle($('fDate'),f.date);fillIfIdle($('fTime'),f.time);fillIfIdle($('fClient'),f.client);fillIfIdle($('fReason'),f.reason);fillIfIdle($('fPark'),f.parking)}
async function addStop(p){readLiveForm();const np=nearPlace(p);p.name=np?np.name:p.name;S.current.stops.push(p);await save();render();if(!np&&!p.address)reverseGeocode(p)}
function geoPoint(pos){return{lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:Math.round(pos.coords.accuracy),time:new Date().toISOString(),name:'定位點'}}
function geoError(e){return new Error('定位失敗：'+(e&&e.message||e)+'（需 HTTPS 並允許定位權限）')}
function locate(){if(!navigator.geolocation)return Promise.reject(new Error('此瀏覽器不支援定位'));
const once=high=>new Promise((ok,no)=>{navigator.geolocation.getCurrentPosition(pos=>ok(geoPoint(pos)),no,{enableHighAccuracy:high,timeout:20000,maximumAge:high?0:15000})});
return once(true).catch(e=>{if(e&&e.code===1)throw geoError(e);return once(false).catch(e2=>{throw geoError(e2)})})}
async function recordHere(){if(!lock())return;const pending=locate();try{status('定位中…');const p=await pending;await addStop(p);status(`已記錄（誤差約 ${p.accuracy} m）`)}catch(e){status(e.message)}finally{unlock()}}
async function calc(){if(!S.current)return status('目前沒有進行中的行程');readLiveForm();status('路線計算中…');await waitGeo();if(!S.current)return;const st=S.current.stops;if(!st||st.length<2)return status('至少需要兩個地點');status('路線計算中…');
try{if(typeof Routing==='undefined')throw new Error('路線模組未載入');
const r=await Routing.computeTrip(st,{countRamps:false});
const form=Object.assign(defaultForm(),S.current.form);
const trip={id:Date.now(),date:form.date,stops:st,route:ExpenseSheet.placeText(st),total_km:r.total_km,freeway_km:r.freeway_km,ramp_km:r.ramp_km,legs:r.legs,form};
S.trips.unshift(trip);S.current=null;await save();status('');render();showResult(trip)}catch(e){status(e.message||'路線計算失敗')}}
function formFields(trip){const f=formOf(trip);const id=esc(trip.id);
return `<div class="fields" data-trip="${id}">
<label>公出日期<input type="date" data-k="date" value="${esc(f.date)}"></label>
<label>時間${timeSelect(f.time,'data-k="time"')}</label>
<label>洽公對象<input type="text" data-k="client" value="${esc(f.client)}" autocomplete="off"></label>
<label>事由<input type="text" data-k="reason" value="${esc(f.reason)}" autocomplete="off"></label>
<label>停車費<input type="number" data-k="parking" value="${esc(f.parking)}" inputmode="decimal" step="1" placeholder="空白為 0"></label>
</div>`}
function showResult(t){const walk=walkOf(t);
$('result').innerHTML=`<div class="log" data-trip="${esc(t.id)}"><div class="hud"><div class="hud-cell"><div class="hud-lab">TOTAL</div><div class="hud-num">${esc(t.total_km)}</div><div class="hud-unit">總里程 km</div></div><div class="hud-cell alt"><div class="hud-lab">FREEWAY</div><div class="hud-num">${esc(walk)}</div><div class="hud-unit">行走里程 km</div></div></div><p class="sub">匯出日總里程 ${ExpenseSheet.intText(t.total_km)}，行走里程 ${walk}（國道 ${esc(t.freeway_km)}＋交流道／匝道 ${esc(t.ramp_km)}，四捨五入）</p><table><tr><th>路段</th><th>km</th><th>國道</th></tr>`+
(t.legs||[]).map(l=>`<tr><td>${esc(l.from)} → ${esc(l.to)}</td><td>${l.km}</td><td>${l.freeway_km}</td></tr>`).join('')+
`<tr><th>合計／行走</th><th>${esc(t.total_km)}</th><th>${esc(walk)}</th></tr></table>`+formFields(t)+`</div>`}
function render(){const c=S.current;$('tripIdle').hidden=!!c;$('tripActive').hidden=!c;
$('stops').innerHTML=c?(c.stops.length?c.stops.map((s,i)=>`<li class="arrival"><button type="button" class="namebtn" data-a="ren" data-i="${i}">抵達：${esc(s.name)}</button><p class="hint">TAP NAME · 點名稱改名</p><span class="sub">${s.time?new Date(s.time).toLocaleTimeString('zh-TW'):''} ${s.accuracy?'±'+s.accuracy+'m':''}${s.address?'<br>'+esc(s.address):''}</span><div class="row">
<button type="button" class="mini" data-a="up" data-i="${i}">↑</button><button type="button" class="mini" data-a="down" data-i="${i}">↓</button>
<button type="button" class="mini" data-a="fav" data-i="${i}">存為常用</button><button type="button" class="mini danger" data-a="del" data-i="${i}">刪除</button></div></li>`).join(''):'<li class="sub">還沒有抵達紀錄。點名稱可改名。</li>'):'';
if(c)fillLiveForm();
$('pending').innerHTML=S.trips.length?S.trips.map(t=>{const f=formOf(t);return `<li class="card" data-trip="${esc(t.id)}"><h3>${esc(f.date)} ${esc(timeLabel(f.time))}</h3><div>${esc(t.route||ExpenseSheet.placeText(t.stops))}</div><span class="sub">總里程 ${esc(t.total_km)} km／行走里程 ${walkOf(t)} km${f.client?'／'+esc(f.client):''}</span><div class="row stops-edit">`+
(t.stops||[]).map((s,i)=>`<button type="button" class="mini" data-act="renstop" data-id="${esc(t.id)}" data-i="${i}">${esc(s.name)}</button>`).join('')+
`</div>`+formFields(t)+`<div class="row"><button type="button" class="mini" data-act="detail" data-id="${esc(t.id)}">明細</button><button type="button" class="mini danger" data-act="del" data-id="${esc(t.id)}">刪除</button></div></li>`}).join(''):'<li class="sub">還沒有待報帳的行程</li>';
$('places').innerHTML=S.places.map((p,i)=>`<li class="place"><b>${esc(p.name)}</b> <span class="sub">${p.lat.toFixed(4)},${p.lng.toFixed(4)}</span> <button type="button" class="mini danger" data-p="${i}">刪除</button></li>`).join('')||'<li class="sub">在行程中按「存為常用」新增（300 m 內自動套用名稱）</li>';
const p=profile();S.settings.profile=p;
fillIfIdle($('setPayee'),p.payee);fillIfIdle($('setEmp'),p.empId);fillIfIdle($('setCar'),p.carNo);fillIfIdle($('setFuel'),p.fuel);
const F=ExpenseSheet.FIXED;
$('fixedMeta').textContent=`公司 ${F.company}　廠區 ${F.plant}　${F.division}　${F.dept}　${F.deptCode}`}
function readProfile(){S.settings.profile=ExpenseSheet.profileOf({payee:$('setPayee').value,empId:$('setEmp').value,carNo:$('setCar').value,fuel:$('setFuel').value});save()}
function onField(e){const el=e.target;if(!el.dataset||!el.dataset.k)return;const box=el.closest('[data-trip]');
if(!box){readLiveForm();save();return}
const trip=S.trips.find(t=>String(t.id)===box.dataset.trip);if(!trip)return;
trip.form=Object.assign(defaultForm(),trip.form);
const key=el.dataset.k;
let value=el.value;
if(key==='client'||key==='reason')value=clean(value);
trip.form[key]=value;
if(key==='date')trip.date=value;
if((key==='client'||key==='reason')&&el.value!==value)el.value=value;
save();
document.querySelectorAll(`[data-trip="${CSS.escape(String(trip.id))}"] [data-k="${CSS.escape(el.dataset.k)}"]`).forEach(other=>{if(other!==el&&document.activeElement!==other)other.value=el.value})}
$('liveFields').addEventListener('input',onField);
$('liveFields').addEventListener('change',onField);
$('result').addEventListener('input',onField);
$('result').addEventListener('change',onField);
$('pending').addEventListener('input',onField);
$('pending').addEventListener('change',onField);
$('stops').onclick=async e=>{const btn=e.target.closest('button');if(!btn||!S.current)return;const b=btn.dataset;if(!b.a)return;readLiveForm();const st=S.current.stops,i=+b.i;if(!st[i])return;
if(b.a==='ren'){const n=clean(prompt('停靠點名稱',st[i].name)||'');if(n){st[i].name=n;st[i].renamed=true}}
if(b.a==='del'&&confirm('刪除這個點？'))st.splice(i,1);
if(b.a==='up'&&i>0)[st[i-1],st[i]]=[st[i],st[i-1]];
if(b.a==='down'&&i<st.length-1)[st[i+1],st[i]]=[st[i],st[i+1]];
if(b.a==='fav'){const n=clean(prompt('常用地點名稱',st[i].name)||'');if(n){S.places.push({name:n,lat:st[i].lat,lng:st[i].lng});st[i].name=n;st[i].renamed=true}}
await save();render()};
$('pending').onclick=async e=>{const btn=e.target.closest('button');if(!btn||!$('pending').contains(btn))return;const id=btn.dataset.id,act=btn.dataset.act;if(!act)return;
const trip=S.trips.find(t=>String(t.id)===id);if(!trip)return;
if(act==='detail')showResult(trip);
if(act==='renstop'){const i=+btn.dataset.i;const n=clean(prompt('停靠點名稱',trip.stops[i]&&trip.stops[i].name)||'');if(n&&trip.stops[i]){trip.stops[i].name=n;trip.stops[i].renamed=true;trip.route=ExpenseSheet.placeText(trip.stops);await save();render();if($('result').querySelector(`[data-trip="${CSS.escape(id)}"]`))showResult(trip)}}
if(act==='del'&&confirm('刪除此待報帳行程？')){S.trips=S.trips.filter(t=>String(t.id)!==id);if($('result').querySelector(`[data-trip="${CSS.escape(id)}"]`))$('result').innerHTML='';await save();render()}};
$('places').onclick=async e=>{const btn=e.target.closest('button');if(!btn||btn.dataset.p===undefined)return;S.places.splice(+btn.dataset.p,1);await save();render()};
$('btnStart').onclick=async()=>{if(!lock())return;const pending=locate();try{S.current={stops:[],form:defaultForm()};$('result').innerHTML='';await save();render();status('定位中…');const p=await pending;await addStop(p);status(`已記錄（誤差約 ${p.accuracy} m）`)}catch(e){status(e.message)}finally{unlock()}};
$('btnHere').onclick=recordHere;
$('btnEnd').onclick=async()=>{if(!lock())return;const pending=locate();status('定位中…');try{await addStop(await pending);await calc()}catch(e){status(e.message)}finally{unlock()}};
$('btnCalc').onclick=async()=>{if(!lock())return;try{await calc()}finally{unlock()}};
$('btnCancel').onclick=async()=>{if(confirm('放棄目前行程？')){S.current=null;$('result').innerHTML='';await save();render()}};
$('btnSearch').onclick=async()=>{const q=$('q').value.trim();if(!q)return;status('搜尋中…');
try{const r=await nom(`search?q=${encodeURIComponent(q)}&countrycodes=tw&limit=5&addressdetails=1`);status(r.length?'':'找不到');
$('results').innerHTML=r.map((x,i)=>`<li><button type="button" class="mini" data-r="${i}">加入</button> ${esc(x.display_name)}</li>`).join('');
$('results').onclick=async e=>{const btn=e.target.closest('button');if(!btn)return;const x=r[btn.dataset.r];if(!x)return;$('results').innerHTML='';$('q').value='';
await addStop({lat:+x.lat,lng:+x.lon,name:shortName(x),address:x.display_name,time:new Date().toISOString(),manual:true})}}catch(e){status(e.message)}};
['setPayee','setEmp','setCar','setFuel'].forEach(id=>$(id).addEventListener('change',()=>{readProfile();render()}));
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
async function shareBlob(name,blob){const file=new File([blob],name,{type:blob.type||'application/vnd.ms-excel'});
if(isIOS()&&navigator.share){try{if(!navigator.canShare||navigator.canShare({files:[file]})){await navigator.share({files:[file],title:name});return 'shared'}}catch(e){if(e&&e.name==='AbortError')return 'abort'}}
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);return 'downloaded'}
function loadXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((ok,no)=>{const s=document.createElement('script');s.src='./vendor/xlsx.full.min.js';s.onload=()=>window.XLSX?ok(window.XLSX):no(new Error('報帳元件載入失敗'));s.onerror=()=>no(new Error('報帳元件載入失敗'));document.head.appendChild(s)})}
async function exportXls(){if(!S.trips.length)return status('沒有待報帳行程');status('產生報帳表…');
try{const XLSX=await loadXLSX();const buf=await fetch('./company-template.xls').then(r=>{if(!r.ok)throw new Error('找不到報帳範本');return r.arrayBuffer()});
const wb=XLSX.read(buf,{type:'array',cellStyles:true});
const trips=S.trips.slice().sort((a,b)=>String(formOf(a).date).localeCompare(String(formOf(b).date))||a.id-b.id);
ExpenseSheet.fillWorkbook(wb,trips,profile(),XLSX);
const out=XLSX.write(wb,{bookType:'xls',type:'array',cellStyles:true});
const blob=new Blob([out],{type:'application/vnd.ms-excel'});
const how=await shareBlob('公司報帳表.xls',blob);
if(how==='abort'){status('已取消分享');return}
$('btnClear').hidden=false;status('已匯出 '+trips.length+' 筆。確認檔案沒問題後可清空清單。')}catch(e){status(e.message||'匯出失敗')}}
$('btnXls').onclick=()=>{exportXls()};
$('btnClear').onclick=async()=>{if(!S.trips.length)return;if(!confirm('清空所有待報帳行程？匯出的檔案不會被刪除。'))return;S.trips=[];$('btnClear').hidden=true;$('result').innerHTML='';await save();render();status('已清空待報帳行程')};
(async()=>{for(const k of Object.keys(S)){const v=await DB.get(k);if(v!==undefined&&v!==null)S[k]=v}
if(!Array.isArray(S.trips))S.trips=[];if(!Array.isArray(S.places))S.places=[];
if(!S.settings||typeof S.settings!=='object')S.settings={};
S.settings.profile=ExpenseSheet.profileOf(S.settings.profile);
if(S.current&&!Array.isArray(S.current.stops))S.current.stops=[];
if(S.current)S.current.form=Object.assign(defaultForm(),S.current.form);
if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});render();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{})})();

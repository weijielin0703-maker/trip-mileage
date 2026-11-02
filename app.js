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
function shortName(j){const a=j.address||{},hn=a.house_number?String(a.house_number).replace(/號?$/,'號'):'';
return j.name||[a.city||a.county,a.town||a.suburb||a.city_district,a.road&&a.road+hn].filter(Boolean).join('')||j.display_name}
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
// routing.js can miss the page load (bad signal, mid-deploy). Fetch it again, past every cache, before giving up.
function ensureRouting(){if(window.Routing)return Promise.resolve(window.Routing);
return new Promise((ok,no)=>{const s=document.createElement('script');s.src='./routing.js?r='+Date.now();
s.onload=()=>window.Routing?ok(window.Routing):no(new Error('路線模組載入失敗（'+scriptFailures()+'）。請關掉 app 再重新開啟。'));
s.onerror=()=>no(new Error('路線模組下載失敗，請確認網路後再按「只計算」。行程已保留。'));document.head.appendChild(s)})}
function scriptFailures(){return (window.__failedScripts||[]).join('、')||'原因不明'}
async function calc(){if(!S.current)return status('目前沒有進行中的行程');readLiveForm();status('路線計算中…');await waitGeo();if(!S.current)return;const st=S.current.stops;if(!st||st.length<2)return status('至少需要兩個地點');status('路線計算中…');
try{const r=await (await ensureRouting()).computeTrip(st,{countRamps:false});
const form=Object.assign(defaultForm(),S.current.form);
const trip={id:Date.now(),date:form.date,stops:st,route:ExpenseSheet.placeText(st),total_km:r.total_km,freeway_km:r.freeway_km,ramp_km:r.ramp_km,legs:r.legs,roads:r.roads,polyline:r.polyline,form};
S.trips.unshift(trip);S.current=null;await save();status('');render();showResult(trip)}catch(e){status(e.message||'路線計算失敗')}}
// Messages for a pending trip show inside its card (the page status line is far up the page).
const cardMsgs=new Map();
function cardMsg(trip,t){cardMsgs.set(String(trip.id),t);const el=document.querySelector(`#pending [data-msg="${CSS.escape(String(trip.id))}"]`);if(el)el.textContent=t}
// Routes `stops` for a saved trip and only then stores them with the new mileage, so a failed
// request never leaves stops and kilometres out of step. ask: confirm when the export numbers change.
async function reroute(trip,stops,opt){if(!lock())return;const say=t=>cardMsg(trip,t);say('重新計算中…');
try{if(stops.length<2)return say('至少需要兩個地點');
const r=await (await ensureRouting()).computeTrip(stops,{countRamps:false});
const next={total_km:r.total_km,freeway_km:r.freeway_km,ramp_km:r.ramp_km};
const k={oldWalk:walkOf(trip),newWalk:walkOf(next),oldTotal:ExpenseSheet.intText(trip.total_km),newTotal:ExpenseSheet.intText(r.total_km)};
k.same=k.oldWalk===k.newWalk&&k.oldTotal===k.newTotal;
if(opt.ask&&!k.same&&!confirm(`重新計算結果\n總里程：${k.oldTotal} → ${k.newTotal} km\n行走里程：${k.oldWalk} → ${k.newWalk} km\n要更新這筆行程嗎？`))return say('已取消，保留原本的里程');
Object.assign(trip,next,{stops,legs:r.legs,roads:r.roads,polyline:r.polyline,route:ExpenseSheet.placeText(stops)});
await save();render();if($('result').querySelector(`[data-trip="${CSS.escape(String(trip.id))}"]`))showResult(trip);
say(opt.done(k))}
catch(e){say(String(e.message||'重新計算失敗').replace(/行程已保留.*$/,'').trim()+(opt.ask?' 里程沒有變更，請稍後再試。':' 停靠點沒有變更，請稍後再試。'))}finally{unlock()}}
const kmChange=k=>k.same?'里程沒有變':`總里程 ${k.oldTotal} → ${k.newTotal} km，行走里程 ${k.oldWalk} → ${k.newWalk} km`;
// Re-routes a saved trip with the current rules. Stops and form fields stay as they are.
function recalc(trip){return reroute(trip,(trip.stops||[]).slice(),{ask:true,done:k=>k.same?'重新計算完成，報帳里程沒有變（已補上地圖與國道明細）':`已更新：總里程 ${k.newTotal} km，行走里程 ${k.newWalk} km`})}
function formFields(trip){const f=formOf(trip);const id=esc(trip.id);
return `<div class="fields" data-trip="${id}">
<label>公出日期<input type="date" data-k="date" value="${esc(f.date)}"></label>
<label>時間${timeSelect(f.time,'data-k="time"')}</label>
<label>洽公對象<input type="text" data-k="client" value="${esc(f.client)}" autocomplete="off"></label>
<label>事由<input type="text" data-k="reason" value="${esc(f.reason)}" autocomplete="off"></label>
<label>停車費<input type="number" data-k="parking" value="${esc(f.parking)}" inputmode="decimal" step="1" placeholder="空白為 0"></label>
</div>`}
function roadsTable(t){if(!Array.isArray(t.roads))return '<p class="sub">這趟是舊版算的，沒有國道明細。</p>';
if(!t.roads.length)return '<p class="sub">這趟沒有走國道。</p>';
return `<table class="roads"><tr><th>計入行走里程的道路</th><th>km</th></tr>`+t.roads.map(r=>`<tr><td>${esc(r.name)}<span class="sub">${r.kind==='ramp'?'交流道／匝道':'國道'}</span></td><td>${esc(r.km)}</td></tr>`).join('')+`</table><p class="sub">可以和 Google 地圖的路線對照，路名不對時代表判斷有誤。</p>`}
function showResult(t){const walk=walkOf(t);
$('result').innerHTML=`<div class="log" data-trip="${esc(t.id)}"><div class="hud"><div class="hud-cell"><div class="hud-lab">TOTAL</div><div class="hud-num">${esc(t.total_km)}</div><div class="hud-unit">總里程 km</div></div><div class="hud-cell alt"><div class="hud-lab">FREEWAY</div><div class="hud-num">${esc(walk)}</div><div class="hud-unit">行走里程 km</div></div></div><p class="sub">匯出日總里程 ${ExpenseSheet.intText(t.total_km)}，行走里程 ${walk}（國道 ${esc(t.freeway_km)}＋交流道／匝道 ${esc(t.ramp_km)}，四捨五入）</p><div class="map" id="map" role="img" aria-label="路線地圖"></div><p class="sub" id="mapNote"></p><table><tr><th>路段</th><th>km</th><th>國道</th></tr>`+
(t.legs||[]).map(l=>`<tr><td>${esc(l.from)} → ${esc(l.to)}</td><td>${esc(l.km)}</td><td>${esc(l.freeway_km)}</td></tr>`).join('')+
`<tr><th>合計／行走</th><th>${esc(t.total_km)}</th><th>${esc(walk)}</th></tr></table>`+roadsTable(t)+formFields(t)+`</div>`;
drawMap(t)}
let mapView=null;
function loadLeaflet(){if(window.L)return Promise.resolve(window.L);
if(!document.querySelector('link[data-leaflet]')){const l=document.createElement('link');l.rel='stylesheet';l.href='./vendor/leaflet/leaflet.css';l.dataset.leaflet='1';document.head.appendChild(l)}
return new Promise((ok,no)=>{const s=document.createElement('script');s.src='./vendor/leaflet/leaflet.js';s.onload=()=>window.L?ok(window.L):no(new Error('地圖元件載入失敗'));s.onerror=()=>no(new Error('地圖元件載入失敗'));document.head.appendChild(s)})}
async function drawMap(t){if(mapView){mapView.remove();mapView=null}
const stops=(t.stops||[]).filter(s=>Number.isFinite(+s.lat)&&Number.isFinite(+s.lng));if(!stops.length){$('map').hidden=true;return}
let L;try{L=await loadLeaflet()}catch(e){$('map').hidden=true;$('mapNote').textContent=e.message;return}
const box=$('map');if(!box||box.closest('[data-trip]').dataset.trip!==String(t.id))return;
mapView=L.map(box,{zoomControl:true,attributionControl:true,scrollWheelZoom:false});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(mapView);
const line=Array.isArray(t.polyline)&&t.polyline.length>1?t.polyline:null;
const pts=stops.map(s=>[+s.lat,+s.lng]);
const path=line?L.polyline(line,{color:'#3ef0ff',weight:5,opacity:.9}):L.polyline(pts,{color:'#3ef0ff',weight:3,dashArray:'6 8'});
path.addTo(mapView);
stops.forEach((s,i)=>L.circleMarker([+s.lat,+s.lng],{radius:i===0||i===stops.length-1?8:6,color:'#070b16',weight:2,fillColor:i===0?'#c8ff4a':i===stops.length-1?'#ff3d9a':'#ffffff',fillOpacity:1}).bindTooltip((i+1)+'. '+String(s.name||''),{direction:'top'}).addTo(mapView));
mapView.fitBounds(L.latLngBounds(pts.concat(line||[])),{padding:[24,24],maxZoom:16});
$('mapNote').textContent=line?'':'舊版行程沒有存路線，只用虛線連起停靠點。'}
function render(){const c=S.current;$('tripIdle').hidden=!!c;$('tripActive').hidden=!c;
$('stops').innerHTML=c?(c.stops.length?c.stops.map((s,i)=>`<li class="arrival"><button type="button" class="namebtn" data-a="ren" data-i="${i}">抵達：${esc(s.name)}</button><p class="hint">TAP NAME · 點名稱改名</p><span class="sub">${s.time?new Date(s.time).toLocaleTimeString('zh-TW'):''} ${s.accuracy?'±'+esc(s.accuracy)+'m':''}${s.approx?'<b class="warn">約略位置（路段）</b>':''}${s.address?'<br>'+esc(s.address):''}</span><div class="row">
<button type="button" class="mini" data-a="up" data-i="${i}">↑</button><button type="button" class="mini" data-a="down" data-i="${i}">↓</button>
<button type="button" class="mini" data-a="fav" data-i="${i}">存為常用</button><button type="button" class="mini danger" data-a="del" data-i="${i}">刪除</button></div></li>`).join(''):'<li class="sub">還沒有抵達紀錄。點名稱可改名。</li>'):'';
if(c)fillLiveForm();
renderPending();
$('places').innerHTML=S.places.map((p,i)=>`<li class="place"><b>${esc(p.name)}</b> <span class="sub">${p.lat.toFixed(4)},${p.lng.toFixed(4)}</span> <button type="button" class="mini danger" data-p="${i}">刪除</button></li>`).join('')||'<li class="sub">在行程中按「存為常用」新增（300 m 內自動套用名稱）</li>';
const p=profile();S.settings.profile=p;
fillIfIdle($('setPayee'),p.payee);fillIfIdle($('setEmp'),p.empId);fillIfIdle($('setCar'),p.carNo);fillIfIdle($('setFuel'),p.fuel);
const F=ExpenseSheet.FIXED;
$('fixedMeta').textContent=`公司 ${F.company}　廠區 ${F.plant}　${F.division}　${F.dept}　${F.deptCode}`;renderSetup();renderBackup()}
// Pending trips: one compact line each (newest date first); tap to open the editable fields.
const openTrips=new Set();
const WEEK='日一二三四五六';
function shortDate(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');if(!m)return esc(iso||'未填日期');const d=new Date(+m[1],m[2]-1,+m[3]);
return (+m[1]!==new Date().getFullYear()?m[1]+'/':'')+m[2]+'/'+m[3]+'（'+WEEK[d.getDay()]+'）'}
function missingFields(f){return [!f.client&&'洽公對象',!f.reason&&'事由'].filter(Boolean)}
function tripSummary(t){const f=formOf(t),miss=missingFields(f),route=(t.stops||[]).map(s=>s&&s.name).filter(Boolean);
return `<div class="sum-top"><span class="sum-date">${shortDate(f.date)}<span class="sub"> ${esc(timeLabel(f.time))}</span></span><span class="sum-km"><b>${ExpenseSheet.intText(t.total_km)}</b> km<span class="sub">　行走 </span><b>${walkOf(t)}</b></span></div>
<div class="sum-route">${route.map(esc).join(' → ')||esc(t.route)}</div>`+
(miss.length?`<div class="sum-miss warn">待填：${miss.join('、')}</div>`:f.client?`<div class="sum-meta sub">${esc(f.client)}・${esc(f.reason)}</div>`:'')}
function renderPending(){const id=t=>esc(t.id);
$('pending').querySelectorAll('details[data-id]').forEach(d=>{if(d.open)openTrips.add(d.dataset.id);else openTrips.delete(d.dataset.id)});
const list=S.trips.slice().sort((a,b)=>String(formOf(b).date).localeCompare(String(formOf(a).date))||String(formOf(b).time).localeCompare(String(formOf(a).time))||b.id-a.id);
renderPendingSum();
$('pending').innerHTML=list.length?list.map(t=>`<li class="card" data-card="${id(t)}"><details data-id="${id(t)}"${openTrips.has(String(t.id))?' open':''}><summary>${tripSummary(t)}</summary><div class="card-body">
<p class="hint">TAP STOP · 點站名改名，刪除或調整順序後會自動重算里程</p><ol class="pstops">`+
(t.stops||[]).map((s,i,all)=>`<li><button type="button" class="namebtn" data-act="renstop" data-id="${id(t)}" data-i="${i}">${i+1}. ${esc(s.name)}</button><span class="pstop-act">`+
`<button type="button" class="mini" data-act="stopup" data-id="${id(t)}" data-i="${i}" aria-label="往上"${i?'':' disabled'}>↑</button>`+
`<button type="button" class="mini" data-act="stopdown" data-id="${id(t)}" data-i="${i}" aria-label="往下"${i<all.length-1?'':' disabled'}>↓</button>`+
`<button type="button" class="mini danger" data-act="stopdel" data-id="${id(t)}" data-i="${i}"${all.length>2?'':' disabled title="至少要有兩個點"'}>刪除</button></span></li>`).join('')+
`</ol><p class="card-msg" data-msg="${id(t)}">${esc(cardMsgs.get(String(t.id))||'')}</p>`+formFields(t)+`<div class="row"><button type="button" class="mini" data-act="detail" data-id="${id(t)}">地圖與明細</button><button type="button" class="mini" data-act="recalc" data-id="${id(t)}">重新計算</button><button type="button" class="mini danger" data-act="del" data-id="${id(t)}">刪除整筆</button></div></div></details></li>`).join(''):'<li class="sub">還沒有待報帳的行程</li>'}
// Keeps the closed line in step while fields are edited, without re-sorting under the finger.
function refreshSummary(trip){const sum=document.querySelector(`#pending [data-card="${CSS.escape(String(trip.id))}"] summary`);if(sum)sum.innerHTML=tripSummary(trip);renderPendingSum()}
function renderPendingSum(){const list=S.trips,todo=list.filter(t=>missingFields(formOf(t)).length).length,total=list.reduce((n,t)=>n+Number(ExpenseSheet.intText(t.total_km)),0),walk=list.reduce((n,t)=>n+walkOf(t),0);
$('pendingSum').innerHTML=list.length?`${list.length} 筆・總里程 ${total} km・行走 ${walk} km`+(todo?`<span class="warn">・${todo} 筆待填</span>`:''):''}
function renderSetup(){const miss=ExpenseSheet.missingProfile(S.settings.profile);$('setupBox').hidden=!miss.length;$('setupMissing').textContent=miss.join('、');return miss}
const PROFILE_INPUTS={受款人:'setPayee',工號:'setEmp',車號:'setCar'};
function goSetup(){const miss=renderSetup();$('settingsBox').scrollIntoView({block:'start'});const el=$(PROFILE_INPUTS[miss[0]]);if(el)setTimeout(()=>el.focus({preventScroll:true}),350)}
function readProfile(){S.settings.profile=ExpenseSheet.profileOf({payee:$('setPayee').value,empId:$('setEmp').value,carNo:$('setCar').value,fuel:$('setFuel').value});save();renderSetup()}
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
document.querySelectorAll(`[data-trip="${CSS.escape(String(trip.id))}"] [data-k="${CSS.escape(el.dataset.k)}"]`).forEach(other=>{if(other!==el&&document.activeElement!==other)other.value=el.value});
refreshSummary(trip)}
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
if(act==='detail'){showResult(trip);$('result').scrollIntoView({block:'start'})}
if(act==='recalc')await recalc(trip);
if(act==='stopdel'||act==='stopup'||act==='stopdown'){const i=+btn.dataset.i,st=(trip.stops||[]).slice(),s=st[i];if(!s)return;
if(act==='stopdel'){if(st.length<=2)return cardMsg(trip,'至少要有兩個點，不能再刪');if(!confirm(`刪除「${s.name}」？會重新計算這筆行程的里程。`))return;st.splice(i,1);
await reroute(trip,st,{done:k=>`已刪除「${s.name}」。${kmChange(k)}`})}
else{const j=act==='stopup'?i-1:i+1;if(!st[j])return;[st[i],st[j]]=[st[j],st[i]];
await reroute(trip,st,{done:k=>`已調整順序。${kmChange(k)}`})}}
if(act==='renstop'){const i=+btn.dataset.i;const n=clean(prompt('停靠點名稱',trip.stops[i]&&trip.stops[i].name)||'');if(n&&trip.stops[i]){trip.stops[i].name=n;trip.stops[i].renamed=true;trip.route=ExpenseSheet.placeText(trip.stops);await save();render();if($('result').querySelector(`[data-trip="${CSS.escape(id)}"]`))showResult(trip)}}
if(act==='del'&&confirm('刪除此待報帳行程？')){S.trips=S.trips.filter(t=>String(t.id)!==id);if($('result').querySelector(`[data-trip="${CSS.escape(id)}"]`))$('result').innerHTML='';await save();render()}};
$('places').onclick=async e=>{const btn=e.target.closest('button');if(!btn||btn.dataset.p===undefined)return;S.places.splice(+btn.dataset.p,1);await save();render()};
$('btnStart').onclick=async()=>{if(!lock())return;const pending=locate();try{S.current={stops:[],form:defaultForm()};$('result').innerHTML='';await save();render();status('定位中…');const p=await pending;await addStop(p);status(`已記錄（誤差約 ${p.accuracy} m）`)}catch(e){status(e.message)}finally{unlock()}};
$('btnHere').onclick=recordHere;
$('btnEnd').onclick=async()=>{if(!lock())return;const pending=locate();status('定位中…');try{await addStop(await pending);await calc()}catch(e){status(e.message)}finally{unlock()}};
$('btnCalc').onclick=async()=>{if(!lock())return;try{await calc()}finally{unlock()}};
$('btnCancel').onclick=async()=>{if(confirm('放棄目前行程？')){S.current=null;$('result').innerHTML='';await save();render()}};
// Tries the text as typed, then Geocode's parsed forms (house number apart from road, then lane, then road).
async function searchAddress(q){const vs=Geocode.variants(q);
for(let i=0;i<vs.length;i++){if(i)status('換個寫法再找…（'+(i+1)+'/'+vs.length+'）');
const r=await nom('search?'+new URLSearchParams(vs[i].params)+'&countrycodes=tw&limit=5&addressdetails=1');
if(r.length)return{hits:r,exact:Geocode.isExact(vs[i],r[0])}}
return{hits:[],exact:false}}
// Search order: pasted coordinates, then saved places (instant), then OpenStreetMap.
// Each result row carries the stop it would add, so one click handler serves them all.
let searchItems=[],searchQuery='',searchTrusted=false;
function showResults(items,note){searchItems=items;
$('results').innerHTML=(note?`<li class="sub warn">${note}</li>`:'')+items.map((it,i)=>`<li><button type="button" class="mini" data-r="${i}">加入</button> ${it.label}</li>`).join('')+
(searchQuery?`<li class="sub">都不對？<button type="button" class="mini" data-pick="1">在地圖上選點</button></li>`:'')}
$('results').onclick=async e=>{const btn=e.target.closest('button');if(!btn)return;
if(btn.dataset.pick)return openPicker();
const it=searchItems[btn.dataset.r];if(!it)return;$('results').innerHTML='';$('q').value='';searchQuery='';
await addStop(Object.assign({time:new Date().toISOString(),manual:true},it.stop))};
$('btnSearch').onclick=async()=>{const q=$('q').value.trim();if(!q)return;searchQuery=q;$('results').innerHTML='';
const c=Geocode.coords(q);
if(c){status('');searchTrusted=true;if(pickView){pickView.setView([c.lat,c.lng],17);pickPin.setLatLng([c.lat,c.lng])}return showResults([{label:`座標 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}（加入後會自動查地址）`,stop:{lat:c.lat,lng:c.lng,name:'座標點'}}])}
const mine=S.places.filter(p=>Geocode.nameMatches(q,p.name)).map(p=>({label:`<b>${esc(p.name)}</b> <span class="sub">常用地點</span>`,stop:{lat:p.lat,lng:p.lng,name:p.name,renamed:true}}));
searchTrusted=mine.length>0;if(mine.length)showResults(mine);
status('搜尋中…');
try{const {hits:r,exact}=await searchAddress(q);if(searchQuery!==q)return;
const isAddr=!!Geocode.parse(q);
const named=isAddr||r.some(x=>Geocode.nameMatches(q,x.name)||Geocode.nameMatches(q,x.display_name));
const osm=r.map(x=>({label:esc(x.display_name),stop:{lat:+x.lat,lng:+x.lon,name:isAddr&&!exact?clean(Geocode.normalize(q).replace(/(\d+樓.*|\d+F.*)$/i,'')):shortName(x),address:x.display_name,approx:isAddr&&!exact||undefined}}));
let note='',shown=mine.concat(osm);
if(!named&&mine.length)shown=mine; // a saved place beats look-alike names
else if(!r.length)note='地圖資料裡找不到。可以改打路名，或在地圖上選點。';
else if(isAddr&&!exact)note='地圖資料裡沒有這個門牌，以下是路段的位置，可能和實際地點有段距離。';
else if(!named)note=`地圖資料裡沒有叫「${esc(q)}」的地點，以下只是名稱相近的結果。小店家、停車場常常沒有收錄，請在地圖上選點。`;
searchTrusted=!!(mine.length||named&&osm.length);
status('');showResults(shown,note);
const go=mine[0]||named&&osm[0];if(pickView&&go){const at=[go.stop.lat,go.stop.lng];pickView.setView(at,17);pickPin.setLatLng(at)}}catch(e){status(e.message)}};
// Map picker for places OpenStreetMap does not know. Centers on the first search hit, else the last stop.
let pickView=null,pickPin=null;
async function openPicker(){let L;try{L=await loadLeaflet()}catch(e){return status(e.message)}
$('picker').hidden=false;$('results').innerHTML='';
const st=S.current&&S.current.stops||[],last=st[st.length-1],first=searchTrusted?searchItems.find(it=>it.stop&&!it.stop.approx)||searchItems[0]:null;
const at=first?[first.stop.lat,first.stop.lng]:last?[last.lat,last.lng]:[25.0418,121.5435];
if(pickView){pickView.remove();pickView=null}
pickView=L.map($('pickMap'),{scrollWheelZoom:false}).setView(at,first||last?17:12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(pickView);
pickPin=L.marker(at,{draggable:true,icon:L.divIcon({className:'pick-pin',html:'<span></span>',iconSize:[28,28],iconAnchor:[14,28]})}).addTo(pickView);
pickView.on('click',e=>pickPin.setLatLng(e.latlng));
$('picker').scrollIntoView({block:'start'})}
function closePicker(){$('picker').hidden=true;if(pickView){pickView.remove();pickView=null}}
$('btnPick').onclick=openPicker;
$('btnPickCancel').onclick=closePicker;
$('btnPickAdd').onclick=async()=>{if(!pickPin)return;const p=pickPin.getLatLng(),q=searchQuery&&!Geocode.coords(searchQuery)&&!Geocode.parse(searchQuery)?clean(searchQuery):'';
closePicker();$('q').value='';searchQuery='';
await addStop({lat:+p.lat.toFixed(6),lng:+p.lng.toFixed(6),name:q||'地圖選點',renamed:!!q||undefined,time:new Date().toISOString(),manual:true});
status(q?`已加入「${q}」。按「存為常用」之後搜尋就找得到。`:'已加入。點名稱可以改名，按「存為常用」之後搜尋就找得到。')};
$('q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('btnSearch').click()}});
['setPayee','setEmp','setCar','setFuel'].forEach(id=>{$(id).addEventListener('input',readProfile);$(id).addEventListener('change',()=>{readProfile();render()})});
$('btnSetup').onclick=goSetup;
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
async function shareBlob(name,blob){const file=new File([blob],name,{type:blob.type||'application/vnd.ms-excel'});
if(isIOS()&&navigator.share){try{if(!navigator.canShare||navigator.canShare({files:[file]})){await navigator.share({files:[file],title:name});return 'shared'}}catch(e){if(e&&e.name==='AbortError')return 'abort'}}
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);return 'downloaded'}
function loadXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((ok,no)=>{const s=document.createElement('script');s.src='./vendor/xlsx.full.min.js';s.onload=()=>window.XLSX?ok(window.XLSX):no(new Error('報帳元件載入失敗'));s.onerror=()=>no(new Error('報帳元件載入失敗'));document.head.appendChild(s)})}
async function exportXls(){if(!S.trips.length)return status('沒有待報帳行程');
const miss=ExpenseSheet.missingProfile(S.settings.profile);if(miss.length){status('請先在設定填好'+miss.join('、'));goSetup();return}
status('產生報帳表…');
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
function stamp(){return todayISO().replace(/-/g,'')}
async function exportBackup(){readLiveForm();await save();
const body=JSON.stringify({app:'trip-mileage',version:1,exportedAt:new Date().toISOString(),data:{trips:S.trips,places:S.places,current:S.current,settings:S.settings}},null,1);
const how=await shareBlob(`出差里程備份-${stamp()}.json`,new Blob([body],{type:'application/json'}));
if(how==='abort')return status('已取消分享');
S.settings.lastBackup=new Date().toISOString();await save();renderBackup();status('備份已匯出。請存到「檔案」或雲端硬碟。')}
const num=v=>Number.isFinite(+v)?+v:0;
function okStop(s){return s&&typeof s==='object'&&Number.isFinite(+s.lat)&&Number.isFinite(+s.lng)}
function cleanStop(s){return Object.assign({},s,{lat:+s.lat,lng:+s.lng,name:String(s.name||'停靠點'),accuracy:s.accuracy==null?undefined:num(s.accuracy)})}
function cleanTrip(t){if(!t||typeof t!=='object'||!Array.isArray(t.stops))return null;
return Object.assign({},t,{id:num(t.id)||Date.now()+Math.random(),stops:t.stops.filter(okStop).map(cleanStop),total_km:num(t.total_km),freeway_km:num(t.freeway_km),ramp_km:num(t.ramp_km),
legs:(Array.isArray(t.legs)?t.legs:[]).map(l=>({from:String(l&&l.from||''),to:String(l&&l.to||''),km:num(l&&l.km),freeway_km:num(l&&l.freeway_km),ramp_km:num(l&&l.ramp_km)})),
roads:Array.isArray(t.roads)?t.roads.map(r=>({name:String(r&&r.name||''),ref:String(r&&r.ref||''),kind:r&&r.kind==='ramp'?'ramp':'freeway',km:num(r&&r.km)})):undefined,
polyline:Array.isArray(t.polyline)?t.polyline.filter(p=>Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1])).map(p=>[+p[0],+p[1]]):undefined})}
async function importBackup(file){let b;try{b=JSON.parse(await file.text())}catch(e){return status('這不是出差里程的備份檔')}
const d=b&&b.app==='trip-mileage'&&b.data;if(!d||!Array.isArray(d.trips))return status('這不是出差里程的備份檔');
const have=new Set(S.trips.map(t=>String(t.id)));
const trips=d.trips.map(cleanTrip).filter(t=>t&&!have.has(String(t.id)));
const key=p=>p.name+'|'+(+p.lat).toFixed(5)+'|'+(+p.lng).toFixed(5);
const known=new Set(S.places.map(key));
const places=(Array.isArray(d.places)?d.places:[]).filter(p=>okStop(p)&&p.name).map(p=>({name:clean(p.name),lat:+p.lat,lng:+p.lng})).filter(p=>p.name&&!known.has(key(p))&&known.add(key(p)));
const when=b.exportedAt?new Date(b.exportedAt).toLocaleString('zh-TW'):'不明時間';
if(!confirm(`備份時間：${when}\n會新增 ${trips.length} 筆待報帳行程、${places.length} 個常用地點。\n目前的資料都會保留，相同的行程不會重複。要匯入嗎？`))return status('已取消匯入');
S.trips=S.trips.concat(trips).sort((a,b)=>b.id-a.id);S.places=S.places.concat(places);
const mine=profile(),theirs=ExpenseSheet.profileOf(d.settings&&d.settings.profile),wasEmpty=ExpenseSheet.missingProfile(mine).length===3;
for(const k of ['payee','empId','carNo'])if(!mine[k]&&theirs[k])mine[k]=theirs[k];
if(wasEmpty)mine.fuel=theirs.fuel;S.settings.profile=mine;
let cur='';if(!S.current&&d.current&&Array.isArray(d.current.stops)&&d.current.stops.some(okStop)){S.current={stops:d.current.stops.filter(okStop).map(cleanStop),form:Object.assign(defaultForm(),d.current.form)};cur='，並還原進行中的行程'}
await save();render();status(`已匯入 ${trips.length} 筆行程、${places.length} 個地點${cur}`)}
function renderBackup(){const t=S.settings.lastBackup;$('backupInfo').textContent=t?'上次備份：'+new Date(t).toLocaleString('zh-TW'):'還沒有備份過。換手機或清除 Safari 資料前，記得先匯出備份。'}
$('btnBackup').onclick=()=>{exportBackup().catch(e=>status(e.message||'備份失敗'))};
$('btnRestore').onclick=()=>$('restoreFile').click();
$('restoreFile').onchange=async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(f)await importBackup(f)};
(async()=>{for(const k of Object.keys(S)){const v=await DB.get(k);if(v!==undefined&&v!==null)S[k]=v}
if(!Array.isArray(S.trips))S.trips=[];if(!Array.isArray(S.places))S.places=[];
if(!S.settings||typeof S.settings!=='object')S.settings={};
S.settings.profile=ExpenseSheet.profileOf(S.settings.profile);
if(S.current&&!Array.isArray(S.current.stops))S.current.stops=[];
if(S.current)S.current.form=Object.assign(defaultForm(),S.current.form);
if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});render();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{})})();

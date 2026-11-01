'use strict';
const $=id=>document.getElementById(id);
// ---- IndexedDB key/value store (with localStorage mirror as fallback) ----
const DB=(()=>{let p;const open=()=>p||(p=new Promise((ok,no)=>{const r=indexedDB.open('trip-mileage',1);
r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)}));
const tx=(m,f)=>open().then(d=>new Promise((ok,no)=>{const t=d.transaction('kv',m),q=f(t.objectStore('kv'));t.oncomplete=()=>ok(q&&q.result);t.onerror=()=>no(t.error)}));
return{get:async k=>{try{const v=await tx('readonly',s=>s.get(k));if(v!==undefined)return v}catch(e){}const l=localStorage.getItem(k);return l?JSON.parse(l):undefined},
set:async(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}try{await tx('readwrite',s=>s.put(v,k))}catch(e){}}}})();
let S={trips:[],places:[],current:null,settings:{rate:'',countRamps:false}};
const save=()=>Promise.all(['trips','places','current','settings'].map(k=>DB.set(k,S[k])));
const status=t=>$('status').textContent=t||'';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let busy=false;
function lock(){if(busy)return false;busy=true;return true}
function unlock(){busy=false}
// ---- Nominatim (≤1 req/s) ----
let lastNom=0;async function nom(path){const w=lastNom+1100-Date.now();if(w>0)await new Promise(r=>setTimeout(r,w));lastNom=Date.now();
const r=await fetch('https://nominatim.openstreetmap.org/'+path+'&format=jsonv2&accept-language=zh-TW');if(!r.ok)throw new Error('Nominatim '+r.status);return r.json()}
function shortName(j){const a=j.address||{};return j.name||[a.city||a.county,a.town||a.suburb||a.city_district,a.road].filter(Boolean).join('')||j.display_name}
function dist(a,b){const R=6371e3,t=x=>x*Math.PI/180,dl=t(b.lat-a.lat),dg=t(b.lng-a.lng);
const h=Math.sin(dl/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const nearPlace=p=>S.places.map(x=>[x,dist(x,p)]).filter(x=>x[1]<=300).sort((a,b)=>a[1]-b[1])[0]?.[0];
let pendingGeo=0;
function reverseGeocode(p){pendingGeo++;nom(`reverse?lat=${p.lat}&lon=${p.lng}&zoom=18`).then(async j=>{p.address=j.display_name;if(!p.renamed)p.name=shortName(j);await save();render()}).catch(()=>status('地址查詢失敗（仍已記錄座標）')).finally(()=>{pendingGeo--})}
function waitGeo(){if(!pendingGeo)return Promise.resolve();return new Promise(resolve=>{const start=Date.now();const tick=()=>pendingGeo&&Date.now()-start<8000?setTimeout(tick,80):resolve();tick()})}
async function addStop(p){const np=nearPlace(p);p.name=np?np.name:p.name;S.current.stops.push(p);await save();render();if(!np&&!p.address)reverseGeocode(p)}
function geoPoint(pos){return{lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:Math.round(pos.coords.accuracy),time:new Date().toISOString(),name:'定位點'}}
function geoError(e){return new Error('定位失敗：'+(e&&e.message||e)+'（需 HTTPS 並允許定位權限）')}
// Call directly from a click handler, before any await. iOS drops the user gesture after await.
function locate(){if(!navigator.geolocation)return Promise.reject(new Error('此瀏覽器不支援定位'));
const once=high=>new Promise((ok,no)=>{navigator.geolocation.getCurrentPosition(pos=>ok(geoPoint(pos)),no,{enableHighAccuracy:high,timeout:20000,maximumAge:high?0:15000})});
return once(true).catch(e=>{if(e&&e.code===1)throw geoError(e);return once(false).catch(e2=>{throw geoError(e2)})})}
async function recordHere(){if(!lock())return;const pending=locate();try{status('定位中…');const p=await pending;await addStop(p);status(`已記錄（誤差約 ${p.accuracy} m）`)}catch(e){status(e.message)}finally{unlock()}}
const routeStr=st=>st.map(s=>s.name).join(' > ');
const money=km=>{const rate=parseFloat(S.settings.rate);return S.settings.rate!==''&&Number.isFinite(rate)?Math.round(km*rate):null};
async function calc(){if(!S.current)return status('目前沒有進行中的行程');status('路線計算中…');await waitGeo();if(!S.current)return;const st=S.current.stops;if(!st||st.length<2)return status('至少需要兩個地點');status('路線計算中…');
try{if(typeof Routing==='undefined')throw new Error('路線模組未載入');
const r=await Routing.computeTrip(st,{countRamps:S.settings.countRamps});
const trip={id:Date.now(),date:new Date(st[0].time||Date.now()).toLocaleDateString('zh-TW'),stops:st,route:routeStr(st),total_km:r.total_km,freeway_km:r.freeway_km,ramp_km:r.ramp_km,legs:r.legs};
S.trips.unshift(trip);S.current=null;await save();status('');render();showResult(trip)}catch(e){status(e.message||'路線計算失敗')}}
function summary(t){const m=money(t.total_km);return `${t.date} ${t.route}\n總里程 ${t.total_km} km（國道 ${t.freeway_km} km）`+(m!=null?`\n油資 ${m} 元（${S.settings.rate} 元/km）`:'')+'\n'+t.legs.map(l=>`  ${l.from} → ${l.to}：${l.km} km（國道 ${l.freeway_km}）`).join('\n')}
function showResult(t){const m=money(t.total_km);$('result').innerHTML=`<h3>${esc(t.route)}</h3><table><tr><th>路段</th><th>km</th><th>國道</th></tr>`+
t.legs.map(l=>`<tr><td>${esc(l.from)} → ${esc(l.to)}</td><td>${l.km}</td><td>${l.freeway_km}</td></tr>`).join('')+
`<tr><th>合計</th><th>${t.total_km}</th><th>${t.freeway_km}</th></tr></table>`+(m!=null?`<p>油資：<b>${m}</b> 元</p>`:'')+
`<p class="sub">交流道/匝道 ${t.ramp_km} km ${S.settings.countRamps?'已':'未'}計入國道</p><button type="button" id="btnCopySum">複製報帳文字</button>`;
$('btnCopySum').onclick=()=>copySum(t.id)}
async function copySum(id){const t=S.trips.find(x=>String(x.id)===String(id));if(!t)return;const text=summary(t);try{await navigator.clipboard.writeText(text);status('已複製')}catch(e){prompt('請手動複製',text)}}
function render(){const c=S.current;$('tripIdle').hidden=!!c;$('tripActive').hidden=!c;
$('stops').innerHTML=c?c.stops.map((s,i)=>`<li><b>${esc(s.name)}</b> <span class="sub">${s.time?new Date(s.time).toLocaleTimeString('zh-TW'):''} ${s.accuracy?'±'+s.accuracy+'m':''}<br>${esc(s.address||'')}</span><br>
<button type="button" class="mini" data-a="ren" data-i="${i}">改名</button><button type="button" class="mini" data-a="up" data-i="${i}">↑</button><button type="button" class="mini" data-a="down" data-i="${i}">↓</button>
<button type="button" class="mini" data-a="fav" data-i="${i}">存為常用</button><button type="button" class="mini danger" data-a="del" data-i="${i}">刪除</button></li>`).join(''):'';
$('history').innerHTML=S.trips.map(t=>{const m=money(t.total_km);return `<li><b>${esc(t.date)}</b> ${esc(t.route)}<br>總 ${t.total_km} km／國道 ${t.freeway_km} km${m!=null?'／'+m+' 元':''}<br>
<button type="button" class="mini" data-act="detail" data-h="${esc(t.id)}">明細</button><button type="button" class="mini" data-act="copy" data-h="${esc(t.id)}">複製</button><button type="button" class="mini danger" data-act="del" data-h="${esc(t.id)}">刪除</button></li>`}).join('')||'<li class="sub">尚無紀錄</li>';
$('places').innerHTML=S.places.map((p,i)=>`<li>${esc(p.name)} <span class="sub">${p.lat.toFixed(4)},${p.lng.toFixed(4)}</span> <button type="button" class="mini danger" data-p="${i}">刪除</button></li>`).join('')||'<li class="sub">在行程中按「存為常用」新增（300 m 內自動套用名稱）</li>';
$('rate').value=S.settings.rate??'';$('countRamps').checked=!!S.settings.countRamps}
$('stops').onclick=async e=>{const b=e.target.dataset;if(!b.a||!S.current)return;const st=S.current.stops,i=+b.i;if(!st[i])return;
if(b.a==='ren'){const n=prompt('名稱',st[i].name);if(n){st[i].name=n;st[i].renamed=true}}
if(b.a==='del'&&confirm('刪除這個點？'))st.splice(i,1);
if(b.a==='up'&&i>0)[st[i-1],st[i]]=[st[i],st[i-1]];
if(b.a==='down'&&i<st.length-1)[st[i+1],st[i]]=[st[i],st[i+1]];
if(b.a==='fav'){const n=prompt('常用地點名稱',st[i].name);if(n){S.places.push({name:n,lat:st[i].lat,lng:st[i].lng});st[i].name=n}}
await save();render()};
$('history').onclick=async e=>{const btn=e.target.closest('button');if(!btn||!$('history').contains(btn))return;const id=btn.dataset.h,act=btn.dataset.act;if(!act)return;
if(act==='detail'){const t=S.trips.find(x=>String(x.id)===id);if(t)showResult(t)}
if(act==='copy')copySum(id);
if(act==='del'&&confirm('刪除此行程？')){S.trips=S.trips.filter(t=>String(t.id)!==id);await save();render()}};
$('places').onclick=async e=>{const i=e.target.dataset.p;if(i!==undefined){S.places.splice(+i,1);await save();render()}};
$('btnStart').onclick=async()=>{if(!lock())return;const pending=locate();try{S.current={stops:[]};$('result').innerHTML='';await save();render();status('定位中…');const p=await pending;await addStop(p);status(`已記錄（誤差約 ${p.accuracy} m）`)}catch(e){status(e.message)}finally{unlock()}};
$('btnHere').onclick=recordHere;
$('btnEnd').onclick=async()=>{if(!lock())return;const pending=locate();status('定位中…');try{await addStop(await pending);await calc()}catch(e){status(e.message)}finally{unlock()}};
$('btnCalc').onclick=async()=>{if(!lock())return;try{await calc()}finally{unlock()}};
$('btnCancel').onclick=async()=>{if(confirm('放棄目前行程？')){S.current=null;$('result').innerHTML='';await save();render()}};
$('btnSearch').onclick=async()=>{const q=$('q').value.trim();if(!q)return;status('搜尋中…');
try{const r=await nom(`search?q=${encodeURIComponent(q)}&countrycodes=tw&limit=5&addressdetails=1`);status(r.length?'':'找不到');
$('results').innerHTML=r.map((x,i)=>`<li><button type="button" class="mini" data-r="${i}">加入</button> ${esc(x.display_name)}</li>`).join('');
$('results').onclick=async e=>{const x=r[e.target.dataset.r];if(!x)return;$('results').innerHTML='';$('q').value='';
await addStop({lat:+x.lat,lng:+x.lon,name:shortName(x),address:x.display_name,time:new Date().toISOString(),manual:true})}}catch(e){status(e.message)}};
$('rate').onchange=e=>{S.settings.rate=e.target.value;save();render()};
$('countRamps').onchange=e=>{S.settings.countRamps=e.target.checked;save()};
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
async function download(name,text,type){const blob=new Blob([text],{type}),file=new File([blob],name,{type});
if(isIOS()&&navigator.share){try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:name});return}}catch(e){if(e&&e.name==='AbortError')return}
try{await navigator.share({title:name,text});return}catch(e){if(e&&e.name==='AbortError')return}}
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
$('btnCsv').onclick=()=>{const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
const rows=[['日期','路線','總公里','國道公里','交流道公里','油資(元)']].concat(S.trips.map(t=>[t.date,t.route,t.total_km,t.freeway_km,t.ramp_km,money(t.total_km)??'']));
download('出差里程.csv','\uFEFF'+rows.map(r=>r.map(q).join(',')).join('\r\n'),'text/csv;charset=utf-8').catch(e=>status(e.message||'匯出失敗'))};
$('btnJson').onclick=()=>download('出差里程備份.json',JSON.stringify({trips:S.trips,places:S.places,settings:S.settings},null,1),'application/json').catch(e=>status(e.message||'匯出失敗'));
$('fileImport').onchange=async e=>{try{const file=e.target.files&&e.target.files[0];if(!file)return;const d=JSON.parse(await file.text());const ids=new Set(S.trips.map(t=>t.id));
S.trips=S.trips.concat((d.trips||[]).filter(t=>t&&!ids.has(t.id))).sort((a,b)=>b.id-a.id);S.places=S.places.concat(d.places||[]);await save();render();status('匯入完成')}catch(x){status('匯入失敗')}finally{e.target.value=''}};
(async()=>{for(const k of Object.keys(S)){const v=await DB.get(k);if(v!==undefined&&v!==null)S[k]=v}
if(!Array.isArray(S.trips))S.trips=[];if(!Array.isArray(S.places))S.places=[];
if(!S.settings||typeof S.settings!=='object')S.settings={rate:'',countRamps:false};
if(S.current&&!Array.isArray(S.current.stops))S.current.stops=[];
if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});render();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{})})();

const codes={"bra.1":"Brasileirão Série A","bra.2":"Brasileirão Série B","bra.3":"Brasileirão Série C (se disponível)","bra.4":"Brasileirão Série D (se disponível)","bra.copa_do_brazil":"Copa do Brasil (se disponível)","bra.camp.paulista":"Paulistão (se disponível)","bra.camp.carioca":"Carioca (se disponível)","bra.camp.gaucho":"Gauchão (se disponível)","bra.camp.mineiro":"Mineiro (se disponível)","bra.camp.paranaense":"Paranaense (se disponível)","conmebol.libertadores":"Libertadores","conmebol.sudamericana":"Sul-Americana","eng.1":"Premier League","esp.1":"La Liga","ita.1":"Serie A Itália","ger.1":"Bundesliga","fra.1":"Ligue 1","uefa.champions":"Champions League","uefa.europa":"Europa League","uefa.europa.conf":"Conference League","eng.2":"Championship","eng.3":"League One","eng.4":"League Two","esp.2":"La Liga 2","ita.2":"Serie B Itália","ger.2":"Bundesliga 2","fra.2":"Ligue 2","por.1":"Portugal","ned.1":"Holanda","usa.1":"MLS","arg.1":"Argentina","mex.1":"México","col.1":"Colômbia","uru.1":"Uruguai","chi.1":"Chile","per.1":"Peru","ecu.1":"Equador","par.1":"Paraguai","bol.1":"Bolívia","ven.1":"Venezuela","jpn.1":"Japão","fifa.world":"Copa do Mundo"};
const $=id=>document.getElementById(id);let selected=new Date(),tab='all',items=[],failed=[],lastUpdate='',req=0,installPrompt=null;selected.setHours(12,0,0,0);let previousScores=new Map(),hasSnapshot=false,alertsEnabled=localStorage.getItem("vcs-alerts")==="yes";let favs=new Set(JSON.parse(localStorage.getItem('vcs-favs')||'[]'));
for(const [k,v] of Object.entries(codes))$('league').add(new Option(v,k));
const dateStr=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeText=m=>{if(m.status==='in')return m.detail||'AO VIVO';if(m.status==='post')return 'Encerrado';return new Date(m.date).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})};

// Cronômetro visual: sincroniza com o minuto da fonte e anima segundos localmente.
// A ESPN geralmente informa apenas minutos, portanto os segundos são estimados.
const runningClocks=new Map();
function readLiveClock(m){
 const raw=String(m.detail||'').trim();
 if(m.status==='post')return {label:'FIM DE JOGO',running:false};
 if(m.status!=='in')return {label:new Date(m.date).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),running:false};
 if(/intervalo|half.?time|\bht\b|meio.?tempo/i.test(raw))return {label:'INTERVALO',running:false};
 if(/suspens|adiad|paralis|postponed|delayed|pause|abandon/i.test(raw))return {label:raw||'PAUSADO',running:false};
 const plus=raw.match(/(?:^|\D)(\d{1,3})\s*\+\s*(\d{1,2})\s*['’′]?/);
 if(plus)return {seconds:(+plus[1]+ +plus[2])*60,running:true,extra:true,base:+plus[1]};
 const exact=raw.match(/(?:^|\D)(\d{1,3}):([0-5]\d)(?!\d)/);
 if(exact)return {seconds:+exact[1]*60+ +exact[2],running:true};
 const minute=raw.match(/(?:^|\D)(\d{1,3})\s*['’′]/) || raw.match(/(?:^|\D)(\d{1,3})\s*(?:min|minute)/i);
 if(minute)return {seconds:+minute[1]*60,running:true};
 return {label:raw||'AO VIVO',running:false};
}
function syncClocks(matches){
 const now=Date.now();
 for(const m of matches){
  const incoming=readLiveClock(m);
  if(!incoming.running){runningClocks.delete(m.id);continue}
  const old=runningClocks.get(m.id);
  if(old&&old.extra===Boolean(incoming.extra)&&old.base===(incoming.base||0)){
   const elapsed=Math.min(75,Math.max(0,(now-old.at)/1000));
   const estimated=old.seconds+elapsed;
   // Não retrocede quando a fonte repete o minuto anterior.
   if(incoming.seconds<=estimated && incoming.seconds+90>=estimated)continue;
  }
  runningClocks.set(m.id,{seconds:incoming.seconds,at:now,extra:Boolean(incoming.extra),base:incoming.base||0});
 }
}
function matchClock(m){
 const incoming=readLiveClock(m);
 if(!incoming.running)return incoming.label;
 const clock=runningClocks.get(m.id);
 if(!clock)return 'AO VIVO';
 // Limite de 75 s até nova confirmação da fonte para evitar relógio fictício ilimitado.
 const elapsed=Math.min(75,Math.max(0,Math.floor((Date.now()-clock.at)/1000)));
 const sec=Math.floor(clock.seconds+elapsed);
 if(clock.extra){
  const extra=sec-clock.base*60;
  return `${clock.base}+${Math.floor(extra/60)}:${String(extra%60).padStart(2,'0')}`;
 }
 return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
}
function tickClocks(){
 if(document.hidden)return;
 document.querySelectorAll('[data-game]').forEach(row=>{
  const m=items.find(v=>v.id===row.dataset.game);
  const display=row.querySelector('.vc-clock');
  if(m&&display&&m.status==='in')display.textContent=matchClock(m);
 });
}
const teamCard=t=>`<div class="vc-team">${t.logo?`<img loading="lazy" src="${escapeHtml(t.logo)}" alt="" onerror="this.style.display='none'">`:`<span class="vc-team-fallback">⚽</span>`}<span class="vc-team-name">${escapeHtml(t.name)}</span></div>`;
function show(){
 const league=$('league').value;
 $('dateLabel').textContent=selected.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).replace('.','');
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('selected',b.dataset.nav===tab));
 const filtered=items.filter(m=>league==='all'||league===m.league);
 $('countAll').textContent=filtered.length;$('countLive').textContent=filtered.filter(m=>m.status==='in').length;
 const visible=filtered.filter(m=>tab==='all'||(tab==='favorites'?favs.has(m.id):m.status===tab));
 const el=$('matches');
 if(!visible.length){el.innerHTML=`<div class="empty">⚽<strong>${tab==='favorites'?'Nenhum favorito nesta data':'Nenhuma partida encontrada'}</strong>${failed.length?'Algumas fontes falharam. Tente atualizar.':'Escolha outra data, campeonato ou filtro.'}</div>`;return}
 const grouped=visible.reduce((a,m)=>((a[m.league]??=[]).push(m),a),{});
 el.innerHTML=Object.entries(grouped).map(([code,ms])=>`<section class="leaguegroup"><div class="leaguehead">${escapeHtml(codes[code]||code)}<span class="leaguecount">${ms.length} jogo${ms.length===1?'':'s'}</span></div>${ms.map(m=>`<div class="match match-center ${m.status==='in'?'live':''}" data-game="${escapeHtml(m.id)}" role="button" tabindex="0" aria-label="${escapeHtml(m.home.name)} ${m.home.score??'sem placar'} a ${m.away.score??'sem placar'} ${escapeHtml(m.away.name)}" title="Ver detalhes da partida"><div class="vc-status ${m.status==='in'?'vc-on':m.status==='post'?'vc-finished':'vc-scheduled'}">${m.status==='in'?'<span class="vc-live-dot"></span> AO VIVO':m.status==='post'?'ENCERRADO':'PROGRAMADO'}</div><div class="vc-main">${teamCard(m.home)}<div class="vc-score"><span>${escapeHtml(m.home.score??'–')}</span><span class="vc-times">×</span><span>${escapeHtml(m.away.score??'–')}</span></div>${teamCard(m.away)}</div><div class="vc-bottom"><span class="vc-clock">${escapeHtml(matchClock(m))}</span><button class="star ${favs.has(m.id)?'on':''}" data-fav="${escapeHtml(m.id)}" aria-label="${favs.has(m.id)?'Remover favorito':'Favoritar partida'}">${favs.has(m.id)?'★':'☆'}</button></div></div>`).join('')}</section>`).join('');
 el.querySelectorAll('[data-game]').forEach(row=>{row.onclick=e=>{if(e.target.closest('[data-fav]'))return;openMatch(row.dataset.game)};row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMatch(row.dataset.game)}}});
 el.querySelectorAll('[data-fav]').forEach(b=>b.onclick=()=>{const id=b.dataset.fav;favs.has(id)?favs.delete(id):favs.add(id);localStorage.setItem('vcs-favs',JSON.stringify([...favs]));syncPushFavorites();show()});
}
async function load(){const id=++req;$('status').textContent='Buscando placares reais…';try{const res=await fetch(`/api/scores?date=${dateStr(selected)}`,{cache:'no-store'});if(!res.ok)throw Error('Serviço indisponível');const data=await res.json();if(id!==req)return;items=data.matches||[];syncClocks(items);checkAlerts(items);failed=data.errors||[];lastUpdate=data.updatedAt;const t=new Date(lastUpdate).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});$('status').textContent=`Fonte: ESPN • atualizado às ${t} • ${items.length} jogos${failed.length?' • '+failed.length+' fontes indisponíveis':''}`;show()}catch(e){if(id!==req)return;items=[];failed=['erro'];$('status').textContent='Não foi possível acessar a fonte de resultados. Confira sua conexão e o servidor.';show()}}
$('today').onclick=()=>{selected=new Date();selected.setHours(12,0,0,0);load()};$('prev').onclick=()=>{selected.setDate(selected.getDate()-1);load()};$('next').onclick=()=>{selected.setDate(selected.getDate()+1);load()};$('refresh').onclick=()=>activeSport==='futsal'?loadFgfsGames():load();$('league').onchange=show;document.querySelectorAll('[data-tab],[data-nav]').forEach(b=>b.onclick=()=>{if(activeSport==='futsal'){futsalTab=b.dataset.tab||b.dataset.nav;renderFgfsGames()}else{tab=b.dataset.tab||b.dataset.nav;show()}});window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false});$('install').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install').hidden=true}};if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});load();setInterval(tickClocks,1000);setInterval(()=>{if(!document.hidden)load()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});

const modal=$('details'),content=$('detailContent');
function statValue(stats,names){const s=stats.find(x=>names.includes(x.name.toLowerCase()));return s?.value||'—'}
async function openMatch(key){const match=items.find(x=>x.id===key);if(!match)return;modal.hidden=false;content.innerHTML='<p>Carregando eventos e estatísticas…</p>';$('detailTitle').textContent=match.home.name+' × '+match.away.name;const [league,id]=key.split(':');try{const r=await fetch(`/api/match?league=${encodeURIComponent(league)}&id=${encodeURIComponent(id)}`);const j=await r.json();if(!r.ok)throw Error(j.error||'Sem detalhes');let evs=j.events||[];content.innerHTML=`<p class="source-note">${escapeHtml(match.leagueName)} • ${escapeHtml(match.detail)} • ${escapeHtml(j.note||'')}</p><h3>⚽ Eventos da partida</h3>${evs.length?evs.map(e=>`<div class="eventline"><strong>${escapeHtml(e.minute)}</strong><span>${escapeHtml(e.text)}</span></div>`).join(''):'<p class="muted">A fonte não disponibiliza eventos para esta partida.</p>'}<h3>📊 Estatísticas</h3>${(j.statistics||[]).length?j.statistics.map(x=>`<div class="statsblock"><b>${escapeHtml(x.team)}</b>${x.stats.length?x.stats.map(v=>`<div class="statline"><span>${escapeHtml(v.name)}</span><strong>${escapeHtml(v.value)}</strong></div>`).join(''):'<p class="muted">Sem números detalhados.</p>'}</div>`).join(''):'<p class="muted">Sem estatísticas disponíveis nesta fonte.</p>'}`;}catch(e){content.innerHTML=`<p class="muted">${escapeHtml(e.message)}. Os dados da partida continuam no placar.</p>`}}
$('closeDetails').onclick=()=>modal.hidden=true;modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true});
$('standingsBtn').onclick=async()=>{modal.hidden=false;$('detailTitle').textContent='🏆 Classificação';content.innerHTML='<p>Carregando classificação…</p>';let league=$('league').value;if(league==='all')league='bra.1';try{const r=await fetch('/api/standings?league='+encodeURIComponent(league));const j=await r.json();if(!r.ok)throw Error(j.error||'Sem tabela');content.innerHTML=`<p class="source-note">${escapeHtml(codes[league])} • Fonte: ESPN</p>${j.rows?.length?`<div class="standings">${j.rows.map((x,i)=>`<div class="standingrow"><strong>${i+1}</strong><span>${escapeHtml(x.team)}</span><small>${escapeHtml(statValue(x.stats,['points','point','pts']))} pts</small></div>`).join('')}</div>`:'<p class="muted">A fonte não disponibiliza classificação para esta competição. Selecione outra liga.</p>'}`}catch(e){content.innerHTML='<p class="muted">'+escapeHtml(e.message)+'</p>'}};
function urlBase64ToUint8Array(base64){const padding='='.repeat((4-base64.length%4)%4);const raw=atob((base64+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
async function syncPushFavorites(){try{const reg=await navigator.serviceWorker.ready;const subscription=await reg.pushManager.getSubscription();if(!subscription)return;await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription,favorites:[...favs]})})}catch(e){console.warn('Falha ao sincronizar favoritos',e)}}
async function requestAlerts(){try{if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('Seu navegador não suporta Web Push');const config=await(await fetch('/api/push/key')).json();if(!config.enabled)throw Error('Configure as chaves VAPID no Render primeiro');const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Permissão de notificações não concedida');const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(config.publicKey)});const response=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub,favorites:[...favs]})});if(!response.ok)throw Error('Falha ao registrar notificações no servidor');alertsEnabled=true;localStorage.setItem('vcs-alerts','yes');$('alertsBtn').innerHTML='<span class="btnicon notifimg"><img src="/notification-icon.png" alt=""></span><span>Web Push ativo</span>'; alert('Web Push ativado! Marque partidas com ★ para receber alertas de gols, inclusive com o app fechado, enquanto o servidor estiver ativo.')}catch(e){alert('Não foi possível ativar Web Push: '+e.message)}}
$('alertsBtn').onclick=requestAlerts;$('alertsBtn').innerHTML=alertsEnabled?'<span class="btnicon notifimg"><img src="/notification-icon.png" alt=""></span><span>Web Push ativo</span>':'<span class="btnicon notifimg"><img src="/notification-icon.png" alt=""></span><span>Ativar Web Push</span>';
function checkAlerts(matches){const next=new Map(matches.map(x=>[x.id,x]));if(false&&hasSnapshot&&alertsEnabled&&'Notification'in window&&Notification.permission==='granted'){for(const m of matches){if(!favs.has(m.id))continue;const old=previousScores.get(m.id);if(!old||m.status!=='in')continue;for(const side of ['home','away']){const prev=Number(old[side]?.score),now=Number(m[side]?.score);if(Number.isFinite(prev)&&Number.isFinite(now)&&now>prev){const msg=`${m.home.name} ${m.home.score} × ${m.away.score} ${m.away.name}`;try{new Notification('⚽ GOL! '+m[side].name,{body:msg,icon:'/icon-192.png',tag:m.id+'-'+side+'-'+now})}catch(e){}}}}}previousScores=next;hasSnapshot=true}

// VC Sports 2.0: modos separados. Não altera os dados do futebol.
let activeSport='football';
function setSport(next){
 activeSport=next;
 $('footballPanel').hidden=next!=='football';$('futsalPanel').hidden=next!=='futsal';
 document.querySelector('.nav').hidden=false;
 $('switchFootball').classList.toggle('selected',next==='football');
 $('switchFutsal').classList.toggle('selected',next==='futsal');
 $('switchFootball').setAttribute('aria-selected',String(next==='football'));
 $('switchFutsal').setAttribute('aria-selected',String(next==='futsal'));
 document.querySelector('#refresh').hidden=false;if(next==='football')show();
 localStorage.setItem('vcs-sport',next);
}
$('switchFootball').onclick=()=>setSport('football');
$('switchFutsal').onclick=()=>{setSport('futsal');renderFgfsGames()};
setSport(localStorage.getItem('vcs-sport')==='futsal'?'futsal':'football');


// VC Sports 2.1 - catálogo de competições reais de futsal.
let futsalCompetitions=[];
async function loadFutsalCatalog(){
 try{
  const response=await fetch('/futsal-competicoes.json');
  if(!response.ok)throw Error('Catálogo indisponível');
  futsalCompetitions=await response.json();renderFutsalCatalog();
 }catch(e){$('futsalSummary').textContent='Não foi possível carregar as competições.';}
}
function renderFutsalCatalog(){
 const region=$('futsalRegion').value;
 const term=$('futsalSearch').value.trim().toLocaleLowerCase('pt-BR');
 const result=futsalCompetitions.filter(c=>(region==='all'||c.region===region)&&`${c.name} ${c.organizer} ${c.description}`.toLocaleLowerCase('pt-BR').includes(term));
 $('futsalSummary').textContent=`${result.length} competições cadastradas • calendário oficial disponível nas fontes`;
 $('futsalCompetitions').innerHTML=result.map(c=>`<article class="futsal-competition"><small>${escapeHtml(c.region.toUpperCase())} • ${escapeHtml(c.group.toUpperCase())}</small><h2>🥅 ${escapeHtml(c.name)}</h2><p>${escapeHtml(c.description)}</p><p class="futsal-organizer">Organização: ${escapeHtml(c.organizer)}</p><div class="futsal-source-status">◌ Resultados automáticos ainda não integrados</div><a href="${escapeHtml(c.official)}" target="_blank" rel="noopener noreferrer" aria-label="Consultar fonte oficial de ${escapeHtml(c.name)}">Fonte oficial ↗</a></article>`).join('')||'<p class="futsal-noresults">Nenhuma competição encontrada neste filtro.</p>';
}
$('futsalRegion').addEventListener('change',renderFutsalCatalog);
$('futsalSearch').addEventListener('input',renderFutsalCatalog);
loadFutsalCatalog();


// Resultados reais publicados na FGFS. Nenhum status "ao vivo" é inferido de um placar.
let fgfsResponse=null;
async function loadFgfsGames(){
 const panel=$('futsalResults');panel.textContent='Consultando fontes oficiais…';
 try{const response=await fetch('/api/futsal/fgfs',{cache:'no-store'});if(!response.ok)throw Error('Fonte indisponível');fgfsResponse=await response.json();renderFgfsGames()}
 catch(e){panel.innerHTML='<p>Não foi possível consultar a FGFS agora. Os links oficiais das competições continuam disponíveis abaixo.</p>'}
}
// Mesmas classes CSS e a mesma composição visual dos jogos de futebol.
let futsalTab='all';
let futsalSelected=new Date(); futsalSelected.setHours(12,0,0,0);
let futsalAllDates=false;
const futsalFavorites=new Set(JSON.parse(localStorage.getItem('vcs-futsal-favs')||'[]'));
function futsalKey(m){return [m.date,m.home,m.away].join('|')}
function futsalInitials(name){const terms=String(name||'').replace(/[^\p{L}\p{N} ]/gu,' ').split(/\s+/).filter(Boolean);return (terms.length>1?terms[0][0]+terms[1][0]:(terms[0]||'FC').slice(0,2)).toUpperCase()}
function futsalTeamCard(name){return `<div class="vc-team"><span class="vc-team-fallback futsal-initials" aria-label="Escudo não disponível">${escapeHtml(futsalInitials(name))}</span><span class="vc-team-name">${escapeHtml(name)}</span></div>`}
function renderFgfsGames(){
 const panel=$('futsalResults');if(!fgfsResponse)return;
 const date=futsalSelected.getFullYear()+'-'+String(futsalSelected.getMonth()+1).padStart(2,'0')+'-'+String(futsalSelected.getDate()).padStart(2,'0');
 $('futsalDateLabel').textContent=futsalAllDates?'Todas as datas':futsalSelected.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).replace('.','');
 document.querySelectorAll('[data-futsal-tab]').forEach(el=>el.classList.toggle('active',el.dataset.futsalTab===futsalTab));
 if(activeSport==='futsal')document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('selected',el.dataset.nav===futsalTab));
 const all=Array.isArray(fgfsResponse.matches)?fgfsResponse.matches:[];
 const base=all.filter(m=>(futsalAllDates||m.date===date)&&$('futsalLeague').value==='all'||((futsalAllDates||m.date===date)&&$('futsalLeague').value==='FGFS'));
 // A FGFS fornece jogo programado e placar publicado, mas não confirma status em tempo real.
 const visible=base.filter(m=>futsalTab==='all'||(futsalTab==='favorites'?futsalFavorites.has(futsalKey(m)):futsalTab==='post'?m.played:false));
 $('futsalCountAll').textContent=base.length;
 $('futsalCountLive').textContent='0';
 $('futsalStatus').textContent=`FGFS • ${fgfsResponse.sourcesOk||0}/${fgfsResponse.sourcesTotal||0} fontes • ${visible.length} partidas${futsalTab==='in'?' • sem dados ao vivo':''}`;
 if(!visible.length){panel.innerHTML=`<div class="empty">🥅<strong>${futsalTab==='in'?'Sem partidas ao vivo confirmadas':futsalTab==='favorites'?'Nenhum favorito nesta data':'Nenhuma partida encontrada'}</strong>${futsalTab==='in'?'A FGFS não informa status em tempo real nessa consulta.':'Escolha outra data ou toque em Ver todas as datas.'}</div>`;return}
 const displayed=visible.slice(0,futsalAllDates?80:120);
 const groups=new Map();for(const m of displayed){const key=m.date||'Sem data';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m)}
 panel.innerHTML=[...groups].map(([day,ms])=>{
 const label=/^\d{4}-\d\d-\d\d$/.test(day)?day.split('-').reverse().join('/'):day;
 return `<section class="leaguegroup"><div class="leaguehead">🥅 Futsal Gaúcho • ${escapeHtml(label)}<span class="leaguecount">${ms.length} jogo${ms.length===1?'':'s'}</span></div>${ms.map(m=>{
 const id=futsalKey(m),favorited=futsalFavorites.has(id);
 const score=m.played?[m.homeScore,m.awayScore]:['–','–'];
 return `<div class="match match-center futsal-unified" data-futsal-game="${escapeHtml(id)}" role="button" tabindex="0" title="Ver fonte oficial da partida"><div class="vc-status ${m.played?'vc-finished':'vc-scheduled'}">${m.played?'RESULTADO PUBLICADO':'PROGRAMADO'}</div><div class="vc-main">${futsalTeamCard(m.home)}<div class="vc-score"><span>${escapeHtml(score[0]??'–')}</span><span class="vc-times">×</span><span>${escapeHtml(score[1]??'–')}</span></div>${futsalTeamCard(m.away)}</div><div class="vc-bottom"><span class="vc-clock">${escapeHtml(label)}</span><button class="star ${favorited?'on':''}" data-futsal-fav="${escapeHtml(id)}" aria-label="${favorited?'Remover favorito':'Favoritar partida'}">${favorited?'★':'☆'}</button></div></div>`
 }).join('')}</section>`}).join('')+(visible.length>displayed.length?'<p class="futsal-more">Escolha uma data para visualizar mais partidas.</p>':'');
 panel.querySelectorAll('[data-futsal-fav]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.futsalFav;futsalFavorites.has(id)?futsalFavorites.delete(id):futsalFavorites.add(id);localStorage.setItem('vcs-futsal-favs',JSON.stringify([...futsalFavorites]));renderFgfsGames()});
 panel.querySelectorAll('[data-futsal-game]').forEach(card=>{const open=e=>{if(e.target.closest('[data-futsal-fav]'))return;const game=all.find(m=>futsalKey(m)===card.dataset.futsalGame);if(game?.sourceUrl){$('details').hidden=false;$('detailTitle').textContent=game.home+' × '+game.away;$('detailContent').innerHTML=`<p>Data: ${escapeHtml(game.date||'Não informada')}</p><p>${game.played?'Resultado publicado na FGFS.':'Placar ainda não publicado pela FGFS.'}</p><p><a href="${escapeHtml(game.sourceUrl)}" target="_blank" rel="noopener noreferrer">Consultar fonte oficial ↗</a></p>`}};card.onclick=open;card.onkeydown=e=>{if(e.key==='Enter'){open(e)}}});
}
$('reloadFutsal').onclick=loadFgfsGames;
$('futsalPrev').onclick=()=>{futsalAllDates=false;futsalSelected.setDate(futsalSelected.getDate()-1);renderFgfsGames()};
$('futsalNext').onclick=()=>{futsalAllDates=false;futsalSelected.setDate(futsalSelected.getDate()+1);renderFgfsGames()};
$('futsalToday').onclick=()=>{futsalAllDates=false;futsalSelected=new Date();renderFgfsGames()};
$('futsalAllDates').onclick=()=>{futsalAllDates=!futsalAllDates;$('futsalAllDates').textContent=futsalAllDates?'Escolher por dia':'Ver todas as datas';renderFgfsGames()};
$('futsalLeague').onchange=renderFgfsGames;
document.querySelectorAll('[data-futsal-tab]').forEach(el=>el.onclick=()=>{futsalTab=el.dataset.futsalTab;renderFgfsGames()});
loadFgfsGames();

// Home page behaviour. Extracted from the supplied design; all listeners are tracked so the router can unmount cleanly.
import { loadLive } from "./home-data.js";
export async function mount(root){
  const res=await fetch("/assets/views/home.html"); root.innerHTML=await res.text();
  const __ls=[],__iv=[];
  const addEventListener=(t,f,o)=>{window.addEventListener(t,f,o);__ls.push([t,f,o])};
  const setInterval=(f,t)=>{const i=window.setInterval(f,t);__iv.push(i);return i};

// ---- Live data (Supabase). Nothing here is demo content. ----
var LIVE=await loadLive();
var CONFIG={start:LIVE.start,game:LIVE.game,mode:LIVE.mode,telegram:LIVE.telegram,instagram:LIVE.instagram,admin:LIVE.admin,notice:LIVE.notice,
  split:LIVE.split,cut:LIVE.cut,modes:LIVE.modes,matches:LIVE.matches,winners:LIVE.winners,leaderboard:LIVE.leaderboard};
// ----------------------------------
document.getElementById("g").textContent=CONFIG.game;
document.getElementById("when").textContent=!CONFIG.start?"Abhi koi tournament schedule nahi hai":"Start: "+CONFIG.start.toLocaleString("en-IN",{weekday:"long",day:"numeric",month:"long",hour:"numeric",minute:"2-digit",timeZone:"Asia/Kolkata"})+" IST";
function pad(n){return String(n).padStart(2,"0")}
function tick(){
  if(!CONFIG.start){["d","h","m","s"].forEach(function(i){document.getElementById(i).textContent="--"});return}
  var diff=Math.max(0,CONFIG.start-new Date());
  if(!diff){var tt=document.getElementById("t");if(!tt.dataset.live){tt.dataset.live=1;tt.innerHTML='<b class="live">MATCH LIVE</b>'}return}
  document.getElementById("d").textContent=pad(Math.floor(diff/864e5));
  document.getElementById("h").textContent=pad(Math.floor(diff/36e5)%24);
  document.getElementById("m").textContent=pad(Math.floor(diff/6e4)%60);
  document.getElementById("s").textContent=pad(Math.floor(diff/1e3)%60);
}
tick();setInterval(tick,1000);
if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&matchMedia("(hover:hover)").matches){
  document.querySelectorAll(".match,.cell,.pay").forEach(function(el){
    el.addEventListener("pointermove",function(e){var r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;el.style.transform="perspective(900px) rotateY("+(x*10)+"deg) rotateX("+(-y*10)+"deg) translateZ(6px)"});
    el.addEventListener("pointerleave",function(){el.style.transform=""});
  });
}
var __sl=document.getElementById("slotline"),__bar=document.querySelector(".slots i");
(function(){var mm=CONFIG.matches.filter(function(m){return m.mode===CONFIG.mode})[0];if(!__sl)return;
if(!mm){__sl.textContent="Slots: —";if(__bar)__bar.style.width="0%";return}
var q=mm.slots.split("/"),mdef=CONFIG.modes.filter(function(k){return k.name===CONFIG.mode})[0];
__sl.textContent="Slots bhar rahe hain: "+q[0]+" / "+q[1]+" "+(mdef?mdef.unit:"");if(__bar&&+q[1])__bar.style.width=Math.min(100,Math.round(q[0]/q[1]*100))+"%"})();
["tg","tg2","tg3","fab"].forEach(function(i){document.getElementById(i).href=CONFIG.telegram});
(function(){var c=document.getElementById("em");if(!c||matchMedia("(prefers-reduced-motion: reduce)").matches)return;var x=c.getContext("2d"),W,H,P=[];function rs(){W=c.width=c.offsetWidth;H=c.height=c.offsetHeight}rs();addEventListener("resize",rs);
for(var i=0;i<45;i++)P.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2+.6,v:Math.random()*.6+.25,d:Math.random()*6});
function f(){x.clearRect(0,0,W,H);P.forEach(function(p){p.y-=p.v;p.x+=Math.sin((p.y+p.d*50)/40)*.4;if(p.y<-5){p.y=H+5;p.x=Math.random()*W}x.beginPath();x.arc(p.x,p.y,p.r,0,7);x.fillStyle="rgba(90,170,255,"+(.35+p.r/6)+")";x.fill()});requestAnimationFrame(f)}f()})();
if(matchMedia("(prefers-reduced-motion: reduce)").matches)document.querySelectorAll("svg").forEach(function(m){if(m.pauseAnimations)m.pauseAnimations()});

function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function fmt(d){return new Date(d).toLocaleString("en-IN",{weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:"Asia/Kolkata"})+" IST"}
var wl=document.getElementById("wlist");
if(!CONFIG.winners.length)wl.appendChild(el("p","empty","Pehle tournament ke baad winners aur payout ke screenshots yahan sabse pehle daale jayenge."));
CONFIG.winners.forEach(function(w){var c=el("div","rcard");c.appendChild(el("h3",null,w.team));c.appendChild(el("p",null,w.game+" – "+w.prize+" – "+w.date));wl.appendChild(c)});
var lb=document.getElementById("lb");
if(!CONFIG.leaderboard.length)lb.appendChild(el("p","empty","Leaderboard pehla match khatam hone ke baad yahan dikhega."));
else{var tw=el("div","tw"),tb=el("table","pts wide"),h=el("tr");["#","Team","Points","Kills"].forEach(function(x){h.appendChild(el("th",null,x))});tb.appendChild(h);
CONFIG.leaderboard.forEach(function(r,n){var tr=el("tr");[n+1,r.team,r.points,r.kills].forEach(function(x){tr.appendChild(el("td",null,x))});tb.appendChild(tr)});tw.appendChild(tb);lb.appendChild(tw)}
document.getElementById("s-ig").href="https://instagram.com/"+CONFIG.instagram;
document.getElementById("s-tg").href=CONFIG.telegram;
document.getElementById("s-igl").textContent="@"+CONFIG.instagram;
document.getElementById("iglabel").textContent="@"+CONFIG.instagram;
if(CONFIG.telegram!=="#")document.getElementById("tg2").textContent=CONFIG.telegram.replace("https://","");

function ext(a){var h=a.getAttribute("href");if(h&&h.charAt(0)==="/"){a.setAttribute("data-link","");return}if(h!=="#register"&&h!=="#"){a.target="_blank";a.rel="noopener"}}
function rs(n){return "₹"+Number(n).toLocaleString("en-IN")}
function prizeOf(m){if(!m)return 0;if(m.prize)return m.prize;return Math.floor(m.fee*m.slotCount*(1-CONFIG.cut/100)/50)*50}
function prizesOf(m){if(m.breakdown&&m.breakdown.length>=3)return m.breakdown;var pool=prizeOf(m),a=CONFIG.split.map(function(x,i){return i?Math.floor(pool*x/100/50)*50:0}),r=a.reduce(function(p,c){return p+c},0);a[0]=pool-r;return a}
function payOf(m){if(m.slug&&m.modeId)return "/tournaments/"+m.slug+"/register?mode="+m.modeId;var x=CONFIG.modes.filter(function(k){return k.name===m.name||k.name===m.mode})[0];return x&&x.pay&&x.pay!=="#"?x.pay:"#register"}
function feeOf(m){var x=CONFIG.modes.filter(function(k){return k.name===m.mode})[0];return x?rs(x.fee):"–"}
var PERSON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
document.getElementById("gm").textContent=CONFIG.mode;
document.getElementById("pz").textContent=rs(prizeOf(CONFIG.modes.filter(function(k){return k.name===CONFIG.mode})[0]));
document.getElementById("feeline").textContent="Entry fee: "+CONFIG.modes.map(function(m){return m.name+" "+rs(m.fee)}).join(" | ");
var rg=document.getElementById("regbtns");
CONFIG.modes.forEach(function(m){var a=el("a","btn",m.name+" – "+rs(m.fee)+" register karo");a.href=payOf(m);ext(a);rg.appendChild(a)});
var mg=document.getElementById("modes-grid");
CONFIG.modes.forEach(function(m){var c=el("div","cell mode"),pp=el("div","pp");pp.innerHTML=new Array(m.players+1).join(PERSON);c.appendChild(pp);c.appendChild(el("b",null,m.name));c.appendChild(el("small",null,m.players===1?"Akele khelo":m.players+" players ki team"));c.appendChild(el("small",null,"Entry: "+rs(m.fee)));c.appendChild(el("small",null,"Slots: "+m.slotCount+" "+m.unit));var pz=prizesOf(m);c.appendChild(el("small","pzl","Prize pool: "+rs(prizeOf(m))));c.appendChild(el("small",null,"1st "+rs(pz[0])+" | 2nd "+rs(pz[1])+" | 3rd "+rs(pz[2])));if(m.bonus>0)c.appendChild(el("small",null,"Most Kills bonus: "+rs(m.bonus)));var rb=el("a","btn","Register karo");rb.href=payOf(m);if(rb.getAttribute("href")!=="#register"){rb.target="_blank";rb.rel="noopener"}c.appendChild(rb);mg.appendChild(c)});
var sp=document.getElementById("split");sp.appendChild(el("h3",null,"Prize pool (top 3 ko)"));
var pw=el("div","tw"),pt=el("table","pts wide"),ph=el("tr");["Mode","Collection","Prize pool","1st","2nd","3rd","Most Kills"].forEach(function(x,i){ph.appendChild(el("th",i===1?"hc":null,x))});pt.appendChild(ph);
CONFIG.modes.forEach(function(m){var z=prizesOf(m),tr=el("tr");[m.name,rs(m.fee*m.slotCount),rs(prizeOf(m)),rs(z[0]),rs(z[1]),rs(z[2]),m.bonus>0?rs(m.bonus):"–"].forEach(function(x,i){tr.appendChild(el("td",i===1?"hc":null,x))});pt.appendChild(tr)});
pw.appendChild(pt);sp.appendChild(pw);
sp.appendChild(el("small","note","Collection = entry fee × slots. Prize pool = collection ka "+(100-CONFIG.cut)+"% (₹50 tak neeche). Usme 1st, 2nd, 3rd ka hissa "+CONFIG.split.join("/")+"% hai, 2nd aur 3rd ₹50 tak neeche round, bacha hua 1st ko. Baaki "+CONFIG.cut+"% mein payment gateway fee aur organizer ka hissa hai."+(CONFIG.modes.some(function(m){return m.bonus>0})?" Most Kills bonus alag se milta hai, ye prize pool mein se nahi kata jata.":"")));
function ago(d){var ms=new Date(d)-new Date();if(ms<=0)return"Shuru ho chuka";var m=Math.floor(ms/6e4),dd=Math.floor(m/1440),h=Math.floor(m%1440/60);return"Shuru hone mein "+(dd?dd+"d "+h+"h":h?h+"h "+(m%60)+"m":(m%60)+"m")}
function cal(m){var s=new Date(m.date),e=new Date(+s+72e5),f=function(x){return x.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"")};return"https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent("Kryvox Arena – "+m.game+" "+m.mode)+"&dates="+f(s)+"/"+f(e)+"&details="+encodeURIComponent("Entry: "+feeOf(m)+". Room ID Telegram group mein aayega.")}
var sc=document.getElementById("sched"),chips=document.getElementById("chips"),filt="All";
function renderSched(){sc.textContent="";var L=CONFIG.matches.filter(function(m){return filt==="All"||m.mode===filt||m.game===filt});
if(!L.length){sc.appendChild(el("p","empty","Is filter mein abhi koi match nahi hai. Telegram join karo taaki naya schedule sabse pehle mile."));return}
L.forEach(function(m){var r=el("div","srow"),i=el("div"),f=el("div"),a=el("div","acts");
r.appendChild(el("span","gbadge",m.game));
i.appendChild(el("b",null,m.mode+" match"));i.appendChild(el("small",null,fmt(m.date)));i.appendChild(el("small","cd",ago(m.date)));r.appendChild(i);
f.appendChild(el("b",null,feeOf(m)));f.appendChild(el("small",null,"Slots: "+m.slots));
var q=String(m.slots).split("/");if(q.length===2&&+q[1]){var bar=el("div","bar"),fi=el("i");fi.style.width=Math.min(100,Math.round(q[0]/q[1]*100))+"%";bar.appendChild(fi);f.appendChild(bar)}
r.appendChild(f);
var b1=el("a","btn","Slot book karo");b1.href=payOf(m);ext(b1);var b2=el("a","btn ghost","Calendar");b2.href=cal(m);b2.target="_blank";b2.rel="noopener";a.appendChild(b1);a.appendChild(b2);r.appendChild(a);sc.appendChild(r)})}
["All","Solo","Duo","Squad","Free Fire","BGMI"].forEach(function(n){var b=el("button","chip",n);b.type="button";b.setAttribute("aria-pressed",n==="All");b.onclick=function(){filt=n;[].forEach.call(chips.children,function(c){c.setAttribute("aria-pressed",c===b)});renderSched()};chips.appendChild(b)});
renderSched();setInterval(renderSched,60000);
["s-adm","s-rep","s-spo","adm2"].forEach(function(i){document.getElementById(i).href=CONFIG.admin});
if(CONFIG.admin!=="#")document.getElementById("adm2").textContent=CONFIG.admin.replace("https://t.me/","@");
document.getElementById("s-share").href="https://t.me/share/url?url="+encodeURIComponent(location.href)+"&text="+encodeURIComponent("Kryvox Arena pe Free Fire aur BGMI tournaments. Slot book karo!");
var nt=document.getElementById("notice");if(CONFIG.notice){document.getElementById("ntext").textContent=CONFIG.notice;nt.hidden=false}
document.getElementById("nclose").onclick=function(){nt.hidden=true};
var pr=document.getElementById("prog"),tp=document.getElementById("top");
addEventListener("scroll",function(){var h=document.documentElement,m=h.scrollHeight-h.clientHeight;pr.style.transform="scaleX("+(m>0?h.scrollTop/m:0)+")";tp.classList.toggle("show",h.scrollTop>700)},{passive:true});
tp.onclick=function(){scrollTo({top:0,behavior:"smooth"})};
var navA=[].slice.call(document.querySelectorAll(".nav a")).filter(function(a){return (a.getAttribute("href")||"").charAt(0)==="#"});
if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)navA.forEach(function(a){a.classList.toggle("on",a.getAttribute("href")==="#"+e.target.id)})})},{rootMargin:"-40% 0px -55% 0px"});navA.forEach(function(a){var t=document.querySelector(a.getAttribute("href"));if(t)io.observe(t)})}

  return function unmount(){__ls.forEach(function(l){window.removeEventListener(l[0],l[1],l[2])});__iv.forEach(clearInterval);root.innerHTML=""};
}

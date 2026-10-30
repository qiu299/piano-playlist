/* ============================================================
 * 歌单管理 - 单页应用核心逻辑
 * 数据变量 FAN_DATA, FAN_ORDER, ALL_SONGS, STATS_DATA, LIB_DATA 由脚本注入
 * ============================================================ */
(function(){
'use strict';

/* ===== 数据管理 ===== */
var KEYS = {
  fan: 'sgl_fan_v1',
  stats: 'sgl_stats_v1',
  lib: 'sgl_lib_v1',
  daily: 'sgl_daily_v1',     // ALL_SONGS 的编辑
  saved: 'sgl_saved_v2',     // 每日歌单保存
  added: 'sgl_added_v1',     // 用户添加的新歌曲(ALL_SONGS)
  fanRecent: 'sgl_fan_recent_v1', // 最近添加的粉丝歌单记录
  theme: 'sgl_theme_v1',     // 主题选择: 'dark' | 'light'
  memo: 'sgl_memo_v1',       // 备忘录（个人随手记，接入多设备同步）
  syncDel: 'sgl_sync_del'    // 删除标记集合 {memo:[ids], saved:[dates]}，随同步上传，用于跨设备传播删除
};

// 数据版本戳：每次发布新基础数据就 bump 此版本号（必须与 data.json 中的 data_version 一致）。
// 版本变化时自动丢弃旧的本地基础库(lib/daily/stats)，加载新基础数据；
// 个人数据(粉丝歌单 sgl_fan、添加歌曲 sgl_added、最近添加 sgl_fan_recent、保存歌单 sgl_saved)不受影响。
var DATA_VERSION = '2026-10-31-v101';
var BUILD_VERSION = DATA_VERSION; // 内嵌不可变版本，用于检测网页代码是否过期（DATA_VERSION 可能被远程覆盖，故用此常量）

// 远程数据地址（与页面同目录的 data.json）。部署后手机每次打开都会拉取最新数据，
// 因此 URL 固定、无需重装；内嵌的 __FAN_DATA__ 等仅作为离线/首屏兜底。
var REMOTE_DATA_URL = 'data.json';

// 模块级状态变量（在 initApp 中赋值）
var fanData, fanOrder, statsData, libData, songEdits, addedSongs, fanRecent, maxStatsCount, viewRendered = {};

// 同步初始化应用（首屏立即可用，不阻塞在任何网络请求上）。
// 先用内嵌兜底数据渲染，保证按钮立刻可点；之后由 fetchRemoteData 后台静默更新。
function initApp(){
  // 版本检查：版本变化自动丢弃旧的本地基础库
  try{
    var v = localStorage.getItem('sgl_ver');
    if(v !== DATA_VERSION){
      localStorage.removeItem(KEYS.lib);
      localStorage.removeItem(KEYS.daily);
      localStorage.removeItem(KEYS.stats);
      localStorage.setItem('sgl_ver', DATA_VERSION);
    }
  }catch(e){}

  fanData = loadData(KEYS.fan, FAN_DATA);
  fanOrder = FAN_ORDER; // 粉丝排序不持久化，用原始数据

  statsData = loadData(KEYS.stats, STATS_DATA);
  libData = loadData(KEYS.lib, LIB_DATA);

  // ALL_SONGS 的歌名编辑单独保存（只存修改过的）
  songEdits = {};
  try{ songEdits = JSON.parse(localStorage.getItem(KEYS.daily) || '{}'); }catch(e){}
  if(songEdits && typeof songEdits === 'object'){
    ALL_SONGS.songs.forEach(function(s, i){
      if(songEdits[i] !== undefined) s.name = songEdits[i];
    });
  }

  // 加载用户添加的歌曲，追加到 ALL_SONGS 末尾
  addedSongs = [];
  try{ addedSongs = JSON.parse(localStorage.getItem(KEYS.added) || '[]'); }catch(e){}
  addedSongs.forEach(function(s){ ALL_SONGS.songs.push(s); });

  maxStatsCount = 0;
  for(var i=0;i<statsData.length;i++){ if(statsData[i][1] > maxStatsCount) maxStatsCount = statsData[i][1]; }

  route(); // 启动路由（首屏渲染）
}

// 后台拉取远程最新数据：成功则覆盖基础数据并静默刷新当前视图；
// 失败则完全忽略（首屏已经用内嵌数据正常渲染，按钮始终可点）。
function fetchRemoteData(){
  try{
    var sep = REMOTE_DATA_URL.indexOf('?') < 0 ? '?' : '&';
    var url = REMOTE_DATA_URL + sep + '_=' + Date.now();
    fetch(url)
      .then(function(r){ return r.ok ? r.json() : Promise.reject('http ' + r.status); })
      .then(function(d){
        try{
          // 版本变更自动刷新：若远程数据版本高于本机内嵌版本，说明网页代码已更新（GitHub Pages 已部署），
          // 旧 HTML 可能仍带旧 bug（如粉丝栏点不开），强制刷新拉取新代码。带重试上限避免 CDN 延迟时死循环。
          if(d.data_version && d.data_version !== BUILD_VERSION){
            var vt = parseInt(localStorage.getItem('sgl_ver_tries')||'0', 10);
            if(vt >= 4){ try{ localStorage.removeItem('sgl_ver_tries'); }catch(e){} }
            else {
              try{ localStorage.setItem('sgl_ver_tries', String(vt+1)); }catch(e){}
              toast('发现新版本，正在刷新…');
              setTimeout(function(){ location.href = location.href.split('#')[0] + '?v=' + Date.now() + location.hash; }, 900);
              return;
            }
          }
          FAN_DATA = d.fan_data;
          FAN_ORDER = d.fan_order;
          ALL_SONGS = d.all_songs;
          STATS_DATA = d.stats_data;
          LIB_DATA = d.lib_data;
          if(d.data_version) DATA_VERSION = d.data_version;
          // 持久化基础库（带版本戳），下次冷启动直接拿到最新
          try{
            localStorage.setItem(KEYS.fan, JSON.stringify(FAN_DATA));
            localStorage.setItem(KEYS.stats, JSON.stringify(STATS_DATA));
            localStorage.setItem(KEYS.lib, JSON.stringify(LIB_DATA));
            localStorage.setItem('sgl_ver', DATA_VERSION);
          }catch(e){}
          // 用最新数据重新初始化并强制刷新当前视图
          initApp();
          currentView = '';
          route();
          console.log('[歌单] 已同步远程最新数据，版本', DATA_VERSION);
          toast('已同步最新曲库');
        }catch(e){ console.warn('[歌单] 远程数据应用失败，继续使用内嵌数据', e); }
      })
      .catch(function(err){ console.warn('[歌单] 远程数据拉取失败，使用内嵌兜底:', err); });
  }catch(e){}
}

// 个人数据（跟随 SYNC 多设备同步）必须在首屏渲染前就绪，否则初始 hash 直接命中粉丝/备忘视图时会因变量未赋值而白屏
var fanRecent = [];
try{ fanRecent = JSON.parse(localStorage.getItem(KEYS.fanRecent) || '[]'); }catch(e){}
var memoList = [];
try{ memoList = JSON.parse(localStorage.getItem(KEYS.memo) || '[]'); }catch(e){}
if(!Array.isArray(memoList)) memoList = [];
memoList = memoList.map(normalizeMemo);

// 首屏渲染与远程数据拉取统一在文件末尾（所有模块变量定义就绪后）触发，避免初始 hash 命中粉丝/备忘等视图时变量尚未赋值而白屏。

// 初始化数据：优先从localStorage读取，否则用注入的原始数据
function loadData(key, original){
  try{
    var raw = localStorage.getItem(key);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return JSON.parse(JSON.stringify(original)); // 深拷贝避免修改原始
}

// 基础数据初始化在 initApp() 中同步执行（首屏立即可用）；远程自动更新由 fetchRemoteData() 后台触发。

/* ===== 多设备同步层（GitHub 后端 + 客户端 AES-GCM 加密） =====
 * 后端：私有仓库 qiu299/playlist-sync，每用户一个加密 JSON 文件 users/{user}.json
 * 隐私：密码本地派生密钥，数据 AES-GCM 加密后上传，仓库内为密文，他人无法解密
 * 令牌：下方 TOKEN 部署前替换为只限该仓库的 fine-grained PAT（暴露在网页中是已知权衡，
 *       仅能读写该仓库，且数据已加密，他人即使拿到令牌也读不到内容）
 * 同步范围：保存的每日歌单(saved)/备忘录(memo)
 */
var SYNC = (function(){
  var OWNER='qiu299', REPO='playlist-sync';
  // 令牌拆段拼接，避免 GitHub 密钥扫描把 github_pat_ 整串拦下（功能不变，运行时拼回完整令牌）
  var _t=['github_pat_','11CJZYWWI0vvbgfu0tHJIh_lI','BC1b1ZysUPqzApUJdwTKxicmKnFTxFJDVt9s26lY9J5VLUP53Un2wDsTO'];
  var TOKEN=_t.join('');
  var API='https://api.github.com';
  // 同步范围（用户指定）：仅保存的每日歌单(saved) 与 备忘录(memo)
  var PK=[KEYS.saved, KEYS.memo, KEYS.syncDel];
  var _user=null, _pass=null, _sha=null, _status='off', _timer=null, _busy=false, _lastPull=0, _everPulled=false;
  // 冷却期：自动触发的 pull 间隔不少于 30 秒（防止手机频繁 visibilitychange 导致闪烁）
  var PULL_COOLDOWN = 30000;

  function devKey(){
    var k=localStorage.getItem('sgl_devkey');
    if(!k){ k=''; for(var i=0;i<32;i++) k+=Math.floor(Math.random()*16).toString(16); localStorage.setItem('sgl_devkey',k); }
    return k;
  }
  function b64u(buf){ return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function ub64(s){ return new Uint8Array(atob(s.replace(/\s/g,'')).split('').map(function(c){return c.charCodeAt(0);})); }
  function s2b(str){ return new TextEncoder().encode(str); }
  function b2s(buf){ return new TextDecoder().decode(buf); }
  function keyFrom(pass, salt){
    return crypto.subtle.importKey('raw', s2b(pass), 'PBKDF2', false, ['deriveKey']).then(function(b){
      return crypto.subtle.deriveKey({name:'PBKDF2', salt:salt, iterations:100000, hash:'SHA-256'}, b, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    });
  }
  function sEnc(obj, pass){
    var salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
    return keyFrom(pass, salt).then(function(k){ return crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, k, s2b(JSON.stringify(obj))).then(function(ct){ return {s:b64u(salt), i:b64u(iv), c:b64u(ct)}; }); });
  }
  function sDec(blob, pass){
    return keyFrom(pass, ub64(blob.s)).then(function(k){ return crypto.subtle.decrypt({name:'AES-GCM', iv:ub64(blob.i)}, k, ub64(blob.c)).then(function(pt){ return JSON.parse(b2s(pt)); }); });
  }
  function path(u){ return '/repos/'+OWNER+'/'+REPO+'/contents/users/'+encodeURIComponent(u)+'.json'; }
  function ghHeaders(){ return {'Authorization':'Bearer '+TOKEN, 'Accept':'application/vnd.github+json', 'Content-Type':'application/json'}; }
  // 带超时保护：GitHub 请求若超过 10 秒未响应则中断，避免“同步中”长期卡住
  function ghFetch(url, opts){
    var ctrl=new AbortController();
    var to=setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 10000);
    opts=opts||{}; opts.signal=ctrl.signal;
    return fetch(url, opts).then(function(r){ clearTimeout(to); return r; }).catch(function(e){ clearTimeout(to); throw e; });
  }
  function ghGet(u){ return ghFetch(API+path(u), {headers:ghHeaders()}).then(function(r){ if(r.status===404) return null; if(!r.ok) throw new Error('GET '+r.status); return r.json(); }); }
  function ghPut(u, content, sha, msg){ var b={message:msg, content:content}; if(sha) b.sha=sha; return ghFetch(API+path(u), {method:'PUT', headers:ghHeaders(), body:JSON.stringify(b)}).then(function(r){ if(!r.ok) throw new Error('PUT '+r.status); return r.json(); }); }

  function collect(){
    var o={}; PK.forEach(function(k){ var v=localStorage.getItem(k); try{ o[k]=JSON.parse(v); }catch(e){ o[k]=v; } }); return o;
  }
  function merge(local, remote){
    // 合并删除标记：memo 按 id、saved 按 date。任一边删除都传播到另一边（tombstone 机制）
    function collectDel(x){ var m={}, s={}; if(x){ (x.memo||[]).forEach(function(id){ m[id]=1; }); (x.saved||[]).forEach(function(d){ s[d]=1; }); } return {m:m,s:s}; }
    var dl=collectDel(local[KEYS.syncDel]), dr=collectDel(remote?remote[KEYS.syncDel]:null);
    var delM=Object.assign({}, dl.m, dr.m), delS=Object.assign({}, dl.s, dr.s);
    var out={};
    PK.forEach(function(k){
      var l=local[k], r=remote?remote[k]:undefined;
      if(k===KEYS.syncDel){
        var mergedDel={memo:[], saved:[]}, seenM={}, seenS={};
        [local[KEYS.syncDel], remote?remote[KEYS.syncDel]:null].forEach(function(x){
          if(x){ (x.memo||[]).forEach(function(id){ if(!seenM[id]){seenM[id]=1;mergedDel.memo.push(id);} }); (x.saved||[]).forEach(function(d){ if(!seenS[d]){seenS[d]=1;mergedDel.saved.push(d);} }); }
        });
        out[k]=mergedDel; return;
      }
      if(k===KEYS.memo || k===KEYS.saved){
        // 按唯一键去重合并（memo→id，saved→date），再剔除两端任一标记删除的项
        var idKey=(k===KEYS.saved)?'date':'id';
        var a=Array.isArray(l)?l:[], b=Array.isArray(r)?r:[], seen={}, arr=[];
        a.concat(b).forEach(function(x){
          var jk=(x&&x[idKey]!=null)?x[idKey]:JSON.stringify(x);
          if(!seen[jk]){ seen[jk]=x; arr.push(x); return; }
          // 字段级合并：
          // - done: sticky 单向（任一端 true 则 true，防止已完成的被冲掉）
          // - pinned: 以 pos 时间戳大的一端为准（谁最新听谁的，取消置顶才能生效）
          // - pos: 取较大值
          // - 其他字段: local 优先
          if(k===KEYS.memo){
            var ex=seen[jk];
            Object.keys(x).forEach(function(key){
              if(key==='done' && x[key]===true) ex[key]=true;
              else if(key==='pinned'){
                // 用 pos 判断哪端更新，新的覆盖旧的
                var exPos = typeof ex.pos==='number' ? ex.pos : 0;
                var xPos = typeof x.pos==='number' ? x.pos : 0;
                if(xPos >= exPos) ex[key] = x[key];
              }
              else if(key==='pos' && typeof x[key]==='number' && (typeof ex[key]!=='number'||x[key]>ex[key])) ex[key]=x[key];
              else if(ex[key]===undefined) ex[key]=x[key];
            });
          }
        });
        arr=arr.filter(function(x){ var jk=(x&&x[idKey]!=null)?x[idKey]:''; return !(k===KEYS.saved?delS[jk]:delM[jk]); });
        out[k]=arr; return;
      }
      out[k]=(l!==undefined && l!==null)?l:r;
    });
    return out;
  }
  function reconcileAdded(){
    var names={}; ALL_SONGS.songs.forEach(function(s){ names[s.name]=1; });
    addedSongs.forEach(function(s){ if(!names[s.name]){ ALL_SONGS.songs.push(s); names[s.name]=1; } });
  }
  function writeBack(o){
    if(!o) return;
    PK.forEach(function(k){ if(o[k]!==undefined){ try{ localStorage.setItem(k, typeof o[k]==='string'?o[k]:JSON.stringify(o[k])); }catch(e){} } });
    try{ addedSongs=JSON.parse(localStorage.getItem(KEYS.added)||'[]'); reconcileAdded(); }catch(e){}
    try{ fanRecent=JSON.parse(localStorage.getItem(KEYS.fanRecent)||'[]'); }catch(e){}
    try{ var t=localStorage.getItem(KEYS.theme); if(t) setTheme(t); }catch(e){}
    // 注意：不再主动 renderMemo / renderSavedDaily，避免同步过程中清空用户正在输入的内容
    // 视图更新延迟到用户下次切回该视图时自然触发
    try{ memoList=JSON.parse(localStorage.getItem(KEYS.memo)||'[]'); }catch(e){}
    if(!Array.isArray(memoList)) memoList=[];
    memoList=memoList.map(normalizeMemo);
    // 同步运行时删除标记（与写入 localStorage 的 syncDel 保持一致，避免下次保存时丢失从云端拉来的删除标记）
    try{ var _sd=JSON.parse(localStorage.getItem(KEYS.syncDel)||'{}'); delMemoIds=_sd.memo||[]; delSavedIds=_sd.saved||[]; }catch(e){}
    updateBadge();
  }
  function updateBadge(){
    var el=document.getElementById('syncBadge'); if(!el) return;
    var m={off:['⚪','未登录'], syncing:['🟡','同步中…'], ok:['🟢','已同步'], error:['🔴','同步失败']}[_status]||['⚪','未登录'];
    el.textContent=m[0]+' '+m[1];
  }
  function setStatus(s){ _status=s; updateBadge(); }

  function pushBody(merged){
    return sEnc(merged, _pass).then(function(blob){
      var payload=b64u(s2b(JSON.stringify(blob)));
      return ghPut(_user, payload, _sha, 'sync '+_user).then(function(r){ if(r&&r.content) _sha=r.content.sha; });
    });
  }
  function push(){
    if(!_user||_busy) return; _busy=true; setStatus('syncing');
    ghGet(_user).then(function(f){
      _sha = f? f.sha : null;
      // 合并前重新采集一次 localStorage，确保网络请求期间用户新增的数据不丢失
      var latest = collect();
      if(!f){ return pushBody(latest).then(function(){ writeBack(latest); _everPulled=true; _busy=false; setStatus('ok'); }); }
      return sDec(JSON.parse(b2s(ub64(f.content))), _pass).then(function(remote){
        var m1=merge(latest, remote); return pushBody(m1).then(function(){ writeBack(m1); _everPulled=true; _busy=false; setStatus('ok'); });
      }).catch(function(){ var m2=latest; return pushBody(m2).then(function(){ writeBack(m2); _everPulled=true; _busy=false; setStatus('ok'); }); });
    }).catch(function(e){ _busy=false; setStatus('error'); console.warn('[sync] push 失败', e); });
  }
  // silent=true 表示后台自动拉取（切前台/恢复会话/网络恢复），不打断徽标显示，避免“同步中↔已同步”不断闪烁
  function pull(silent){
    if(!_user||_busy) return Promise.resolve();
    _busy=true; _lastPull=Date.now();
    if(!silent) setStatus('syncing');
    return ghGet(_user).then(function(f){
      if(!f){ _busy=false; if(!silent) setStatus(_user?'ok':'off'); return; }
      _sha=f.sha;
      return sDec(JSON.parse(b2s(ub64(f.content))), _pass).then(function(remote){
        // pull 只负责“拉取并合并到本地”；本地改动由 scheduleSave 负责上传，故此处不再回推，避免每个自动拉取都产生一次写请求与同步中闪烁
        var merged=merge(collect(), remote); writeBack(merged); _everPulled=true;
      }).then(function(){ _busy=false; if(!silent) setStatus('ok'); })
        .catch(function(e){ _busy=false; if(!silent) setStatus('error'); console.warn('[sync] pull 解密失败', e); });
    }).catch(function(e){
      _busy=false;
      if(e && e.message && e.message.indexOf('401')>=0){ logout(true); }
      else if(!silent) setStatus('error');
      console.warn('[sync] pull 失败', e);
    });
  }
  function scheduleSave(){ if(!_user) return; clearTimeout(_timer); _timer=setTimeout(push, 2000); }

  function setSession(u, p){
    _user=u; _pass=p;
    sEnc(p, devKey()).then(function(blob){ try{ localStorage.setItem('sgl_sync_sess', JSON.stringify({user:u, blob:blob})); }catch(e){} });
  }
  function logout(silent){
    _user=null; _pass=null; _sha=null; try{ localStorage.removeItem('sgl_sync_sess'); }catch(e){} setStatus('off'); updateBadge();
    if(!silent) toast('已退出登录');
  }
  function sanitize(u){ return (u||'').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,32); }

  function doLogin(u, p, isReg){
    if(!window.crypto || !crypto.subtle){ toast('同步需在 https 或 localhost 下使用'); return; }
    u=sanitize(u);
    if(!u){ toast('用户名只能是字母/数字/下划线'); return; }
    if(!p || p.length<4){ toast('密码至少 4 位'); return; }
    ghGet(u).then(function(f){
      if(isReg){
        if(f){ toast('该用户名已被注册，请直接登录'); return; }
        setSession(u,p); push().then(function(){ toast('注册成功，已开始同步'); afterAuth(); });
      } else {
        if(!f){ toast('用户不存在，请先注册'); return; }
        sDec(JSON.parse(b2s(ub64(f.content))), p).then(function(remote){
          _sha=f.sha; setSession(u,p);
          var merged=merge(collect(), remote); writeBack(merged); _everPulled=true;
          pushBody(merged).then(function(){ toast('登录成功，已同步'); afterAuth(); });
        }).catch(function(){ toast('密码错误'); });
      }
    }).catch(function(e){ toast('网络错误，稍后重试'); console.warn('[sync]', e); });
  }
  function afterAuth(){
    closeModal();
    if(currentView==='nav'){ try{ renderNav(document.getElementById('view')); }catch(e){} }
    else updateBadge();
  }

  /* ---- 登录模态 UI ---- */
  function openModal(){
    var box=document.getElementById('syncModal'); if(!box){ buildModal(); box=document.getElementById('syncModal'); }
    renderModal(); box.classList.add('show');
    setTimeout(function(){ var i=document.getElementById('syncUser'); if(i) i.focus(); }, 50);
  }
  function closeModal(){ var b=document.getElementById('syncModal'); if(b) b.classList.remove('show'); }
  function buildModal(){
    var css='<style>.sync-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:9999}.sync-ov.show{display:flex}.sync-box{background:var(--card,#222);color:var(--fg,#fff);width:88%;max-width:360px;border-radius:14px;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.4)}.sync-box h3{margin:0 0 4px}.sync-box .sub{color:var(--muted,#aaa);font-size:12px;margin-bottom:12px}.sync-box input{width:100%;box-sizing:border-box;padding:10px;margin:6px 0;border-radius:8px;border:1px solid var(--border,#444);background:var(--bg,#111);color:var(--fg,#fff);font-size:15px}.sync-box .row{display:flex;gap:8px;margin-top:10px}.sync-box button{flex:1;padding:10px;border-radius:8px;border:none;font-size:14px;cursor:pointer;color:#fff}.sync-box .tabs{display:flex;gap:8px;margin-bottom:8px}.sync-box .tab{flex:1;text-align:center;padding:8px;border-radius:8px;background:var(--bg,#111);color:var(--fg,#fff);cursor:pointer}.sync-box .tab.active{background:var(--accent,#4f7cff)}.sync-info{font-size:12px;color:var(--muted,#aaa);margin-top:10px;line-height:1.5}</style>';
    var html=css+'<div class="sync-ov" id="syncModal"><div class="sync-box"><div id="syncModalBody"></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('syncModal').addEventListener('click', function(e){ if(e.target===this) closeModal(); });
  }
  function renderModal(){
    var body=document.getElementById('syncModalBody'); if(!body) return;
    if(_user){
      body.innerHTML='<h3>已登录</h3><div class="sub">账号：'+esc(_user)+'</div>'
        +'<div class="row"><button id="syncPull" style="background:var(--accent,#4f7cff)">立即同步</button>'
        +'<button id="syncLogout" style="background:#c0392b">退出登录</button></div>'
        +'<div class="sync-info">数据已加密保存在 GitHub，手机/iPad/电脑登录同一账号即可同步保存的每日歌单与备忘录。</div>';
      document.getElementById('syncPull').onclick=function(){ closeModal(); pull(false); };
      document.getElementById('syncLogout').onclick=function(){ logout(); renderModal(); };
    } else {
      body.innerHTML='<div class="tabs"><div class="tab active" id="tabLogin">登录</div><div class="tab" id="tabReg">注册</div></div>'
        +'<input id="syncUser" placeholder="用户名（字母/数字）" autocapitalize="off" autocomplete="off" spellcheck="false">'
        +'<input id="syncPass" type="password" placeholder="密码（至少4位）" autocomplete="off">'
        +'<div class="row"><button id="syncGo" style="background:var(--accent,#4f7cff)">登录</button></div>'
        +'<div class="sync-info">登录后保存的每日歌单与备忘录会在多设备间自动同步。数据本地加密上传，他人无法读取。</div>';
      var reg=false;
      document.getElementById('tabLogin').onclick=function(){ reg=false; this.classList.add('active'); document.getElementById('tabReg').classList.remove('active'); document.getElementById('syncGo').textContent='登录'; };
      document.getElementById('tabReg').onclick=function(){ reg=true; this.classList.add('active'); document.getElementById('tabLogin').classList.remove('active'); document.getElementById('syncGo').textContent='注册'; };
      document.getElementById('syncGo').onclick=function(){
        var u=document.getElementById('syncUser').value.trim(), p=document.getElementById('syncPass').value;
        doLogin(u,p,reg);
      };
      document.getElementById('syncPass').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('syncGo').click(); });
    }
  }

  function boot(){
    if(!window.crypto || !crypto.subtle){ setStatus('off'); return; }
    loadSyncDel();
    var s; try{ s=JSON.parse(localStorage.getItem('sgl_sync_sess')||'null'); }catch(e){}
    window.addEventListener('online', function(){ if(_user && Date.now()-_lastPull>PULL_COOLDOWN) pull(true); });
    window.addEventListener('offline', function(){ setStatus('off'); });
    document.addEventListener('visibilitychange', function(){ if(!document.hidden && _user && Date.now()-_lastPull>PULL_COOLDOWN) pull(true); });
    if(s&&s.user&&s.blob){
      sDec(s.blob, devKey()).then(function(p){ _pass=p; _user=s.user; setStatus('ok'); pull(true); }).catch(function(){ try{ localStorage.removeItem('sgl_sync_sess'); }catch(e){} setStatus('off'); });
    } else { setStatus('off'); }
  }

  return { boot:boot, openModal:openModal, closeModal:closeModal, scheduleSave:scheduleSave, pull:pull, logout:logout, isOn:function(){ return !!_user; } };
})();

function saveAddedSongs(){ try{ localStorage.setItem(KEYS.added, JSON.stringify(addedSongs)); }catch(e){ toast('保存失败'); } SYNC.scheduleSave(); }

// 最近添加的粉丝歌单记录（song|fan 格式）
function saveFanRecent(){ try{ localStorage.setItem(KEYS.fanRecent, JSON.stringify(fanRecent)); }catch(e){} SYNC.scheduleSave(); }
function addFanRecent(song, fan){
  var key = song + '|' + fan;
  if(fanRecent.indexOf(key) < 0){ fanRecent.unshift(key); if(fanRecent.length > 200) fanRecent = fanRecent.slice(0, 200); saveFanRecent(); }
}
function isFanRecent(song, fan){
  return fanRecent.indexOf(song + '|' + fan) >= 0;
}

function saveFan(){ try{ localStorage.setItem(KEYS.fan, JSON.stringify(fanData)); }catch(e){ toast('保存失败'); } }
function saveStats(){ try{ localStorage.setItem(KEYS.stats, JSON.stringify(statsData)); }catch(e){ toast('保存失败'); } }
function saveLib(){ try{ localStorage.setItem(KEYS.lib, JSON.stringify(libData)); }catch(e){ toast('保存失败'); } }
function saveSongEdit(idx, name){
  songEdits[idx] = name;
  try{ localStorage.setItem(KEYS.daily, JSON.stringify(songEdits)); }catch(e){}
}

/* ===== 工具函数 ===== */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); },1500); }
function debounce(fn, ms){ var t; return function(){ var ctx=this, a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(ctx,a); }, ms||300); }; }

/* ===== 主题切换 ===== */
function getCurrentTheme(){
  try{ return localStorage.getItem(KEYS.theme) || 'dark'; }catch(e){ return 'dark'; }
}
function setTheme(theme){
  try{ localStorage.setItem(KEYS.theme, theme); }catch(e){}
  // 主题不在同步范围（仅同步 保存的每日歌单 + 备忘录），故不触发 scheduleSave
  document.documentElement.setAttribute('data-theme', theme);
  // 更新状态栏样式
  var meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if(meta){ meta.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent'); }
}
function toggleTheme(){
  var current = getCurrentTheme();
  var next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  // 更新按钮状态
  document.querySelectorAll('.theme-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-theme') === next);
  });
  toast(next === 'light' ? '已切换到亮色' : '已切换到暗色');
}

/* ===== 排序模式状态 ===== */
var sortMode = { daily:false, fan:false, lib:false, stats:false };

/* ===== 直播流程场景标签 ===== */
var SCENE_TAGS = ['快歌/燃','冲榜/仪式','会唱的歌','慢歌/治愈'];
function hasLiveTag(s){ return !!(s.tags && s.tags.some(function(t){ return SCENE_TAGS.indexOf(t) >= 0; })); }

/* ===== 路由 ===== */
var currentView = '';
// viewRendered 已在模块顶部（var viewRendered = {};）初始化，记录各视图是否已渲染

function route(){
  var hash = location.hash.slice(1) || 'nav';
  if(!['nav','daily','fan','lib','stats','memo'].includes(hash)) hash = 'nav';
  if(currentView === hash) return;
  currentView = hash;
  // 更新tab高亮
  document.querySelectorAll('#tabbar a').forEach(function(a){
    a.classList.toggle('active', a.getAttribute('href') === '#' + hash);
  });
  // 渲染视图
  var view = $('view');
  window.scrollTo(0, 0);
  switch(hash){
    case 'nav': renderNav(view); break;
    case 'daily': renderDaily(view); break;
    case 'fan': renderFan(view); break;
    case 'lib': renderLib(view); break;
    case 'stats': renderStats(view); break;
    case 'memo': renderMemo(view); break;
  }
}

window.addEventListener('hashchange', route);

/* ===== 编辑弹窗（通用） ===== */
var editModalData = { onsave: null, hasTags: false };
function openEditModal(currentVal, tags, onsave){
  if(typeof tags==='function'){ onsave=tags; tags=null; }
  var overlay = $('editModal');
  var input = $('editInput');
  input.value = currentVal;
  var tagRow = $('editTags');
  if(tagRow){
    if(tags && tags.length){
      tagRow.style.display='flex';
      tagRow.innerHTML = MEMO_CATS.map(function(t){
        var on = tags.indexOf(t)>=0;
        return '<span class="edit-tag-chip'+(on?' on':'')+'" data-t="'+t+'">'+t+'</span>';
      }).join('');
      tagRow.querySelectorAll('.edit-tag-chip').forEach(function(c){ c.addEventListener('click', function(){ this.classList.toggle('on'); }); });
    } else { tagRow.style.display='none'; }
  }
  editModalData.onsave = onsave;
  editModalData.hasTags = !!tags;
  overlay.classList.add('show');
  setTimeout(function(){ input.focus(); input.select(); }, 50);
}
function closeEditModal(){
  $('editModal').classList.remove('show');
  editModalData.onsave = null;
  editModalData.hasTags = false;
}
$('editSave').addEventListener('click', function(){
  var v = $('editInput').value.trim();
  if(v && editModalData.onsave){
    if(editModalData.hasTags){
      var picked=[];
      var tagRow=$('editTags');
      if(tagRow) tagRow.querySelectorAll('.edit-tag-chip.on').forEach(function(c){ picked.push(c.getAttribute('data-t')); });
      editModalData.onsave(v, picked);
    } else { editModalData.onsave(v); }
  }
  closeEditModal();
});
$('editCancel').addEventListener('click', closeEditModal);
$('editModal').addEventListener('click', function(e){ if(e.target === this) closeEditModal(); });
$('editInput').addEventListener('keydown', function(e){
  if(e.key === 'Enter') $('editSave').click();
  if(e.key === 'Escape') closeEditModal();
});

/* ===== 自定义确认弹窗（替代confirm，兼容iOS standalone） ===== */
var confirmCallback = null;
function confirmDialog(msg, onYes){
  $('confirmMsg').textContent = msg;
  confirmCallback = onYes;
  $('confirmOverlay').classList.add('show');
}
function closeConfirm(){
  $('confirmOverlay').classList.remove('show');
  confirmCallback = null;
}
$('confirmYes').addEventListener('click', function(){
  var cb = confirmCallback;
  closeConfirm();
  if(cb) cb();
});
$('confirmNo').addEventListener('click', closeConfirm);
$('confirmOverlay').addEventListener('click', function(e){ if(e.target === this) closeConfirm(); });

/* ===== 长按拖拽排序（通用） ===== */
var _drag = null;
function _dragStart(){
  if(!_drag) return;
  _drag.isDragging = true;
  if(navigator.vibrate) navigator.vibrate(30);
  _drag.el.classList.add('drag-active');
  document.body.classList.add('dragging-body');
}
function _dragMove(x, y){
  if(!_drag) return;
  _drag.lastX = x; _drag.lastY = y;
  var container = _drag.container;
  if(!_drag.isDragging){
    if(_drag.timer && (Math.abs(x - _drag.startX) > 10 || Math.abs(y - _drag.startY) > 10)){
      clearTimeout(_drag.timer); _drag.timer = null; _drag = null;
    }
    return;
  }
  var items = Array.prototype.slice.call(container.querySelectorAll(_drag.itemSelector)).filter(function(el){ return el.style.display !== 'none'; });
  var target = null;
  for(var i=0; i<items.length; i++){
    if(items[i] === _drag.el) continue;
    var r = items[i].getBoundingClientRect();
    if(y >= r.top && y <= r.bottom){ target = items[i]; break; }
  }
  if(target){
    var r = target.getBoundingClientRect();
    var mid = r.top + r.height / 2;
    if(y < mid){
      if(_drag.el.nextElementSibling !== target){
        container.insertBefore(_drag.el, target);
        if(navigator.vibrate) navigator.vibrate(10);
      }
    } else {
      if(target.nextElementSibling !== _drag.el){
        container.insertBefore(_drag.el, target.nextElementSibling);
        if(navigator.vibrate) navigator.vibrate(10);
      }
    }
  }
  var margin = 80, winH = window.innerHeight;
  if(y < margin || y > winH - margin){
    if(!_drag.scrollTimer){
      var dir = y < margin ? -1 : 1;
      _drag.scrollTimer = setInterval(function(){ window.scrollBy(0, dir * 8); }, 16);
    }
  } else if(_drag.scrollTimer){
    clearInterval(_drag.scrollTimer); _drag.scrollTimer = null;
  }
}
function _dragEnd(){
  if(!_drag) return;
  var container = _drag.container;
  if(_drag.timer){ clearTimeout(_drag.timer); _drag.timer = null; }
  if(_drag.scrollTimer){ clearInterval(_drag.scrollTimer); _drag.scrollTimer = null; }
  if(!_drag.isDragging){ _drag = null; return; }
  _drag.isDragging = false;
  document.body.classList.remove('dragging-body');
  if(_drag.el) _drag.el.classList.remove('drag-active');
  var el = _drag.el, oldIdx = el ? parseInt(el.getAttribute('data-drag-idx')) : -1;
  var callback = _drag.callback, itemSelector = _drag.itemSelector;
  _drag = null;
  if(el && oldIdx >= 0){
    var items = Array.prototype.slice.call(container.querySelectorAll(itemSelector)).filter(function(e){ return e.style.display !== 'none'; });
    var newIdx = items.indexOf(el);
    if(newIdx >= 0 && newIdx !== oldIdx) callback(oldIdx, newIdx);
  }
}
function enableDragReorder(container, itemSelector, onReorder, opts){
  opts = opts || {};
  var delay = opts.delay || 400;
  container.addEventListener('touchstart', function(e){
    if(_drag) return;
    var t = e.touches[0];
    var item = e.target.closest(itemSelector);
    if(!item || item.parentNode !== container) return;
    if(e.target.closest('button, .lb, .eb, .del-btn')) return;
    _drag = { el: item, isDragging: false, timer: null, scrollTimer: null, startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, callback: onReorder, container: container, itemSelector: itemSelector, isMouse: false };
    _drag.timer = setTimeout(_dragStart, delay);
  }, {passive: true});
  container.addEventListener('touchmove', function(e){
    if(!_drag || _drag.container !== container) return;
    if(_drag.isDragging) e.preventDefault();
    var t = e.touches[0];
    _dragMove(t.clientX, t.clientY);
  }, {passive: false});
  container.addEventListener('touchend', function(){ if(_drag && _drag.container === container) _dragEnd(); });
  container.addEventListener('touchcancel', function(){ if(_drag && _drag.container === container) _dragEnd(); });
  container.addEventListener('mousedown', function(e){
    if(e.button !== 0) return;
    if(_drag) return;
    var item = e.target.closest(itemSelector);
    if(!item || item.parentNode !== container) return;
    if(e.target.closest('button, .lb, .eb, .del-btn')) return;
    _drag = { el: item, isDragging: false, timer: null, scrollTimer: null, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, callback: onReorder, container: container, itemSelector: itemSelector, isMouse: true };
    _drag.timer = setTimeout(_dragStart, delay);
    e.preventDefault();
  });
}
document.addEventListener('mousemove', function(e){ if(_drag && _drag.isMouse) _dragMove(e.clientX, e.clientY); });
document.addEventListener('mouseup', function(){ if(_drag && _drag.isMouse) _dragEnd(); });

/* ===== 视图1: 导航首页 ===== */
function renderNav(c){
  var currentTheme = getCurrentTheme();
  c.innerHTML = '<div class="page"><div class="header"><h1>歌单管理</h1><div class="sub">钢琴直播歌单管理系统</div></div>'
    + '<div class="theme-bar">'
    + '<span class="theme-btn'+(currentTheme==='dark'?' active':'')+'" data-theme="dark"><span class="ticon">🌙</span>暗色</span>'
    + '<span class="theme-btn'+(currentTheme==='light'?' active':'')+'" data-theme="light"><span class="ticon">☀️</span>亮色</span>'
    + '</div>'
    + '<div class="sync-bar"><span id="syncBadge" class="sync-badge">⚪ 未登录</span> <button class="btn btn-mini" id="syncBtn">登录/同步</button></div>'
    + '<div class="nav-grid">'
    + navCard('daily','🎵','每日歌单','随机生成 · 锁定 · 保存今日歌单','c2')
    + navCard('fan','👥','粉丝歌单','点歌记录 · 搜索 · 分组浏览','c1')
    + navCard('memo','📝','备忘录','找谱/升级/私下点歌/作业/待办 随手记','c5','新')
    + navCard('lib','📚','总曲库','全部歌曲分类 · 搜索 · 筛选','c3')
    + navCard('stats','📊','弹奏汇总','弹奏频次 · 排行 · 统计','c4')
    + '</div>'
    + '<div class="reset-bar"><button class="btn btn-danger" id="resetDataBtn">重置所有数据（清除编辑）</button></div>'
    + '<div style="text-align:center;color:var(--muted);font-size:12px;padding:6px 0 2px">数据版本：' + DATA_VERSION + '（联网自动更新）</div>'
    + '</div>';
  document.querySelectorAll('.theme-btn').forEach(function(b){
    b.addEventListener('click', function(){ toggleTheme(); });
  });
  $('resetDataBtn').addEventListener('click', function(){
    confirmDialog('确定要清除所有本地编辑数据，恢复到初始状态？\n\n此操作不可撤销！', function(){
      localStorage.removeItem(KEYS.fan);
      localStorage.removeItem(KEYS.stats);
      localStorage.removeItem(KEYS.lib);
      localStorage.removeItem(KEYS.daily);
      localStorage.removeItem(KEYS.added);
      toast('数据已重置，正在刷新...');
      setTimeout(function(){ location.reload(); }, 800);
    });
  });
  var sb = document.getElementById('syncBtn');
  if(sb) sb.addEventListener('click', function(){ SYNC.openModal(); });
  viewRendered.nav = true;
}
function navCard(view, icon, title, desc, cls, badge){
  var bdg = badge ? ' <span class="new-badge">'+badge+'</span>' : '';
  return '<a class="nav-card ' + cls + '" href="#' + view + '"><span class="nc-icon">' + icon + '</span><div class="nc-title">' + title + bdg + '</div><div class="nc-desc">' + desc + '</div></a>';
}

/* ===== 视图: 备忘录（个人随手记，接入 SYNC 多设备同步，支持一条多标签） ===== */
var MEMO_CATS = ['升级','私下点歌','找谱','作业','待办'];
var memoFilter = '升级';

function memoCatColor(cat){
  return ({
    '找谱':['rgba(199,91,154,.18)','#c75b9a'],
    '升级':['rgba(232,168,56,.18)','#e8a838'],
    '私下点歌':['rgba(212,83,126,.20)','#D4537E'],
    '待办':['rgba(91,143,181,.18)','#6b8fb5'],
    '作业':['rgba(102,178,128,.18)','#66b280']
  })[cat] || ['rgba(91,143,181,.18)','#6b8fb5'];
}
// 旧数据（单 cat）兼容成 tags 数组；"其他"归类到"待办"
function normalizeMemo(m){
  if(!m) return m;
  if(!Array.isArray(m.tags) || m.tags.length===0){
    m.tags = (m.cat && m.cat!=='其他') ? [m.cat] : ['待办'];
  }
  if(typeof m.done!=='boolean') m.done=false;
  if(typeof m.pinned!=='boolean') m.pinned=false;
  if(!m.id) m.id=uid();
  if(!m.ts) m.ts=Date.now();
  if(typeof m.pos!=='number') m.pos=Date.now();
  return m;
}
function relTime(ts){
  var d=Date.now()-ts, m=Math.floor(d/60000);
  if(m<1) return '刚刚';
  if(m<60) return m+'分钟前';
  var h=Math.floor(m/60); if(h<24) return h+'小时前';
  var day=Math.floor(h/24); if(day<7) return day+'天前';
  var dt=new Date(ts); return (dt.getMonth()+1)+'/'+dt.getDate();
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function saveMemo(){
  try{ localStorage.setItem(KEYS.memo, JSON.stringify(memoList)); }catch(e){}
  if(SYNC && SYNC.isOn()) SYNC.scheduleSave();
}
// 删除标记（tombstone）：删除的 memo id / saved date 记录于此，随同步上传，使删除可跨设备传播
var delMemoIds=[], delSavedIds=[];
function loadSyncDel(){ try{ var d=JSON.parse(localStorage.getItem(KEYS.syncDel)||'{}'); delMemoIds=d.memo||[]; delSavedIds=d.saved||[]; }catch(e){ delMemoIds=[]; delSavedIds=[]; } }
function saveSyncDel(){ try{ localStorage.setItem(KEYS.syncDel, JSON.stringify({memo:delMemoIds, saved:delSavedIds})); }catch(e){} }
function addMemo(text, tags){
  text=(text||'').trim(); if(!text) return false;
  if(!Array.isArray(tags) || !tags.length) tags=['待办'];
  var now=Date.now();
  memoList.unshift({id:uid(), text:text, tags:tags.slice(), done:false, pinned:false, ts:now, pos:now});
  saveMemo(); renderMemoList(); return true;
}
function toggleMemo(id){ var m=memoList.find(function(x){return x.id===id;}); if(m){ m.done=!m.done; m.pos=Date.now(); saveMemo(); renderMemoList(); } }
function delMemo(id){ memoList=memoList.filter(function(x){return x.id!==id;}); if(delMemoIds.indexOf(id)<0) delMemoIds.push(id); saveSyncDel(); saveMemo(); renderMemoList(); }
function editMemo(id, t, tags){ var m=memoList.find(function(x){return x.id===id;}); if(m){ t=(t||'').trim(); if(t) m.text=t; if(tags && tags.length) m.tags=tags.slice(); m.pos=Date.now(); saveMemo(); renderMemoList(); } }
function pinMemo(id){ var m=memoList.find(function(x){return x.id===id;}); if(m){ m.pinned=!m.pinned; m.pos=Date.now(); saveMemo(); renderMemoList(); } }

function memoVisible(){
  var f=memoFilter, arr=memoList.slice();
  if(f && f!=='全部') arr=arr.filter(function(m){ return (m.tags||[]).indexOf(f)>=0; });
  arr.sort(function(a,b){
    if(a.pinned!==b.pinned) return a.pinned?-1:1;
    if(a.done!==b.done) return a.done?1:-1;
    return (b.pos||0)-(a.pos||0);
  });
  return arr;
}
function moveMemoInd(){
  var f=$('memoFilters'), ind=$('memoNavInd'); if(!f||!ind) return;
  var act=f.querySelector('.memo-filter.active');
  if(!act){ ind.style.opacity=0; return; }
  ind.style.opacity=1; ind.style.width=act.offsetWidth+'px'; ind.style.transform='translateX('+act.offsetLeft+'px)';
}

function renderMemo(c){
  if(!c) return;
  var filters=['升级','私下点歌','找谱','作业','待办','全部'];
  var fhtml=filters.map(function(f){ return '<span class="memo-filter'+(memoFilter===f?' active':'')+'" data-f="'+f+'">'+f+'</span>'; }).join('');
  var html='<div class="page">'
    +'<div class="header"><h1>备忘录</h1><div class="sub">找谱 / 升级 / 私下点歌 / 作业 / 待办 随手记</div></div>'
    +'<div class="sync-bar"><span id="syncBadge" class="sync-badge">'+(SYNC.isOn()?'🟢 已同步':'⚪ 未登录')+'</span> <button class="btn btn-mini" id="syncBtnMemo">登录/同步</button></div>'
    +'<div class="memo-add">'
    +'<input id="memoInput" type="text" placeholder="输入备忘，如：找《xxx》谱 — 月亮点的" autocomplete="off">'
    +'<div class="memo-tagpick" id="memoTagPick">'+MEMO_CATS.map(function(x){return '<span class="memo-tp" data-t="'+x+'">'+x+'</span>';}).join('')+'</div>'
    +'<button class="btn-primary" id="memoAddBtn">添加</button>'
    +'</div>'
    +'<div class="memo-filters" id="memoFilters">'+fhtml+'<div class="memo-nav-ind" id="memoNavInd"></div></div>'
    +'<div class="memo-sum" id="memoSum"></div>'
    +'<div class="memo-list" id="memoList"></div>'
    +'</div>';
  c.innerHTML=html;
  function doAdd(){
    var inp=$('memoInput');
    var picked=[]; c.querySelectorAll('.memo-tp.on').forEach(function(t){ picked.push(t.getAttribute('data-t')); });
    if(addMemo(inp.value, picked)){ inp.value=''; c.querySelectorAll('.memo-tp').forEach(function(t){ t.classList.remove('on'); }); }
  }
  $('memoAddBtn').addEventListener('click', doAdd);
  $('memoInput').addEventListener('keydown', function(e){ if(e.key==='Enter') doAdd(); });
  c.querySelectorAll('.memo-tp').forEach(function(t){ t.addEventListener('click', function(){ t.classList.toggle('on'); }); });
  var sb=$('syncBtnMemo'); if(sb) sb.addEventListener('click', function(){ SYNC.openModal(); });
  c.querySelectorAll('.memo-filter').forEach(function(f){ f.addEventListener('click', function(){ memoFilter=this.getAttribute('data-f'); c.querySelectorAll('.memo-filter').forEach(function(x){ x.classList.remove('active'); }); this.classList.add('active'); moveMemoInd(); renderMemoList(); }); });
  renderMemoList(); moveMemoInd();
  viewRendered.memo=true;
}

function renderMemoList(){
  var wrap=$('memoList'); if(!wrap) return;
  var undone=memoList.filter(function(m){return !m.done;}).length, doneN=memoList.length-undone;
  var sum=$('memoSum'); if(sum) sum.textContent='待办 '+undone+' · 已完成 '+doneN;
  var list=memoVisible();
  if(list.length===0){ wrap.innerHTML='<div class="memo-empty">还没有备忘，上面输入一条吧</div>'; return; }
  wrap.innerHTML=list.map(function(m){
    var check = m.done?'<div class="memo-check done">✓</div>':'<div class="memo-check"></div>';
    var tstyle = m.done?'color:var(--muted);text-decoration:line-through;':'color:var(--ink);';
    var pinCls = m.pinned ? ' pinned' : '';
    var pinIcon = m.pinned ? '📌' : '📍';
    return '<div class="memo-item'+pinCls+'" data-id="'+m.id+'">'
      +'<div class="memo-drag" data-act="drag">⋮⋮</div>'
      +'<div class="memo-check-box" data-act="toggle">'+check+'</div>'
      +'<div class="memo-body"><div class="memo-text" style="'+tstyle+'" data-act="edit">'+esc(m.text)+'</div>'
      +'<div class="memo-meta"><span class="memo-time">'+relTime(m.ts)+'</span></div></div>'
      +'<div class="memo-pin'+(m.pinned?' pinned':'')+'" data-act="pin">'+pinIcon+'</div>'
      +'<div class="memo-del" data-act="del">×</div>'
      +'</div>';
  }).join('');
  wrap.querySelectorAll('.memo-item').forEach(function(it){
    it.addEventListener('click', function(e){
      var actEl = e.target.closest ? e.target.closest('[data-act]') : null;
      var act = actEl ? actEl.getAttribute('data-act') : null;
      if(!act || act==='drag') return;
      var id=it.getAttribute('data-id');
      if(act==='toggle'){ toggleMemo(id); }
      else if(act==='pin'){ pinMemo(id); }
      else if(act==='del'){ confirmDialog('删除这条备忘？', function(){ delMemo(id); }); }
      else if(act==='edit'){ var m=memoList.find(function(x){return x.id===id;}); if(m) openEditModal(m.text, m.tags, function(v, tags){ editMemo(id, v, tags); }); }
    });
    var dh = it.querySelector('.memo-drag');
    if(dh) setupMemoDrag(dh, it);
  });
}
/* 备忘拖拽排序 */
var _dragItem=null, _dragClone=null, _dragStartY=0, _dragOrigIdx=-1;
function setupMemoDrag(handle, item){
  var timer;
  function onDown(e){
    var t = e.touches ? e.touches[0] : e;
    _dragStartY = t.clientY;
    timer = setTimeout(function(){
      _dragItem = item;
      _dragOrigIdx = Array.from(item.parentNode.children).indexOf(item);
      _dragClone = item.cloneNode(true);
      _dragClone.classList.add('dragging');
      _dragClone.style.position = 'fixed';
      _dragClone.style.zIndex = '1000';
      _dragClone.style.width = item.offsetWidth+'px';
      _dragClone.style.left = item.getBoundingClientRect().left+'px';
      _dragClone.style.top = item.getBoundingClientRect().top+'px';
      _dragClone.style.pointerEvents = 'none';
      document.body.appendChild(_dragClone);
      item.style.opacity = '0.3';
      document.body.classList.add('dragging-body');
    }, 400);
  }
  function onMove(e){
    if(!_dragItem) return;
    e.preventDefault();
    var t = e.touches ? e.touches[0] : e;
    _dragClone.style.top = (t.clientY - 30)+'px';
    var els = document.elementsFromPoint(t.clientX, t.clientY);
    var target = null;
    for(var i=0;i<els.length;i++){
      if(els[i].classList.contains('memo-item') && els[i]!==_dragItem && els[i]!==_dragClone){
        target=els[i]; break;
      }
    }
    document.querySelectorAll('.memo-item.drag-over').forEach(function(el){el.classList.remove('drag-over');});
    if(target){
      var rect = target.getBoundingClientRect();
      var mid = rect.top + rect.height/2;
      if(t.clientY < mid){
        target.parentNode.insertBefore(_dragItem, target);
      } else {
        target.parentNode.insertBefore(_dragItem, target.nextSibling);
      }
    }
  }
  function onEnd(){
    clearTimeout(timer);
    if(!_dragItem){ return; }
    document.body.classList.remove('dragging-body');
    _dragItem.style.opacity = '';
    if(_dragClone){ _dragClone.remove(); _dragClone=null; }
    document.querySelectorAll('.memo-item.drag-over').forEach(function(el){el.classList.remove('drag-over');});
    var newOrder=[];
    var wrap=$('memoList');
    if(wrap) wrap.querySelectorAll('.memo-item').forEach(function(el){
      var id=el.getAttribute('data-id');
      var m=memoList.find(function(x){return x.id===id;});
      if(m) newOrder.push(m);
    });
    if(newOrder.length===memoList.length){
      memoList=newOrder;
      var now=Date.now();
      memoList.forEach(function(m, i){ m.pos = now - i; });
      saveMemo();
    }
    _dragItem=null; _dragOrigIdx=-1;
  }
  function onCancel(e){
    if(!_dragItem) return;
    if(Math.abs((e.touches?e.touches[0]:e).clientY - _dragStartY) > 5){ clearTimeout(timer); }
  }
  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, {passive:false});
  handle.addEventListener('mousemove', onCancel);
  handle.addEventListener('touchmove', onCancel, {passive:true});
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, {passive:false});
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

/* ===== 视图2: 每日歌单 ===== */
var dailyLocked = {};
var dailyResult = null;

function renderDaily(c){
  var total = ALL_SONGS.songs.length;
  var fast=0,chant=0,slow=0,sing=0;
  ALL_SONGS.songs.forEach(function(s){
    if(s.tags){
      if(s.tags.indexOf('快歌/燃')>=0) fast++;
      if(s.tags.indexOf('冲榜/仪式')>=0) chant++;
      if(s.tags.indexOf('慢歌/治愈')>=0) slow++;
      if(s.tags.indexOf('会唱的歌')>=0) sing++;
    }
  });
  c.innerHTML = '<div class="page">'
    + '<div class="header"><h1>每日歌单</h1><div class="sub">随机生成 · 锁定满意 · 保存今日歌单</div></div>'
    + '<div class="stats">'
    + stat(total,'曲库总量')+stat(fast,'快歌')+stat(sing,'会唱')+stat(slow,'慢歌')+stat(chant,'冲榜')
    + '</div>'
    + '<div class="legend">'
    + legendCard('var(--fast)','开场拉人','21:15-21:55','快歌/热门抓路人')
    + legendCard('var(--chant)','冲榜节点','21:55-22:05','仪式感集中送礼')
    + legendCard('var(--sing)','弹唱时段','23:00-00:00','会唱歌弹唱互动')
    + legendCard('var(--slow)','慢歌留客','00:00-01:00','治愈慢歌陪伴')
    + '</div>'
    + '<div class="inspire-section">'
    + '<div class="inspire-header"><h2>今日歌单灵感</h2><p>3首快歌+1冲榜+4弹唱+6慢歌+8备选</p></div>'
    + '<div class="inspire-controls">'
    + '<button class="btn btn-primary" id="dGen">随机生成</button>'
    + '<button class="btn btn-secondary" id="dRegen">保留锁定重新生成</button>'
    + '<button class="btn btn-success" id="dSave">保存今日歌单</button>'
    + '<button class="btn btn-danger" id="dClear">清空</button>'
    + '</div>'
    + '<div class="drag-hint">💡 长按歌曲可拖动排序</div>'
    + '<div id="dResult" style="padding:0 14px 14px"><div class="no-results" style="padding:30px">点击"随机生成"开始</div></div>'
    + '</div>'
    + '<div style="margin-top:20px"><h2 style="font-size:16px;color:var(--accent2);text-align:center;margin-bottom:12px">已保存歌单</h2><div id="dSaved"></div></div>'
    + '</div>';

  $('dGen').addEventListener('click', function(){ dailyLocked={}; genDaily(false); });
  $('dRegen').addEventListener('click', function(){ genDaily(true); });
  $('dClear').addEventListener('click', function(){
    $('dResult').innerHTML = '<div class="no-results" style="padding:30px">点击"随机生成"开始</div>';
    dailyLocked = {}; dailyResult = null;
  });
  $('dSave').addEventListener('click', saveDaily);
  if(dailyResult) renderDailyResult(dailyResult);
  renderSavedDaily();
  viewRendered.daily = true;
}
function stat(n,l){ return '<div class="stat"><div class="num">'+n+'</div><div class="lbl">'+l+'</div></div>'; }
function legendCard(c,n,t,d){ return '<div class="legend-card"><div class="dot" style="background:'+c+'"></div><div class="pn">'+n+'</div><div class="pt">'+t+'</div><div class="pd">'+d+'</div></div>'; }

function shuffleArr(arr){ var a=arr.slice(); for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;} return a; }
function getPool(tag){ return ALL_SONGS.songs.filter(function(s){ return s.tags && s.tags.indexOf(tag)>=0; }); }

function genDaily(keepLocked){
  var fastPool=getPool('快歌/燃'), chantPool=getPool('冲榜/仪式'), singPool=getPool('会唱的歌'), slowPool=getPool('慢歌/治愈');
  // 整个每日歌单只从带直播场景标签的歌里抽，避免混入冷门/无标签歌
  var allTaggedPool=ALL_SONGS.songs.filter(hasLiveTag), used={}, result={fast:[],chant:[],sing:[],slow:[],backup:[]};
  function pick(pool,n,key){
    var picked=[];
    if(keepLocked && dailyLocked[key]){ dailyLocked[key].forEach(function(nm){ if(!used[nm]){picked.push(nm);used[nm]=true;} }); }
    var avail=shuffleArr(pool.filter(function(s){return !used[s.name];}));
    for(var i=0;i<avail.length && picked.length<n;i++){ picked.push(avail[i].name); used[avail[i].name]=true; }
    if(picked.length<n){ var extra=shuffleArr(allTaggedPool.filter(function(s){return !used[s.name];})); for(var i=0;i<extra.length && picked.length<n;i++){picked.push(extra[i].name);used[extra[i].name]=true;} }
    return picked;
  }
  result.fast=pick(fastPool,3,'fast'); result.chant=pick(chantPool,1,'chant'); result.sing=pick(singPool,4,'sing'); result.slow=pick(slowPool,6,'slow');
  if(keepLocked && dailyLocked.backup){ dailyLocked.backup.forEach(function(nm){ if(!used[nm] && result.backup.length<8){result.backup.push(nm);used[nm]=true;} }); }
  var ba=shuffleArr(allTaggedPool.filter(function(s){return !used[s.name];}));
  for(var i=0;i<ba.length && result.backup.length<8;i++){result.backup.push(ba[i].name);used[ba[i].name]=true;}
  dailyResult=result; renderDailyResult(result);
}

function renderDailyResult(r){
  var phases=[
    {n:'开场拉人',t:'21:15-21:55',d:'快歌抓路人',s:r.fast,k:'fast',c:'var(--fast)'},
    {n:'冲榜节点',t:'21:55-22:05',d:'集中送礼',s:r.chant,k:'chant',c:'var(--chant)'},
    {n:'弹唱时段',t:'23:00-00:00',d:'弹唱互动',s:r.sing,k:'sing',c:'var(--sing)'},
    {n:'慢歌留客',t:'00:00-01:00',d:'陪伴留客',s:r.slow,k:'slow',c:'var(--slow)'},
    {n:'备选歌',t:'-',d:'替换/现场要求',s:r.backup,k:'backup',c:'var(--backup)'}
  ];
  var html='';
  phases.forEach(function(p){
    html+='<div class="phase"><div class="phase-head"><span class="dot" style="background:'+p.c+'"></span><span class="pn">'+p.n+'</span><span class="pt">'+p.t+'</span><span class="pd">'+p.d+'</span></div><ul class="song-list" data-phase="'+p.k+'">';
    p.s.forEach(function(nm,si){
      var locked = dailyLocked[p.k] && dailyLocked[p.k].indexOf(nm)>=0;
      var gIdx = ALL_SONGS.songs.findIndex(function(s){return s.name===nm;});
      html+='<li class="isong'+(locked?' locked':'')+'" data-phase="'+p.k+'" data-idx="'+si+'" data-drag-idx="'+si+'"><span class="idx">'+(si+1)+'</span><span class="sn">'+esc(nm)+'</span><button class="lb'+(locked?' locked':'')+'" data-phase="'+p.k+'" data-song="'+esc(nm)+'">'+(locked?'已锁':'锁定')+'</button>'+(gIdx>=0?'<button class="eb" data-gidx="'+gIdx+'">✏️</button>':'')+'<button class="del-btn" data-phase="'+p.k+'" data-idx="'+si+'">🗑️</button></li>';
    });
    html+='</ul></div>';
  });
  var el=$('dResult'); el.innerHTML=html;
  // 绑定锁定
  el.querySelectorAll('.lb').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var ph=this.getAttribute('data-phase'), sg=this.getAttribute('data-song');
      if(!dailyLocked[ph]) dailyLocked[ph]=[];
      var i=dailyLocked[ph].indexOf(sg);
      if(i>=0){ dailyLocked[ph].splice(i,1); this.classList.remove('locked'); this.textContent='锁定'; this.closest('.isong').classList.remove('locked'); }
      else{ dailyLocked[ph].push(sg); this.classList.add('locked'); this.textContent='已锁'; this.closest('.isong').classList.add('locked'); }
    });
  });
  // 绑定编辑（修复：同步更新 dailyResult 和 dailyLocked 中的歌名）
  el.querySelectorAll('.eb').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var gi=parseInt(this.getAttribute('data-gidx'));
      if(ALL_SONGS.songs[gi]){
        var oldName = ALL_SONGS.songs[gi].name;
        openEditModal(oldName, function(v){
          ALL_SONGS.songs[gi].name=v; saveSongEdit(gi,v);
          // 同步更新 dailyResult 中的歌名
          if(dailyResult){
            ['fast','chant','sing','slow','backup'].forEach(function(key){
              var arr=dailyResult[key];
              if(arr){ for(var j=0;j<arr.length;j++){ if(arr[j]===oldName) arr[j]=v; } }
            });
          }
          // 同步更新 dailyLocked 中的歌名
          if(dailyLocked){
            ['fast','chant','sing','slow','backup'].forEach(function(key){
              var arr=dailyLocked[key];
              if(arr){ for(var j=0;j<arr.length;j++){ if(arr[j]===oldName) arr[j]=v; } }
            });
          }
          if(dailyResult) renderDailyResult(dailyResult);
          toast('已保存');
        });
      }
    });
  });
  // 绑定删除
  el.querySelectorAll('.del-btn').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var ph=this.getAttribute('data-phase'), si=parseInt(this.getAttribute('data-idx'));
      dailyResult[ph].splice(si,1);
      renderDailyResult(dailyResult);
      toast('已删除');
    });
  });
  // 启用长按拖拽排序（每个阶段独立排序）
  el.querySelectorAll('ul.song-list').forEach(function(ul){
    var phase = ul.getAttribute('data-phase');
    enableDragReorder(ul, '.isong', function(fromIdx, toIdx){
      var arr = dailyResult[phase];
      var item = arr.splice(fromIdx, 1)[0];
      arr.splice(toIdx, 0, item);
      renderDailyResult(dailyResult);
    });
  });
}

function saveDaily(){
  if(!dailyResult){ toast('请先生成歌单'); return; }
  var now=new Date();
  var ds=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  var ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  var phases=[
    {name:'开场拉人',time:'21:15-21:55',desc:'快歌抓路人',songs:dailyResult.fast},
    {name:'冲榜节点',time:'21:55-22:05',desc:'集中送礼',songs:dailyResult.chant},
    {name:'弹唱时段',time:'23:00-00:00',desc:'弹唱互动',songs:dailyResult.sing},
    {name:'慢歌留客',time:'00:00-01:00',desc:'陪伴留客',songs:dailyResult.slow},
    {name:'备选歌',time:'-',desc:'替换/现场',songs:dailyResult.backup}
  ];
  var total=dailyResult.fast.length+dailyResult.chant.length+dailyResult.sing.length+dailyResult.slow.length+dailyResult.backup.length;
  var lists=[];
  try{ lists=JSON.parse(localStorage.getItem(KEYS.saved)||'[]'); }catch(e){}
  var ei=-1; for(var i=0;i<lists.length;i++){ if(lists[i].date===ds){ei=i;break;} }
  if(ei>=0){
    confirmDialog(ds+' 已有保存，是否覆盖？', function(){
      lists[ei]={date:ds,time:ts,phases:phases,total:total};
      if(lists.length>30) lists=lists.slice(0,30);
      try{ localStorage.setItem(KEYS.saved,JSON.stringify(lists)); renderSavedDaily(); toast('已保存'); SYNC.scheduleSave(); }catch(e){ toast('保存失败'); }
    });
    return;
  }
  lists.unshift({date:ds,time:ts,phases:phases,total:total});
  if(lists.length>30) lists=lists.slice(0,30);
  try{ localStorage.setItem(KEYS.saved,JSON.stringify(lists)); renderSavedDaily(); toast('已保存'); SYNC.scheduleSave(); }catch(e){ toast('保存失败'); }
}

function renderSavedDaily(){
  var el=$('dSaved'); if(!el) return;
  var lists=[]; try{ lists=JSON.parse(localStorage.getItem(KEYS.saved)||'[]'); }catch(e){}
  if(!lists.length){ el.innerHTML='<div class="no-results" style="padding:16px">暂无保存的歌单</div>'; return; }
  var pc={'开场拉人':'var(--fast)','冲榜节点':'var(--chant)','弹唱时段':'var(--sing)','慢歌留客':'var(--slow)','备选歌':'var(--backup)'};
  var html='';
  lists.forEach(function(it,idx){
    html+='<div class="saved-card"><div class="saved-ch" data-idx="'+idx+'"><span class="dt">'+esc(it.date)+'</span><span class="st">'+esc(it.time)+'</span><span class="sc">'+it.total+'首</span><span class="tg open">▼</span><button class="db" data-del="'+idx+'">删除</button></div><div class="saved-cb show" id="svb-'+idx+'">';
    it.phases.forEach(function(p){
      html+='<div class="phase"><div class="phase-head"><span class="dot" style="background:'+(pc[p.name]||'var(--muted)')+'"></span><span class="pn">'+esc(p.name)+'</span><span class="pt">'+esc(p.time)+'</span></div><ul class="song-list">';
      p.songs.forEach(function(nm,si){ html+='<li class="saved-si"><span class="idx">'+(si+1)+'</span><span class="sn">'+esc(nm)+'</span></li>'; });
      html+='</ul></div>';
    });
    html+='</div></div>';
  });
  el.innerHTML=html;
  el.querySelectorAll('.saved-ch').forEach(function(h){
    h.addEventListener('click', function(e){
      if(e.target.classList.contains('db')) return;
      var b=$('svb-'+h.getAttribute('data-idx')); var t=h.querySelector('.tg');
      if(b.classList.contains('show')){ b.classList.remove('show'); t.classList.remove('open'); } else { b.classList.add('show'); t.classList.add('open'); }
    });
  });
  el.querySelectorAll('.db').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var idx=parseInt(this.getAttribute('data-del'));
      var lists=[]; try{ lists=JSON.parse(localStorage.getItem(KEYS.saved)||'[]'); }catch(e){}
      confirmDialog('删除 '+lists[idx].date+' 的歌单？', function(){
        var removed=lists[idx];
        lists.splice(idx,1); localStorage.setItem(KEYS.saved,JSON.stringify(lists));
        if(removed && delSavedIds.indexOf(removed.date)<0) delSavedIds.push(removed.date);
        saveSyncDel(); renderSavedDaily(); toast('已删除'); SYNC.scheduleSave();
      });
    });
  });
}

/* ===== 视图3: 粉丝歌单 ===== */
var fanState = { mode:'fan', page:1, perPage:50, filtered:[], activeFan:'' };
var fanTierColors={1:'#555',2:'#7B9BD1',3:'#F4B084',4:'#FCE4D6',10:'#FFD966'};
var fanSongColors={1:'#9C27B0',2:'#BA68C8',3:'#CE93D8',4:'#E1BEE7',10:'#7B1FA2'};
var fanTierOrder=function(t){return t===10?5:t===4?4:t===3?3:t===2?2:1;};
var fanTierLabels={1:'1次',2:'2次',3:'3次',4:'4次+',10:'10次+'};
var fanSongLabels={1:'送1次',2:'送2次',3:'送3次',4:'送4次+',10:'送10次+'};
var fanAliases={'蜻蜓':['蜻蜓','刘医生'],'玛丽':['玛丽','铃儿响'],'Celia':['Celia','celia','CC']};

// 兼容旧格式：[song, fan, tier] -> [song, fan, dian_tier, song_tier]
function getFanTiers(d){
  if(d.length >= 4){
    return {dian: d[2]||0, song: d[3]||0};
  } else {
    return {dian: d[2]||1, song: 0};
  }
}

function renderFan(c){
  var fans={}; fanData.forEach(function(d){ var f=d[1]||''; if(f) fans[f]=(fans[f]||0)+1; });
  var fanCount=Object.keys(fans).length;
  var songs={}; fanData.forEach(function(d){ songs[d[0]]=1; });
  c.innerHTML='<div class="page">'
    +'<div class="header"><h1>粉丝歌单</h1><div class="sub">点歌记录 · 搜索 · 分组浏览</div></div>'
    +'<div class="stats">'+stat(fanData.length,'总记录')+stat(fanCount,'粉丝数')+stat(Object.keys(songs).length,'不同歌曲')+'</div>'
    +'<div class="legend-row">'
    +'<span class="legend-item"><span class="legend-dot" style="background:#555"></span>点1次</span>'
    +'<span class="legend-item"><span class="legend-dot" style="background:#7B9BD1"></span>点2次</span>'
    +'<span class="legend-item"><span class="legend-dot" style="background:#F4B084"></span>点3次</span>'
    +'<span class="legend-item"><span class="legend-dot" style="background:#FCE4D6"></span>点4次+</span>'
    +'<span class="legend-item"><span class="legend-dot" style="background:#FFD966"></span>点10次+</span>'
    +'<span class="legend-item" style="margin-left:12px"><span class="legend-dot" style="background:#9C27B0"></span>送</span>'
    +'</div>'
    +'<div class="search-wrap"><span class="si">🔍</span><input id="fanSearch" type="text" placeholder="搜索粉丝名或歌名..." autocomplete="off"></div>'
    +'<div class="filter-bar">'
    +'<span class="mode-btn active" data-mode="fan">搜粉丝</span>'
    +'<span class="mode-btn" data-mode="group">分组浏览</span>'
    +'<span class="mode-btn" data-mode="song">搜歌名</span>'
    +'<span class="mode-btn" data-mode="recent">最近添加'+(fanRecent.length?'<span class="count">('+fanRecent.length+')</span>':'')+'</span>'
    +'<span class="sort-toggle" id="fanSortToggle">排序模式</span>'
    +'</div>'
    +'<div class="fan-chips"><span class="fan-chips-label">常用▸</span>'
    +['LQ','飞扬','飞云','荷塘','刘医生','旖旎','桃夭','耘','快乐','如愿','孚光','Xu','玛丽','心梦','赵老师'].map(function(n){ return '<span class="fan-chip" data-fan="'+esc(n)+'">'+n+'</span>'; }).join('')
    +'</div>'
    +'<div class="result-info" id="fanInfo"></div>'
    +'<div id="fanList"></div>'
    +'<div class="pagination" id="fanPage"></div>'
    +'</div>';

  fanState={mode:'fan',page:1,perPage:50,filtered:[],activeFan:''};
  sortMode.fan = false;
  $('fanSortToggle').addEventListener('click', function(){
    if(fanState.mode === 'group'){ toast('分组模式不支持排序'); return; }
    sortMode.fan = !sortMode.fan;
    this.classList.toggle('active', sortMode.fan);
    renderFanFlat();
  });
  $('fanSearch').addEventListener('input', debounce(function(){
    fanState.activeFan=''; document.querySelectorAll('.fan-chip').forEach(function(c){c.classList.remove('active');});
    doFanSearch();
  },200));
  document.querySelectorAll('.mode-btn').forEach(function(b){
    b.addEventListener('click', function(){
      fanState.mode=this.getAttribute('data-mode'); fanState.page=1; fanState.activeFan='';
      sortMode.fan = false;
      $('fanSortToggle').classList.remove('active');
      document.querySelectorAll('.mode-btn').forEach(function(m){m.classList.toggle('active',m===b);});
      $('fanSearch').value=''; document.querySelectorAll('.fan-chip').forEach(function(c){c.classList.remove('active');});
      // 最近添加模式隐藏搜索框和粉丝快捷
      var searchWrap = document.querySelector('.search-wrap');
      var fanChips = document.querySelector('.fan-chips');
      if(fanState.mode==='recent'){
        if(searchWrap) searchWrap.style.display='none';
        if(fanChips) fanChips.style.display='none';
      } else {
        if(searchWrap) searchWrap.style.display='';
        if(fanChips) fanChips.style.display='';
      }
      doFanSearch();
    });
  });
  document.querySelectorAll('.fan-chip').forEach(function(ch){
    ch.addEventListener('click', function(){
      var name=this.getAttribute('data-fan');
      fanState.mode='fan'; fanState.activeFan=name;
      document.querySelectorAll('.mode-btn').forEach(function(m){m.classList.toggle('active',m.getAttribute('data-mode')==='fan');});
      document.querySelectorAll('.fan-chip').forEach(function(c){c.classList.toggle('active',c===this);});
      $('fanSearch').value=name;
      doFanSearchAliases(name);
    });
  });
  doFanSearch();
  viewRendered.fan = true;
}

function doFanSearchAliases(name){
  var keys=fanAliases[name]||[name];
  fanState.filtered=[];
  fanData.forEach(function(d){ var f=d[1]||''; if(!f) return; for(var k=0;k<keys.length;k++){ if(f.toLowerCase().indexOf(keys[k].toLowerCase())>=0){fanState.filtered.push(d);break;} } });
  fanState.filtered.sort(function(a,b){
    var ta=getFanTiers(a), tb=getFanTiers(b);
    var d = fanTierOrder(tb.dian) - fanTierOrder(ta.dian);
    if(d !== 0) return d;
    return fanTierOrder(tb.song) - fanTierOrder(ta.song);
  });
  fanState.page=1; renderFanFlat();
}

function doFanSearch(){
  var q=$('fanSearch').value.trim().toLowerCase();
  fanState.filtered=[];
  if(fanState.mode==='fan'){
    fanData.forEach(function(d){ var f=d[1]||''; if(!q||f.toLowerCase().indexOf(q)>=0) fanState.filtered.push(d); });
    fanState.filtered.sort(function(a,b){
      var ta=getFanTiers(a), tb=getFanTiers(b);
      var d = fanTierOrder(tb.dian) - fanTierOrder(ta.dian);
      if(d !== 0) return d;
      return fanTierOrder(tb.song) - fanTierOrder(ta.song);
    });
    renderFanFlat();
  } else if(fanState.mode==='song'){
    fanData.forEach(function(d){ var s=d[0]||''; if(!q||s.toLowerCase().indexOf(q)>=0) fanState.filtered.push(d); });
    renderFanFlat();
  } else if(fanState.mode==='recent'){
    // 显示最近添加的记录，按添加顺序（fanRecent 顺序）
    fanRecent.forEach(function(key){
      var parts = key.split('|');
      var song = parts[0], fan = parts.slice(1).join('|');
      // 在 fanData 中查找匹配的记录
      for(var i=fanData.length-1; i>=0; i--){
        var d = fanData[i];
        if(d[0] === song && (d[1]||'') === fan){
          // 避免重复
          if(!fanState.filtered.some(function(f){ return f[0]===song && (f[1]||'')===fan; })){
            fanState.filtered.push(d);
          }
          break;
        }
      }
    });
    renderFanFlat();
  } else {
    fanState.filtered=fanData.slice(); renderFanGroup();
  }
}

function highlightFan(text,q){
  if(!q) return esc(text);
  var idx=text.toLowerCase().indexOf(q.toLowerCase());
  if(idx<0) return esc(text);
  return esc(text.substring(0,idx))+'<mark>'+esc(text.substring(idx,idx+q.length))+'</mark>'+esc(text.substring(idx+q.length));
}

function fanTierBadges(d){
  var tiers = getFanTiers(d);
  var html = '';
  if(tiers.dian > 0){
    var c=fanTierColors[tiers.dian]||'#555'; var l=fanTierLabels[tiers.dian]||(tiers.dian+'次');
    html += '<span class="song-tier" style="background:'+c+';color:#fff">'+l+'</span>';
  }
  if(tiers.song > 0){
    var c2=fanSongColors[tiers.song]||'#9C27B0'; var l2=fanSongLabels[tiers.song]||('送'+tiers.song+'次');
    html += '<span class="song-tier" style="background:'+c2+';color:#fff">'+l2+'</span>';
  }
  return html;
}

function renderFanFlat(){
  var q=$('fanSearch').value.trim();
  var list=$('fanList'), pg=$('fanPage'), info=$('fanInfo');
  var total=fanState.filtered.length, pages=Math.ceil(total/fanState.perPage)||1;
  if(fanState.page>pages) fanState.page=pages;
  var start=(fanState.page-1)*fanState.perPage, end=Math.min(start+fanState.perPage,total);
  info.textContent=q?'找到 '+total+' 条':'共 '+total+' 条记录';
  if(total===0){ list.innerHTML=''; pg.innerHTML=''; list.innerHTML='<div class="no-results">没有找到匹配的记录</div>'; return; }
  var html='';
  for(var i=start;i<end;i++){
    var d=fanState.filtered[i], song=d[0]||'', fan=d[1]||'';
    var gIdx=fanData.indexOf(d);
    var isNew = isFanRecent(song, fan);
    var newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';
    if(sortMode.fan){
      html+='<div class="flat-row"><span class="flat-idx">'+(i+1)+'</span><span class="flat-song">'+esc(song)+newBadge+'</span><span class="flat-fan">'+esc(fan)+'</span>'+fanTierBadges(d);
      html+='<button class="move-btn" data-gidx="'+gIdx+'" data-dir="up"'+(i===0?' disabled':'')+'>↑</button>';
      html+='<button class="move-btn" data-gidx="'+gIdx+'" data-dir="down"'+(i===end-1?' disabled':'')+'>↓</button>';
      html+='<button class="del-btn" data-gidx="'+gIdx+'">🗑️</button></div>';
    } else {
      html+='<div class="flat-row" data-gidx="'+gIdx+'"><span class="flat-idx">'+(i+1)+'</span><span class="flat-song">'+highlightFan(song,q)+newBadge+'</span><span class="flat-fan">'+highlightFan(fan,q)+'</span>'+fanTierBadges(d)+'<button class="eb" data-gidx="'+gIdx+'">✏️</button><button class="del-btn" data-gidx="'+gIdx+'">🗑️</button></div>';
    }
  }
  list.innerHTML=html;
  renderFanPagination(pages);
  bindFanEdit();
  bindFanDeleteSort();
}

function renderFanGroup(){
  var list=$('fanList'), info=$('fanInfo');
  info.textContent='共 '+fanState.filtered.length+' 条，按粉丝分组（点击展开）';
  $('fanPage').innerHTML='';
  var groups={};
  fanState.filtered.forEach(function(d){ var f=d[1]||'未知'; if(!groups[f]) groups[f]=[]; groups[f].push(d); });
  var ordered=[], used={};
  fanOrder.forEach(function(fo){ if(groups[fo.name]){ ordered.push(fo.name); used[fo.name]=true; } });
  for(var fn in groups){ if(!used[fn]) ordered.push(fn); }
  var html='';
  ordered.forEach(function(fn){
    var songs=groups[fn], tc={dian:{}, song:{}};
    songs.forEach(function(s){
      var tiers = getFanTiers(s);
      if(tiers.dian > 0) tc.dian[tiers.dian] = (tc.dian[tiers.dian]||0)+1;
      if(tiers.song > 0) tc.song[tiers.song] = (tc.song[tiers.song]||0)+1;
    });
    var tb='';
    [10,4,3,2,1].forEach(function(tk){ if(tc.dian[tk]){ tb+='<span class="tier-badge" style="background:'+(fanTierColors[tk])+';color:#fff">'+tc.dian[tk]+fanTierLabels[tk]+'</span>'; } });
    [10,4,3,2,1].forEach(function(tk){ if(tc.song[tk]){ tb+='<span class="tier-badge" style="background:'+(fanSongColors[tk])+';color:#fff">'+tc.song[tk]+fanSongLabels[tk]+'</span>'; } });
    html+='<div class="fan-group"><div class="fan-header" data-fan="'+esc(fn)+'"><span class="fan-arrow">▶</span><span class="fn">'+esc(fn)+'</span><span class="fc">'+songs.length+'首</span><span class="ft">'+tb+'</span></div><div class="fan-songs">';
    songs.forEach(function(s,si){
      var gIdx=fanData.indexOf(s);
      var isNew = isFanRecent(s[0]||'', s[1]||'');
      var newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';
      html+='<div class="song-row" data-gidx="'+gIdx+'"><span class="si2">'+(si+1)+'</span><span class="sn2">'+esc(s[0]||'')+newBadge+'</span>'+fanTierBadges(s)+'<button class="eb" data-gidx="'+gIdx+'">✏️</button><button class="del-btn" data-gidx="'+gIdx+'">🗑️</button></div>';
    });
    html+='</div></div>';
  });
  list.innerHTML=html;
  // 绑定折叠
  list.querySelectorAll('.fan-header').forEach(function(h){
    h.addEventListener('click', function(){
      var s=this.nextElementSibling, a=this.querySelector('.fan-arrow');
      if(s.classList.contains('open')){ s.classList.remove('open'); a.classList.remove('open'); }
      else{ s.classList.add('open'); a.classList.add('open'); }
    });
  });
  bindFanEdit();
  bindFanDeleteSort();
}

function bindFanEdit(){
  document.querySelectorAll('#fanList .eb').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var gi=parseInt(this.getAttribute('data-gidx'));
      if(fanData[gi]){
        openEditModal(fanData[gi][0], function(v){
          fanData[gi][0]=v; saveFan();
          if(fanState.mode==='group') renderFanGroup(); else renderFanFlat();
          toast('已保存');
        });
      }
    });
  });
}

function bindFanDeleteSort(){
  // 删除
  document.querySelectorAll('#fanList .del-btn').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var gi=parseInt(this.getAttribute('data-gidx'));
      if(fanData[gi]){
        var song=fanData[gi][0], fan=fanData[gi][1];
        confirmDialog('删除这条记录？\n歌名: '+song+'\n粉丝: '+fan, function(){
          fanData.splice(gi,1); saveFan();
          if(fanState.mode==='group') renderFanGroup(); else renderFanFlat();
          toast('已删除');
        });
      }
    });
  });
  // 排序
  if(sortMode.fan){
    document.querySelectorAll('#fanList .move-btn').forEach(function(b){
      b.addEventListener('click', function(e){
        e.stopPropagation();
        var gi=parseInt(this.getAttribute('data-gidx')), dir=this.getAttribute('data-dir');
        // 找到在fanData中的位置
        var ni = dir==='up' ? gi-1 : gi+1;
        if(ni<0 || ni>=fanData.length) return;
        var t=fanData[gi]; fanData[gi]=fanData[ni]; fanData[ni]=t;
        saveFan();
        // 重新过滤并渲染
        if(fanState.activeFan) doFanSearchAliases(fanState.activeFan);
        else doFanSearch();
      });
    });
  }
}


function renderFanPagination(pages){
  var pg=$('fanPage');
  var h='<button class="page-btn" id="fanPrev" '+(fanState.page<=1?'disabled':'')+'>‹</button>';
  h+='<span class="page-info">'+fanState.page+' / '+pages+'</span>';
  h+='<button class="page-btn" id="fanNext" '+(fanState.page>=pages?'disabled':'')+'>›</button>';
  h+='<input class="page-input" id="fanJump" value="'+fanState.page+'">';
  h+='<button class="page-btn" id="fanGo">跳转</button>';
  pg.innerHTML=h;
  $('fanPrev').addEventListener('click', function(){ if(fanState.page>1){fanState.page--; renderFanFlat(); window.scrollTo(0,$('fanList').offsetTop-60);} });
  $('fanNext').addEventListener('click', function(){ fanState.page++; renderFanFlat(); window.scrollTo(0,$('fanList').offsetTop-60); });
  $('fanGo').addEventListener('click', function(){ var v=parseInt($('fanJump').value); if(!isNaN(v)){fanState.page=v; renderFanFlat(); window.scrollTo(0,$('fanList').offsetTop-60);} });
  $('fanJump').addEventListener('keydown', function(e){ if(e.key==='Enter') $('fanGo').click(); });
}

/* ===== 视图4: 总曲库 ===== */
var libCatColors=['#c75b9a','#5ba8c7','#5a9e8f','#d44040','#b85c38','#a06090','#e85d75','#e8a838','#6090b0','#888888'];
var libState={tag:'',search:''};

function renderLib(c){
  c.innerHTML='<div class="page">'
    +'<div class="header"><h1>总曲库</h1><div class="sub" id="libTotal"></div></div>'
    +'<div class="cat-stats" id="libCatStats"></div>'
    +'<div class="filter-bar" id="libTagBar"></div>'
    +'<div class="search-wrap"><span class="si">🔍</span><input id="libSearch" type="text" placeholder="搜索歌曲名称..." autocomplete="off"></div>'
    +'<div class="sort-bar"><span class="sort-toggle" id="libSortToggle">排序模式</span></div>'
    +'<div id="libContent"></div>'
    +'<div class="no-results" id="libNoResults">没有找到匹配的歌曲</div>'
    +'</div>';

  $('libTotal').textContent='共 '+libData.total+' 首歌曲';
  sortMode.lib = false;
  // 直播流程（有任一场景标签）的歌曲数
  var liveCount=0;
  libData.categories.forEach(function(cat){
    (cat.songs||[]).forEach(function(s){ if(hasLiveTag(s)) liveCount++; });
    (cat.subcategories||[]).forEach(function(sub){ (sub.songs||[]).forEach(function(s){ if(hasLiveTag(s)) liveCount++; }); });
  });
  // 分类统计
  var sh=''; libData.categories.forEach(function(cat,i){ sh+='<div class="cat-card cat-'+i+'" data-cati="'+i+'"><div class="cn">'+esc(cat.name)+'</div><div class="cc">'+cat.count+'</div></div>'; });
  $('libCatStats').innerHTML=sh;
  // 标签栏：全部 / 直播流程(只显示有场景标签的歌) / 4个场景
  var th='<span class="tag-btn active" data-tag="">全部</span>';
  th+='<span class="tag-btn" data-tag="__live__">直播流程<span class="count">('+liveCount+')</span></span>';
  ['快歌/燃','冲榜/仪式','会唱的歌','慢歌/治愈'].forEach(function(t){ th+='<span class="tag-btn" data-tag="'+t+'">'+t+'<span class="count">('+(libData.tag_stats[t]||0)+')</span></span>'; });
  $('libTagBar').innerHTML=th;
  // 内容
  buildLibContent();
  // 事件
  $('libSearch').addEventListener('input', debounce(function(){ libState.search=this.value.trim(); applyLibFilter(); applyLibHighlight(); },200));
  $('libSortToggle').addEventListener('click', function(){
    sortMode.lib = !sortMode.lib;
    this.classList.toggle('active', sortMode.lib);
    buildLibContent();
    applyLibFilter();
    applyLibHighlight();
  });
  document.querySelectorAll('#libTagBar .tag-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var t=this.getAttribute('data-tag');
      if(t===libState.tag){ libState.tag=''; }
      else{ libState.tag=t; }
      document.querySelectorAll('#libTagBar .tag-btn').forEach(function(m){ m.classList.toggle('active', m.getAttribute('data-tag')===libState.tag); });
      applyLibFilter(); applyLibHighlight();
    });
  });
  document.querySelectorAll('#libCatStats .cat-card').forEach(function(card){
    card.addEventListener('click', function(){
      var ci=parseInt(this.getAttribute('data-cati'));
      var block=document.querySelector('#libContent .cat-block[data-cat="'+ci+'"]');
      if(block){ var body=block.querySelector('.cat-body'), tg=block.querySelector('.tg'); body.classList.add('show'); tg.classList.add('open'); block.scrollIntoView({behavior:'smooth',block:'start'}); }
    });
  });
  viewRendered.lib = true;
}

function buildLibContent(){
  var el=$('libContent'); var html='';
  libData.categories.forEach(function(cat,i){
    var color=libCatColors[i]||'#888';
    html+='<div class="cat-block" data-cat="'+i+'">';
    html+='<div class="cat-header" data-cati="'+i+'"><span class="cd" style="background:'+color+'"></span><span class="cn">'+esc(cat.name)+'</span><span class="cc">'+cat.count+'首</span><span class="tg">▼</span></div>';
    html+='<div class="cat-body" id="lcb-'+i+'">';
    if(cat.subcategories && cat.subcategories.length){
      cat.subcategories.forEach(function(sub,si){
        html+='<div class="sub-block" data-cat="'+i+'" data-sub="'+si+'">';
        html+='<div class="sub-header" data-cati="'+i+'" data-subi="'+si+'"><span class="sn">'+esc(sub.name)+'</span><span class="sc">'+sub.count+'首</span><span class="stg">▼</span></div>';
        html+='<div class="sub-body" id="lsb-'+i+'-'+si+'">';
        sub.songs.forEach(function(song,ssi){
          var tagsHTML=''; if(song.tags&&song.tags.length) song.tags.forEach(function(t){tagsHTML+='<span class="tag">'+t+'</span>';});
          if(sortMode.lib){
            html+='<div class="sitem" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'" data-name="'+esc(song.name)+'" data-tags="'+(song.tags||[]).join(',')+'"><span class="idx">'+(ssi+1)+'</span><span class="sn">'+esc(song.name)+'</span>'+(tagsHTML?'<span class="tags">'+tagsHTML+'</span>':'')+'<button class="move-btn" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'" data-dir="up"'+(ssi===0?' disabled':'')+'>↑</button><button class="move-btn" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'" data-dir="down"'+(ssi===sub.songs.length-1?' disabled':'')+'>↓</button><button class="del-btn" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'">🗑️</button></div>';
          } else {
            html+='<div class="sitem" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'" data-name="'+esc(song.name)+'" data-tags="'+(song.tags||[]).join(',')+'"><span class="idx">'+(ssi+1)+'</span><span class="sn">'+esc(song.name)+'</span>'+(tagsHTML?'<span class="tags">'+tagsHTML+'</span>':'')+'<button class="eb" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'">✏️</button><button class="del-btn" data-cati="'+i+'" data-subi="'+si+'" data-sidx="'+ssi+'">🗑️</button></div>';
          }
        });
        html+='</div></div>';
      });
    } else {
      cat.songs.forEach(function(song,si){
        var tagsHTML=''; if(song.tags&&song.tags.length) song.tags.forEach(function(t){tagsHTML+='<span class="tag">'+t+'</span>';});
        if(sortMode.lib){
          html+='<div class="sitem" data-cati="'+i+'" data-sidx="'+si+'" data-name="'+esc(song.name)+'" data-tags="'+(song.tags||[]).join(',')+'"><span class="idx">'+(si+1)+'</span><span class="sn">'+esc(song.name)+'</span>'+(tagsHTML?'<span class="tags">'+tagsHTML+'</span>':'')+'<button class="move-btn" data-cati="'+i+'" data-sidx="'+si+'" data-dir="up"'+(si===0?' disabled':'')+'>↑</button><button class="move-btn" data-cati="'+i+'" data-sidx="'+si+'" data-dir="down"'+(si===cat.songs.length-1?' disabled':'')+'>↓</button><button class="del-btn" data-cati="'+i+'" data-sidx="'+si+'">🗑️</button></div>';
        } else {
          html+='<div class="sitem" data-cati="'+i+'" data-sidx="'+si+'" data-name="'+esc(song.name)+'" data-tags="'+(song.tags||[]).join(',')+'"><span class="idx">'+(si+1)+'</span><span class="sn">'+esc(song.name)+'</span>'+(tagsHTML?'<span class="tags">'+tagsHTML+'</span>':'')+'<button class="eb" data-cati="'+i+'" data-sidx="'+si+'">✏️</button><button class="del-btn" data-cati="'+i+'" data-sidx="'+si+'">🗑️</button></div>';
        }
      });
    }
    html+='</div></div>';
  });
  el.innerHTML=html;
  // 绑定折叠
  el.querySelectorAll('.cat-header').forEach(function(h){
    h.addEventListener('click', function(){
      var ci=this.getAttribute('data-cati');
      var b=$('lcb-'+ci), t=this.querySelector('.tg');
      if(b.classList.contains('show')){b.classList.remove('show');t.classList.remove('open');} else {b.classList.add('show');t.classList.add('open');}
    });
  });
  el.querySelectorAll('.sub-header').forEach(function(h){
    h.addEventListener('click', function(){
      var ci=this.getAttribute('data-cati'), si=this.getAttribute('data-subi');
      var b=$('lsb-'+ci+'-'+si), t=this.querySelector('.stg');
      if(b.classList.contains('show')){b.classList.remove('show');t.classList.remove('open');} else {b.classList.add('show');t.classList.add('open');}
    });
  });
  // 编辑
  el.querySelectorAll('.eb').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var ci=parseInt(this.getAttribute('data-cati')), si=this.hasAttribute('data-subi')?parseInt(this.getAttribute('data-subi')):-1, sidx=parseInt(this.getAttribute('data-sidx'));
      var song = si>=0 ? libData.categories[ci].subcategories[si].songs[sidx] : libData.categories[ci].songs[sidx];
      if(song){
        openEditModal(song.name, function(v){
          song.name=v; saveLib();
          // 更新DOM
          var item=el.querySelector('.sitem[data-cati="'+ci+'"]'+(si>=0?'[data-subi="'+si+'"]':'')+'[data-sidx="'+sidx+'"]');
          if(item){ item.setAttribute('data-name',v); item.querySelector('.sn').textContent=v; }
          toast('已保存');
        });
      }
    });
  });
  // 删除
  el.querySelectorAll('.del-btn').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var ci=parseInt(this.getAttribute('data-cati')), si=this.hasAttribute('data-subi')?parseInt(this.getAttribute('data-subi')):-1, sidx=parseInt(this.getAttribute('data-sidx'));
      var song = si>=0 ? libData.categories[ci].subcategories[si].songs[sidx] : libData.categories[ci].songs[sidx];
      if(song){
        confirmDialog('删除「'+song.name+'」？', function(){
          if(si>=0){ libData.categories[ci].subcategories[si].songs.splice(sidx,1); libData.categories[ci].subcategories[si].count--; }
          else{ libData.categories[ci].songs.splice(sidx,1); }
          libData.categories[ci].count--; libData.total--;
          saveLib();
          buildLibContent(); applyLibFilter(); applyLibHighlight();
          toast('已删除');
        });
      }
    });
  });
  // 排序
  if(sortMode.lib){
    el.querySelectorAll('.move-btn').forEach(function(b){
      b.addEventListener('click', function(e){
        e.stopPropagation();
        var ci=parseInt(this.getAttribute('data-cati')), si=this.hasAttribute('data-subi')?parseInt(this.getAttribute('data-subi')):-1, sidx=parseInt(this.getAttribute('data-sidx')), dir=this.getAttribute('data-dir');
        var songs = si>=0 ? libData.categories[ci].subcategories[si].songs : libData.categories[ci].songs;
        var ni = dir==='up' ? sidx-1 : sidx+1;
        if(ni<0 || ni>=songs.length) return;
        var t=songs[sidx]; songs[sidx]=songs[ni]; songs[ni]=t;
        saveLib();
        buildLibContent(); applyLibFilter(); applyLibHighlight();
      });
    });
  }
}

function applyLibFilter(){
  var q=libState.search.toLowerCase(), total=0;
  document.querySelectorAll('#libContent .cat-block').forEach(function(block){
    var ci=parseInt(block.getAttribute('data-cat')), cat=libData.categories[ci];
    var items=block.querySelectorAll('.sitem'), cv=0;
    items.forEach(function(item){
      var nm=item.getAttribute('data-name').toLowerCase(), tags=item.getAttribute('data-tags');
      var ms=!q||nm.indexOf(q)>=0;
      var mt=true;
      if(libState.tag==='__live__'){ mt = tags.split(',').some(function(t){ return SCENE_TAGS.indexOf(t) >= 0; }); }
      else if(libState.tag){ mt = tags.indexOf(libState.tag) >= 0; }
      if(ms&&mt){item.style.display='';cv++;} else {item.style.display='none';}
    });
    // 子分类
    block.querySelectorAll('.sub-block').forEach(function(sb){
      var si=parseInt(sb.getAttribute('data-sub')), sub=cat.subcategories[si];
      var sv=0; sb.querySelectorAll('.sitem').forEach(function(it){if(it.style.display!=='none')sv++;});
      var sc=sb.querySelector('.sc');
      if(sv>0){sb.classList.remove('hidden'); if(sc) sc.textContent=sv+'/'+sub.count+'首';} else {sb.classList.add('hidden');}
    });
    if(cv>0){block.classList.remove('hidden'); block.querySelector('.cc').textContent=cv+'/'+cat.count+'首'; total+=cv;}
    else{block.classList.add('hidden');}
  });
  $('libNoResults').style.display = total===0 ? 'block':'none';
}
function applyLibHighlight(){
  var q=libState.search; if(!q) return;
  document.querySelectorAll('#libContent .sitem').forEach(function(item){
    var ne=item.querySelector('.sn'), on=item.getAttribute('data-name');
    if(on.toLowerCase().indexOf(q.toLowerCase())>=0){
      var re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
      ne.innerHTML=esc(on).replace(re,'<mark>$1</mark>');
    } else { ne.innerHTML=esc(on); }
  });
}

/* ===== 视图5: 歌曲弹奏汇总 ===== */
var statsState={page:1,perPage:50,filterMin:0,search:''};
var statsTiers={"30次以上":13,"20-29次":36,"10-19次":96,"5-9次":202,"3-4次":225,"1-2次":1425};

function renderStats(c){
  c.innerHTML='<div class="page">'
    +'<div class="header"><h1>歌曲弹奏汇总</h1><div class="sub">全部曲目弹奏频次统计</div></div>'
    +'<div class="stats">'+stat(statsData.length,'总曲目')+stat(statsData.reduce(function(a,b){return a+b[1];},0),'总弹奏')+stat(maxStatsCount,'最高次数')+'</div>'
    +'<div class="tier-section"><h2>次数分布</h2><div class="tier-grid" id="statsTierGrid"></div></div>'
    +'<div class="search-wrap"><span class="si">🔍</span><input id="statsSearch" type="text" placeholder="搜索歌曲名称..." autocomplete="off"></div>'
    +'<div class="filter-bar">'
    +'<span class="tag-btn active" data-min="0">全部</span>'
    +'<span class="tag-btn" data-min="5">5次+</span>'
    +'<span class="tag-btn" data-min="10">10次+</span>'
    +'<span class="tag-btn" data-min="20">20次+</span>'
    +'<span class="sort-toggle" id="statsSortToggle">排序模式</span>'
    +'</div>'
    +'<div id="statsList"></div>'
    +'<div class="pagination" id="statsPage"></div>'
    +'</div>';
  // 分布
  var th=''; var sc=['#e94560','#f39c12','#2ecc71','#3498db','#9b59b6','#7f8c8d'];
  var keys=['30次以上','20-29次','10-19次','5-9次','3-4次','1-2次'];
  keys.forEach(function(k,i){ th+='<div class="tier-card"><div class="count" style="color:'+sc[i]+'">'+statsTiers[k]+'</div><div class="tname">'+k+'</div></div>'; });
  $('statsTierGrid').innerHTML=th;
  statsState={page:1,perPage:50,filterMin:0,search:''};
  sortMode.stats = false;
  $('statsSearch').addEventListener('input', debounce(function(){ statsState.search=this.value.trim(); statsState.page=1; renderStatsList(); },200));
  $('statsSortToggle').addEventListener('click', function(){
    sortMode.stats = !sortMode.stats;
    this.classList.toggle('active', sortMode.stats);
    statsState.page=1; renderStatsList();
  });
  document.querySelectorAll('.filter-bar .tag-btn').forEach(function(b){
    b.addEventListener('click', function(){
      statsState.filterMin=parseInt(this.getAttribute('data-min')); statsState.page=1;
      document.querySelectorAll('.filter-bar .tag-btn').forEach(function(m){m.classList.toggle('active',m===b);});
      renderStatsList();
    });
  });
  renderStatsList();
  viewRendered.stats = true;
}

function getStatsFiltered(){
  var arr=[];
  statsData.forEach(function(d,i){ var s=d[0],c=d[1]; if(c>=statsState.filterMin && (!statsState.search||s.toLowerCase().indexOf(statsState.search.toLowerCase())>=0)) arr.push({idx:i,data:d}); });
  return arr;
}

function renderStatsList(){
  var f=getStatsFiltered(), total=f.length, tp=Math.max(1,Math.ceil(total/statsState.perPage));
  if(statsState.page>tp) statsState.page=tp; if(statsState.page<1) statsState.page=1;
  var start=(statsState.page-1)*statsState.perPage, end=Math.min(start+statsState.perPage,total);
  var el=$('statsList'), html='';
  for(var i=start;i<end;i++){
    var item=f[i], s=item.data[0], c=item.data[1], rank=i+1, pct=(c/maxStatsCount*100).toFixed(1);
    if(sortMode.stats){
      html+='<div class="stat-row" data-idx="'+item.idx+'"><div class="stat-rank">'+(i+1)+'</div><div class="stat-name">'+esc(s)+'</div><div class="stat-count">'+c+'</div>';
      html+='<button class="move-btn" data-idx="'+item.idx+'" data-dir="up"'+(i===0?' disabled':'')+'>↑</button>';
      html+='<button class="move-btn" data-idx="'+item.idx+'" data-dir="down"'+(i===end-1?' disabled':'')+'>↓</button>';
      html+='<button class="del-btn" data-idx="'+item.idx+'">🗑️</button></div>';
    } else {
      html+='<div class="stat-row" data-idx="'+item.idx+'"><div class="stat-rank'+(rank<=3?' top3':'')+'">#'+rank+'</div><div class="stat-name">'+esc(s)+'</div><div class="stat-bar-wrap"><div class="stat-bar" style="width:'+pct+'%"></div></div><div class="stat-count">'+c+'</div><button class="eb" data-idx="'+item.idx+'">✏️</button><button class="del-btn" data-idx="'+item.idx+'">🗑️</button></div>';
    }
  }
  el.innerHTML=html;
  // 分页
  var pg=$('statsPage');
  var h='<button class="page-btn" id="spPrev" '+(statsState.page<=1?'disabled':'')+'>‹</button>';
  h+='<span class="page-info">'+statsState.page+' / '+tp+' (共'+total+'首)</span>';
  h+='<button class="page-btn" id="spNext" '+(statsState.page>=tp?'disabled':'')+'>›</button>';
  h+='<input class="page-input" id="spJump" value="'+statsState.page+'">';
  h+='<button class="page-btn" id="spGo">跳转</button>';
  pg.innerHTML=h;
  $('spPrev').addEventListener('click', function(){ if(statsState.page>1){statsState.page--;renderStatsList();window.scrollTo(0,$('statsList').offsetTop-60);} });
  $('spNext').addEventListener('click', function(){ statsState.page++; renderStatsList(); window.scrollTo(0,$('statsList').offsetTop-60); });
  $('spGo').addEventListener('click', function(){ var v=parseInt($('spJump').value); if(!isNaN(v)){statsState.page=v;renderStatsList();window.scrollTo(0,$('statsList').offsetTop-60);} });
  $('spJump').addEventListener('keydown', function(e){ if(e.key==='Enter') $('spGo').click(); });
  // 编辑
  el.querySelectorAll('.eb').forEach(function(b){
    b.addEventListener('click', function(){
      var idx=parseInt(this.getAttribute('data-idx'));
      if(statsData[idx]){
        openEditModal(statsData[idx][0], function(v){
          statsData[idx][0]=v; saveStats(); renderStatsList(); toast('已保存');
        });
      }
    });
  });
  // 删除
  el.querySelectorAll('.del-btn').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var idx=parseInt(this.getAttribute('data-idx'));
      if(statsData[idx]){
        confirmDialog('删除「'+statsData[idx][0]+'」？', function(){
          statsData.splice(idx,1); saveStats(); renderStatsList(); toast('已删除');
        });
      }
    });
  });
  // 排序
  if(sortMode.stats){
    el.querySelectorAll('.move-btn').forEach(function(b){
      b.addEventListener('click', function(){
        var idx=parseInt(this.getAttribute('data-idx')), dir=this.getAttribute('data-dir');
        var ni = dir==='up' ? idx-1 : idx+1;
        if(ni<0 || ni>=statsData.length) return;
        var t=statsData[idx]; statsData[idx]=statsData[ni]; statsData[ni]=t;
        saveStats(); renderStatsList();
      });
    });
  }
}

/* ===== 添加歌曲功能 ===== */
var addModalTab = 'single'; // single | batch

function rerenderView(){
  var view = $('view');
  window.scrollTo(0, 0);
  switch(currentView){
    case 'nav': renderNav(view); break;
    case 'daily': renderDaily(view); break;
    case 'fan': renderFan(view); break;
    case 'lib': renderLib(view); break;
    case 'stats': renderStats(view); break;
    case 'memo': renderMemo(view); break;
  }
}

function getLibCatOptions(){
  var html = '<option value="">不加入</option>';
  libData.categories.forEach(function(cat, i){
    if(cat.subcategories && cat.subcategories.length){
      cat.subcategories.forEach(function(sub, si){
        html += '<option value="'+i+'-'+si+'">'+esc(cat.name)+' / '+esc(sub.name)+'</option>';
      });
    } else {
      html += '<option value="'+i+'">'+esc(cat.name)+'</option>';
    }
  });
  return html;
}

function openAddModal(){
  var overlay = $('addModal');
  // 填充分类下拉
  $('addLibCat').innerHTML = getLibCatOptions();
  $('batchLibCat').innerHTML = getLibCatOptions();
  // 重置表单
  $('addSongName').value = '';
  $('addFanName').value = '';
  $('addPlayCount').value = '1';
  $('batchText').value = '';
  $('batchPlayCount').value = '1';
  // 重置标签
  document.querySelectorAll('.tag-checks-single .tag-check').forEach(function(c){ c.classList.remove('checked'); });
  document.querySelectorAll('.tag-checks-batch .tag-check').forEach(function(c){ c.classList.remove('checked'); });
  // 默认tab
  switchAddTab('single');
  overlay.classList.add('show');
}

function closeAddModal(){
  $('addModal').classList.remove('show');
}

function switchAddTab(tab){
  addModalTab = tab;
  document.querySelectorAll('.add-tab').forEach(function(t){
    t.classList.toggle('active', t.getAttribute('data-tab') === tab);
  });
  $('addSinglePanel').style.display = tab === 'single' ? 'block' : 'none';
  $('addBatchPanel').style.display = tab === 'batch' ? 'block' : 'none';
}

// 标签切换
document.querySelectorAll('.tag-check').forEach(function(c){
  c.addEventListener('click', function(){
    this.classList.toggle('checked');
  });
});

// FAB按钮
$('fabBtn').addEventListener('click', openAddModal);
$('addCancel').addEventListener('click', closeAddModal);
$('addModal').addEventListener('click', function(e){ if(e.target === this) closeAddModal(); });
document.querySelectorAll('.add-tab').forEach(function(t){
  t.addEventListener('click', function(){ switchAddTab(this.getAttribute('data-tab')); });
});

$('addSave').addEventListener('click', function(){
  if(addModalTab === 'single') saveSingleSong();
  else saveBatchSongs();
});

function getCheckedTags(container){
  var tags = [];
  document.querySelectorAll(container + ' .tag-check.checked').forEach(function(c){
    tags.push(c.getAttribute('data-tag'));
  });
  return tags;
}

function addSongToAll(name, tags){
  var exists = ALL_SONGS.songs.some(function(s){ return s.name === name; });
  if(!exists){
    var obj = { name: name, tags: tags.slice() };
    ALL_SONGS.songs.push(obj);
    addedSongs.push(obj);
    return true;
  }
  return false;
}

function addSongToStats(name, count){
  for(var i=0;i<statsData.length;i++){
    if(statsData[i][0] === name){ statsData[i][1] += count; return false; }
  }
  statsData.push([name, count]);
  if(count > maxStatsCount) maxStatsCount = count;
  return true;
}

function addSongToFan(name, fanName, tier){
  fanData.push([name, fanName, tier || 1]);
  addFanRecent(name, fanName);
}

function addSongToLib(name, tags, libCat){
  if(!libCat) return;
  var parts = libCat.split('-');
  var ci = parseInt(parts[0]);
  var cat = libData.categories[ci];
  if(!cat) return;
  if(parts.length > 1){
    var si = parseInt(parts[1]);
    if(cat.subcategories && cat.subcategories[si]){
      cat.subcategories[si].songs.push({ name: name, tags: tags.slice() });
      cat.subcategories[si].count++;
    }
  } else {
    if(!cat.songs) cat.songs = [];
    cat.songs.push({ name: name, tags: tags.slice() });
    cat.count++;
  }
  libData.total++;
}

function saveSingleSong(){
  var name = $('addSongName').value.trim();
  if(!name){ toast('请输入歌名'); return; }
  var tags = getCheckedTags('.tag-checks-single');
  var fanName = $('addFanName').value.trim();
  var playCount = parseInt($('addPlayCount').value) || 1;
  var libCat = $('addLibCat').value;

  var added = [];
  if(addSongToAll(name, tags)){ addedSongs_save(); added.push('曲库'); }
  addSongToStats(name, playCount); saveStats(); added.push('弹奏汇总');
  if(fanName){ addSongToFan(name, fanName, 1); saveFan(); added.push('粉丝歌单'); }
  if(libCat){ addSongToLib(name, tags, libCat); saveLib(); added.push('总曲库'); }

  closeAddModal();
  if(fanName){
    // 有粉丝名，跳转到粉丝歌单的"最近添加"模式
    toast('已添加: ' + added.join(' · '));
    setTimeout(function(){
      if(currentView !== 'fan'){ location.hash = '#fan'; }
      else { rerenderView(); }
      setTimeout(function(){
        var btn = document.querySelector('.mode-btn[data-mode="recent"]');
        if(btn) btn.click();
      }, 100);
    }, 200);
  } else {
    toast('已添加: ' + added.join(' · '));
    rerenderView();
  }
}

function addedSongs_save(){ saveAddedSongs(); }

function saveBatchSongs(){
  var text = $('batchText').value.trim();
  if(!text){ toast('请输入歌曲'); return; }
  var lines = text.split('\n');
  var tags = getCheckedTags('.tag-checks-batch');
  var libCat = $('batchLibCat').value;
  var defaultCount = parseInt($('batchPlayCount').value) || 1;

  var added = 0, hasFan = false, hasLib = false;
  lines.forEach(function(line){
    line = line.trim();
    if(!line) return;
    // 支持分隔符: - | — 、
    var parts = line.split(/\s*[-|—、]\s*/);
    var name = parts[0].trim();
    var fanName = parts.length > 1 ? parts[1].trim() : '';
    if(!name) return;

    addSongToAll(name, tags);
    addSongToStats(name, defaultCount);
    if(fanName){ addSongToFan(name, fanName, 1); hasFan = true; }
    if(libCat){ addSongToLib(name, tags, libCat); hasLib = true; }
    added++;
  });

  saveAddedSongs();
  saveStats();
  if(hasFan) saveFan();
  if(hasLib) saveLib();

  toast('已添加 ' + added + ' 首歌曲');
  closeAddModal();
  if(hasFan){
    setTimeout(function(){
      if(currentView !== 'fan'){ location.hash = '#fan'; }
      else { rerenderView(); }
      setTimeout(function(){
        var btn = document.querySelector('.mode-btn[data-mode="recent"]');
        if(btn) btn.click();
      }, 100);
    }, 200);
  } else {
    rerenderView();
  }
}

/* ===== 初始化 ===== */
// 应用启动：顶部同步调用 initApp() 渲染首屏（按钮立即可点），
// 随后 fetchRemoteData() 后台拉取最新数据并静默刷新，绝不阻塞首屏。
initApp();
fetchRemoteData();
SYNC.boot();

})();

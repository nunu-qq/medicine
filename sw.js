// くすり管理 Service Worker v3 - 確実通知版
const CACHE_NAME = 'kusuri-v3';

// ── インストール ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(['./','./index.html','./manifest.json']).catch(()=>{}))
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // 起動時にクライアントへスケジュール再送を要求
        return self.clients.matchAll({type:'window'}).then(clients=>{
          clients.forEach(c=>c.postMessage({type:'REQUEST_RESCHEDULE'}));
        });
      })
  );
});

// ── フェッチ（オフライン対応）──
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(()=>r))
  );
});

// ── スケジュール管理 ──
// IndexedDB代わりにSW内グローバル変数に保存（SWが生きている間有効）
let savedTimes = [];
let timers = [];

function clearTimers(){
  timers.forEach(id=>clearTimeout(id));
  timers=[];
}

function showNotif(msg){
  return self.registration.showNotification('くすり管理',{
    body: msg,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [300,100,300,100,300],
    tag: msg,
    renotify: true,
    requireInteraction: false,
  });
}

function scheduleOne(timeStr, msg){
  if(!timeStr)return;
  const[h,m]=timeStr.split(':').map(Number);
  if(isNaN(h)||isNaN(m))return;
  const now=new Date(), tgt=new Date();
  tgt.setHours(h,m,0,0);
  if(tgt<=now) tgt.setDate(tgt.getDate()+1);
  const delay=tgt-now;
  console.log(`[SW] Scheduling "${msg}" in ${Math.round(delay/60000)}min`);
  const id=setTimeout(()=>{
    showNotif(msg);
    // 翌日も繰り返す
    scheduleOne(timeStr,msg);
  }, delay);
  timers.push(id);
}

function applySchedule(times){
  clearTimers();
  savedTimes=times||[];
  console.log('[SW] Scheduling',savedTimes.length,'notifications');
  savedTimes.forEach(({time,msg})=>scheduleOne(time,msg));
}

// ── アプリからのメッセージ ──
self.addEventListener('message', e=>{
  if(!e.data)return;
  if(e.data.type==='SCHEDULE'){
    applySchedule(e.data.times);
    // 確認応答を返す
    e.source&&e.source.postMessage({type:'SCHEDULE_ACK',count:savedTimes.length});
  }
  if(e.data.type==='PING'){
    e.source&&e.source.postMessage({type:'PONG',scheduled:savedTimes.length});
  }
});

// ── 通知タップ → アプリを開く ──
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
      const app=clients.find(c=>c.url.includes('github.io')||c.url.includes('localhost'));
      if(app)return app.focus();
      return self.clients.openWindow('./');
    })
  );
});

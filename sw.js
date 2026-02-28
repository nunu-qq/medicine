// くすり管理 Service Worker v4
// Periodic Background Sync + メッセージ両対応
const CACHE_NAME = 'kusuri-v4';

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
        self.clients.matchAll({type:'window'}).then(clients=>{
          clients.forEach(c=>c.postMessage({type:'REQUEST_RESCHEDULE'}));
        });
      })
  );
});

// ── フェッチ（オフライン対応）──
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(()=>r))
  );
});

// ── 通知を出す ──
function showNotif(msg){
  return self.registration.showNotification('くすり管理', {
    body: msg,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [300, 100, 300, 100, 300],
    tag: msg,
    renotify: true,
    requireInteraction: false,
  });
}

// ── 今が通知すべき時間かチェック ──
function checkTimes(times){
  if(!times||!times.length) return;
  const now = new Date();
  const hhmm = h => `${String(h.getHours()).padStart(2,'0')}:${String(h.getMinutes()).padStart(2,'0')}`;
  const nowStr = hhmm(now);

  times.forEach(({time, msg}) => {
    if(!time) return;
    // 指定時刻の±5分以内なら通知
    const [th, tm] = time.split(':').map(Number);
    const tgtMin = th * 60 + tm;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const diff = Math.abs(nowMin - tgtMin);
    if(diff <= 5){
      console.log('[SW] Notifying:', msg, 'diff=', diff, 'min');
      showNotif(msg);
    }
  });
}

// ── インメモリのスケジュール（setTimeoutベース）──
let timers = [];
let savedTimes = [];

function clearTimers(){
  timers.forEach(id => clearTimeout(id));
  timers = [];
}

function scheduleOne(timeStr, msg){
  if(!timeStr) return;
  const [h, m] = timeStr.split(':').map(Number);
  if(isNaN(h)||isNaN(m)) return;
  const now = new Date(), tgt = new Date();
  tgt.setHours(h, m, 0, 0);
  if(tgt <= now) tgt.setDate(tgt.getDate() + 1);
  const delay = tgt - now;
  console.log('[SW] Timer set:', msg, 'in', Math.round(delay/60000), 'min');
  const id = setTimeout(() => {
    showNotif(msg);
    scheduleOne(timeStr, msg); // 翌日も繰り返す
  }, delay);
  timers.push(id);
}

function applySchedule(times){
  clearTimers();
  savedTimes = times || [];
  savedTimes.forEach(({time, msg}) => scheduleOne(time, msg));
  console.log('[SW] Schedule applied:', savedTimes.length, 'items');
}

// ── Periodic Background Sync（1時間ごとにOSが起こしてくれる）──
self.addEventListener('periodicsync', e => {
  console.log('[SW] periodicsync fired, tag:', e.tag);
  if(e.tag === 'kusuri-check'){
    e.waitUntil((async () => {
      // まずインメモリのsavedTimesをチェック
      if(savedTimes.length){
        checkTimes(savedTimes);
      }
      // タイマーを再設定（SWが再起動されてタイマーが消えた場合の保険）
      if(savedTimes.length && timers.length === 0){
        applySchedule(savedTimes);
      }
    })());
  }
});

// ── アプリからのメッセージ ──
self.addEventListener('message', e => {
  if(!e.data) return;
  if(e.data.type === 'SCHEDULE'){
    applySchedule(e.data.times);
    e.source && e.source.postMessage({type:'SCHEDULE_ACK', count:savedTimes.length});
  }
  if(e.data.type === 'PING'){
    e.source && e.source.postMessage({type:'PONG', scheduled:savedTimes.length, timers:timers.length});
  }
});

// ── 通知タップ → アプリを開く ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(clients => {
      const app = clients.find(c => c.url.includes('github.io') || c.url.includes('localhost'));
      if(app) return app.focus();
      return self.clients.openWindow('./');
    })
  );
});

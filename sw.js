// くすり管理 Service Worker v2
const CACHE_NAME = 'kusuri-v2';
const URLS_TO_CACHE = ['./','./index.html','./manifest.json'];

// ── インストール ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(URLS_TO_CACHE).catch(()=>{}))
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── フェッチ（オフライン対応）──
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── 通知スケジュール（タイマー方式）──
let timers = [];
let savedTimes = [];

function clearTimers() {
  timers.forEach(id => clearTimeout(id));
  timers = [];
}

function scheduleOne(timeStr, msg) {
  if (!timeStr) return;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return;

  const now = new Date();
  const tgt = new Date();
  tgt.setHours(h, m, 0, 0);
  if (tgt <= now) tgt.setDate(tgt.getDate() + 1);
  const delay = tgt - now;

  const id = setTimeout(() => {
    self.registration.showNotification('くすり管理', {
      body: msg,
      icon: './icon-192.png',
      vibrate: [300, 100, 300],
      tag: timeStr,
      renotify: true,
      requireInteraction: false,
    });
    // 翌日も繰り返す
    scheduleOne(timeStr, msg);
  }, delay);

  timers.push(id);
}

function applySchedule(times) {
  clearTimers();
  savedTimes = times || [];
  savedTimes.forEach(({time, msg}) => scheduleOne(time, msg));
}

// ── アプリからのメッセージ受信 ──
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE') {
    applySchedule(e.data.times);
  }

  // アプリが開いたときにも「今すぐ通知すべきか」チェック
  if (e.data.type === 'CHECK_NOW') {
    checkAndNotifyIfNeeded(e.data.times, e.data.checks);
  }
});

// ── 「今日すでに確認した時間帯は通知しない」チェック ──
function checkAndNotifyIfNeeded(times, todayChecks) {
  if (!times || !times.length) return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  times.forEach(({time, msg, medIds}) => {
    if (!time) return;
    const [h, m] = time.split(':').map(Number);
    const tgt = new Date(); tgt.setHours(h, m, 0, 0);

    // 服薬時間を過ぎていて、かつ15分以内なら通知（アプリを開いたタイミングでチェック）
    const diff = now - tgt;
    if (diff >= 0 && diff < 15 * 60 * 1000) {
      // 未チェックの薬があれば通知
      const allChecked = (medIds||[]).every(id => todayChecks && todayChecks[id]);
      if (!allChecked) {
        self.registration.showNotification('くすり管理', {
          body: msg,
          icon: './icon-192.png',
          vibrate: [300, 100, 300],
          tag: time,
          renotify: false,
        });
      }
    }
  });
}

// ── 通知タップ → アプリを開く ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(clients => {
      const focused = clients.find(c => c.url.includes('index.html') || c.url.endsWith('/'));
      if (focused) return focused.focus();
      return self.clients.openWindow('./');
    })
  );
});

// ── SW再起動時にスケジュールを復元（IndexedDBから） ──
// ※ タイマーはSW停止で消えるが、再起動時に自動で復元する
self.addEventListener('activate', e => {
  // SWが再起動されたらクライアントにスケジュール再送を依頼
  e.waitUntil(
    self.clients.matchAll({type:'window'}).then(clients => {
      clients.forEach(c => c.postMessage({type:'REQUEST_RESCHEDULE'}));
    })
  );
});

const CACHE_NAME = 'nomutore-v75'; // 更新時はここを変更

// 1. アプリ本体のファイル（確実にキャッシュする）
// ※外部URL(CDN)はここには含めないでください
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './style.css',
    './main.js',
    './constants.js',
    './store.js',
    './logic.js',
    './ui.js',
    './icon-192.png' // アイコンがあれば追加
];

// インストール処理
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(APP_SHELL);
            })
    );
});

// 古いキャッシュの削除
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// リクエスト処理（ランタイムキャッシュ戦略）
self.addEventListener('fetch', (event) => {
    // POSTメソッドやchrome-extensionスキームなどはキャッシュしない
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // 1. キャッシュにあればそれを返す
                if (cachedResponse) {
                    return cachedResponse;
                }

                // 2. キャッシュになければネットワークに取りに行く
                return fetch(event.request).then((networkResponse) => {
                    // レスポンスが正しいか確認
                    // status === 0 はCDNなどのOpaque Response（不透明なレスポンス）を許可するため
                    if (!networkResponse || (networkResponse.status !== 200 && networkResponse.status !== 0)) {
                        return networkResponse;
                    }

                    // 3. 取得できたレスポンスをキャッシュに複製して保存（次回以降のために）
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });

                    return networkResponse;
                }).catch(() => {
                    // 4. オフラインでキャッシュもなく、ネットワークも繋がらない場合
                    // 必要であればオフライン専用ページを返す処理をここに書く
                });
            })
    );

});








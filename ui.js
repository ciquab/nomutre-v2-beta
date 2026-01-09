import { APP, EXERCISE, CALORIES, SIZE_DATA, STYLE_METADATA } from './constants.js';
import { Calc } from './logic.js';
import { Store, db } from './store.js';
import dayjs from 'https://cdn.jsdelivr.net/npm/dayjs@1.11.10/+esm';
import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/+esm';

// 内部状態（直接アクセス禁止）
const _state = { 
    beerMode: 'mode1', 
    chart: null, 
    timerId: null,
    chartRange: '1w',
    isEditMode: false,
    heatmapOffset: 0,
    logLimit: 50,
    isLoadingLogs: false // 【追加】無限スクロール用フラグ
};

// 状態マネージャー
export const StateManager = {
    get beerMode() { return _state.beerMode; },
    get chart() { return _state.chart; },
    get timerId() { return _state.timerId; },
    get chartRange() { return _state.chartRange; },
    get isEditMode() { return _state.isEditMode; },
    get heatmapOffset() { return _state.heatmapOffset; },
    get logLimit() { return _state.logLimit; },
    get isLoadingLogs() { return _state.isLoadingLogs; },

    setBeerMode: (v) => { _state.beerMode = v; },
    setChart: (v) => { if(_state.chart) _state.chart.destroy(); _state.chart = v; },
    setTimerId: (v) => { _state.timerId = v; },
    setChartRange: (v) => { _state.chartRange = v; },
    setIsEditMode: (v) => { _state.isEditMode = v; }, // 名前統一 setEditMode -> setIsEditMode
    setHeatmapOffset: (v) => { _state.heatmapOffset = v; },
    
    incrementHeatmapOffset: () => { _state.heatmapOffset++; },
    decrementHeatmapOffset: () => { if(_state.heatmapOffset > 0) _state.heatmapOffset--; },
    
    // 無限スクロール用
    setLogLimit: (v) => { _state.logLimit = v; },
    incrementLogLimit: (v) => { _state.logLimit += v; },
    setLogLoading: (v) => { _state.isLoadingLogs = v; },
    
    toggleEditMode: () => { _state.isEditMode = !_state.isEditMode; return _state.isEditMode; }
};

const DOM = {
    isInitialized: false,
    elements: {}
};

const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
};

export const toggleModal = (id, show) => { 
    const el = document.getElementById(id);
    if (el) {
        if (show) {
            el.classList.remove('hidden');
            el.classList.add('flex'); // Flexboxで中央寄せするため
        } else {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    }
};

// --- 無限スクロール関連ロジック ---

// ログリスト管理のメイン関数
async function updateLogListView(isAppend = false) {
    const listContainer = document.getElementById('log-list');
    if (!listContainer) return;

    // 初回読み込み（リセット）の場合
    if (!isAppend) {
        StateManager.setLogLimit(50);
        listContainer.innerHTML = '';
        StateManager.setLogLoading(false);
    }

    if (StateManager.isLoadingLogs) return;
    StateManager.setLogLoading(true);

    try {
        // ハンドラが設定されていない場合は警告を出して中断（安全策）
        if (!UI._fetchLogsHandler) {
            console.warn("UI._fetchLogsHandler is not set. Skipping data load.");
            // 開発中はエラーに気づけるようコンソールに出す
            return;
        }

        const currentLimit = StateManager.logLimit;
        // 追加読み込みなら、前の末尾(currentLimit - 50)から取得
        const offset = isAppend ? currentLimit - 50 : 0; 
        const limit = 50;
        
        // ★修正ポイント: 
        // db.logs (Dexie) への直接依存を排除し、注入されたハンドラ経由でデータを取得
        // main.js側で { logs, totalCount } を返す関数をセットする前提となります
        const { logs, totalCount } = await UI._fetchLogsHandler(offset, limit);

        // 描画実行 (既存の renderLogList を使用)
        renderLogList(logs, isAppend);

        // センチネル（監視要素）の管理 (既存の manageInfiniteScrollSentinel を使用)
        manageInfiniteScrollSentinel(totalCount > currentLimit);

    } catch (e) {
        console.error("Log load error:", e);
    } finally {
        StateManager.setLogLoading(false);
    }
}

// 監視要素(Sentinel)の管理
function manageInfiniteScrollSentinel(hasMore) {
    const listContainer = document.getElementById('log-list');
    let sentinel = document.getElementById('log-list-sentinel');

    if (sentinel) sentinel.remove();

    if (hasMore) {
        sentinel = document.createElement('div');
        sentinel.id = 'log-list-sentinel';
        sentinel.className = "py-8 text-center text-xs text-gray-400 font-bold animate-pulse";
        sentinel.textContent = "Loading more...";
        listContainer.appendChild(sentinel);

        // IntersectionObserverの設定
        if (window.logObserver) window.logObserver.disconnect();
        
        window.logObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                StateManager.incrementLogLimit(50);
                updateLogListView(true); // 追記モードで呼ぶ
            }
        }, { rootMargin: '200px' });

        window.logObserver.observe(sentinel);
    } else {
        // 全件表示済み
        if (listContainer.children.length > 0) {
            const endMsg = document.createElement('div');
            endMsg.className = "py-8 text-center text-[10px] text-gray-300 font-bold uppercase tracking-widest";
            endMsg.textContent = "- NO MORE LOGS -";
            listContainer.appendChild(endMsg);
        }
    }
}

// ログリスト描画 (カロリー基準対応 & 追記モード対応)
function renderLogList(logs, isAppend) {
    // ★修正ポイント: DOM.elements (キャッシュ) を使用
    // ※ initDOM で 'log-list' をキャッシュ済みであることが前提
    const list = DOM.elements['log-list'] || document.getElementById('log-list');
    if (!list) return;

    // データ0件（初回）の場合のエンプティステート
    if (!isAppend && logs.length === 0) {
        list.innerHTML = `
            <div class="text-center py-10 px-4">
                <div class="text-6xl mb-4 opacity-80">🍻</div>
                <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-2">まだ記録がありません</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                    飲んだお酒を記録すると、<br>
                    借金（運動ノルマ）が発生します。<br>
                    まずは最初の一杯を記録してみましょう！
                </p>
                <button data-action="trigger-beer-modal" class="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 font-bold py-3 px-6 rounded-xl text-sm border border-indigo-100 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition">
                    👉 飲酒を記録する
                </button>
            </div>
        `;
        return;
    }

    // 現在の基準運動を取得
    const baseEx = Store.getBaseExercise();
    const baseExData = EXERCISE[baseEx] || EXERCISE['stepper'];
    
    // ヘッダーラベルの更新 (ここもキャッシュを使っても良いが、頻度が低いのでそのままDOM取得でも可。一応修正)
    const labelEl = DOM.elements['history-base-label'] || document.getElementById('history-base-label');
    if(labelEl) labelEl.textContent = `(${baseExData.icon} ${baseExData.label} 換算)`;

    // ループ外でプロフィールを取得して使い回す
    const userProfile = Store.getProfile();

    const htmlItems = logs.map(log => {
        // kcalがある場合は優先使用、なければminutes(互換)から計算
        const kcal = log.kcal !== undefined ? log.kcal : (log.minutes * Calc.burnRate(6.0, userProfile));
        const isDebt = kcal < 0;
        
        // 表示用の時間を計算
        const displayMinutes = Calc.convertKcalToMinutes(Math.abs(kcal), baseEx, userProfile);

        const typeText = isDebt ? '借金' : '返済';
        const signClass = isDebt ? 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300' : 'text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-300';
        
        // アイコン決定
        let iconChar = isDebt ? '🍺' : '🏃‍♀️';
        if (isDebt && log.style && STYLE_METADATA[log.style]) {
            iconChar = STYLE_METADATA[log.style].icon;
        } else if (!isDebt) {
             const exKey = log.exerciseKey;
             if (exKey && EXERCISE[exKey]) {
                 iconChar = EXERCISE[exKey].icon;
             } else if (log.name) {
                 const exEntry = Object.values(EXERCISE).find(e => log.name.includes(e.label));
                 if(exEntry) iconChar = exEntry.icon;
             }
        }

        const date = dayjs(log.timestamp).format('MM/DD HH:mm');
        
        let detailHtml = '';
        if (log.brewery || log.brand) {
            detailHtml += `<p class="text-xs mt-0.5"><span class="font-bold text-gray-600 dark:text-gray-400">${escapeHtml(log.brewery)||''}</span> <span class="text-gray-600 dark:text-gray-400">${escapeHtml(log.brand)||''}</span></p>`;
        }
        
        if (isDebt && (log.rating > 0 || log.memo)) {
            const stars = '★'.repeat(log.rating) + '☆'.repeat(5 - log.rating);
            const ratingDisplay = log.rating > 0 ? `<span class="text-yellow-500 text-[10px] mr-2">${stars}</span>` : '';
            const memoDisplay = log.memo ? `<span class="text-[10px] text-gray-400 dark:text-gray-500">"${escapeHtml(log.memo)}"</span>` : '';
            detailHtml += `<div class="mt-1 flex flex-wrap items-center bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">${ratingDisplay}${memoDisplay}</div>`;
        } else if (!isDebt && log.memo) {
             detailHtml += `<div class="mt-1 flex flex-wrap items-center bg-orange-50 dark:bg-orange-900/20 rounded px-2 py-1"><span class="text-[10px] text-orange-500 dark:text-orange-400 font-bold">${escapeHtml(log.memo)}</span></div>`;
        }

        const checkHidden = StateManager.isEditMode ? '' : 'hidden';
        const checkboxHtml = `<div class="edit-checkbox-area ${checkHidden} mr-3 flex-shrink-0"><input type="checkbox" class="log-checkbox w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600" value="${log.id}"></div>`;

        // 符号付き表示
        const displaySign = isDebt ? '-' : '+';

        return `<div class="log-item-row flex justify-between items-center p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 group transition-colors cursor-pointer" data-id="${log.id}">
                    <div class="flex items-center flex-grow min-w-0 pr-2">
                        ${checkboxHtml}
                        <div class="mr-3 text-2xl flex-shrink-0">${iconChar}</div> <div class="min-w-0">
                            <p class="font-semibold text-sm text-gray-800 dark:text-gray-200 truncate">${escapeHtml(log.name)}</p>
                            ${detailHtml} <p class="text-[10px] text-gray-400 mt-0.5">${date}</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2 flex-shrink-0">
                        <span class="px-2 py-1 rounded-full text-xs font-bold ${signClass} whitespace-nowrap">${typeText} ${displaySign}${displayMinutes}分</span>
                        <button data-id="${log.id}" class="delete-log-btn text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 p-1 font-bold px-2">×</button>
                    </div>
                </div>`;
    });

    if (isAppend) {
        list.insertAdjacentHTML('beforeend', htmlItems.join(''));
    } else {
        list.innerHTML = htmlItems.join('');
    }
}

// --- UI Component Renderers ---

function renderBeerTank(currentBalanceKcal) {
    // 【修正】kcalベースの描画ロジック
    const profile = Store.getProfile();
    const settings = {
        modes: Store.getModes(),
        baseExercise: Store.getBaseExercise()
    };

    const { 
        canCount, 
        displayMinutes, 
        baseExData, 
        unitKcal, 
        // displayRate, // 使っていない変数は削除
        targetStyle,
        liquidColor,
        isHazy 
    } = Calc.getTankDisplayData(currentBalanceKcal, StateManager.beerMode, settings, profile);

    // ★修正ポイント: DOM.elements (キャッシュ) を使用
    // initDOM で初期化されている前提
    const liquid = DOM.elements['tank-liquid'];
    const emptyIcon = DOM.elements['tank-empty-icon'];
    const cansText = DOM.elements['tank-cans'];
    const minText = DOM.elements['tank-minutes'];
    const msgContainer = DOM.elements['tank-message'];
    // メッセージ内のpタグは静的なので、ここだけquerySelectorしてもコストは低いが、
    // 厳密にやるならinitDOMでキャッシュすべき。今回は既存構造維持でコンテナから取得。
    const msgText = msgContainer ? msgContainer.querySelector('p') : null;

    if (!liquid || !emptyIcon || !cansText || !minText || !msgText) return;

    requestAnimationFrame(() => {
        // 液色とHazyエフェクト
        liquid.style.background = liquidColor;
        if (isHazy) {
            liquid.style.filter = 'blur(1px) brightness(1.1)';
        } else {
            liquid.style.filter = 'none';
        }

        if (currentBalanceKcal > 0) { // 貯金あり (kcal > 0)
            emptyIcon.style.opacity = '0';
            // タンクの最大容量(3本分)に対する割合
            let h = (canCount / APP.TANK_MAX_CANS) * 100;
            // 視認性確保のため、極小でも少しだけ表示する (5%〜100%)
            liquid.style.height = `${Math.max(5, Math.min(100, h))}%`;
            cansText.textContent = canCount.toFixed(1);
            
            minText.innerHTML = `+${Math.round(displayMinutes)} min <span class="text-[10px] font-normal text-gray-400">(${baseExData.icon})</span>`;
            
            // メッセージ出し分け
            if (canCount < 0.5) { 
                msgText.textContent = 'まだガマン… まずは0.5本分！😐'; 
                msgText.className = 'text-sm font-bold text-gray-500 dark:text-gray-400'; 
            }
            else if (canCount < 1.0) { 
                msgText.textContent = 'あと少しで1本分！頑張れ！🤔'; 
                msgText.className = 'text-sm font-bold text-orange-500 dark:text-orange-400'; 
            }
            else if (canCount < 2.0) { 
                msgText.textContent = `1本飲めるよ！(${targetStyle})🍺`; 
                msgText.className = 'text-sm font-bold text-green-600 dark:text-green-400'; 
            }
            else { 
                msgText.textContent = '余裕の貯金！最高だね！✨'; 
                msgText.className = 'text-sm font-bold text-green-800 dark:text-green-300'; 
            }
        } else { // 借金中 (kcal <= 0)
            liquid.style.height = '0%';
            emptyIcon.style.opacity = '1';
            cansText.textContent = "0.0";
            
            // 借金の絶対値を分換算
            minText.innerHTML = `${Math.round(Math.abs(displayMinutes))} min <span class="text-[10px] font-normal text-red-300">(${baseExData.icon})</span>`;
            minText.className = 'text-sm font-bold text-red-500 dark:text-red-400';
            
            const debtCansVal = Math.abs(canCount);

            if (debtCansVal > 1.5) {
                // 1缶分を消費するのに必要な時間
                const oneCanMin = Calc.convertKcalToMinutes(unitKcal, Store.getBaseExercise(), profile);
                msgText.textContent = `借金山積み...😱 まずは1杯分 (${oneCanMin}分) だけ返そう！`;
                msgText.className = 'text-sm font-bold text-orange-500 dark:text-orange-400 animate-pulse';
            } else {
                msgText.textContent = `枯渇中... あと${debtCansVal.toFixed(1)}本分動こう😱`;
                msgText.className = 'text-sm font-bold text-red-500 dark:text-red-400 animate-pulse';
            }
        }
    });
}

function renderLiverRank(checks, logs) {
    // ★追加: profile取得
    const profile = Store.getProfile();
    // ★修正: profileを渡す
    const gradeData = Calc.getRecentGrade(checks, logs, profile);
    
    const card = DOM.elements['liver-rank-card'] || document.getElementById('liver-rank-card');
    const title = DOM.elements['rank-title'] || document.getElementById('rank-title');
    const countEl = DOM.elements['dry-count'] || document.getElementById('dry-count');
    const bar = DOM.elements['rank-progress'] || document.getElementById('rank-progress');
    const msg = DOM.elements['rank-next-msg'] || document.getElementById('rank-next-msg');

    if(!card || !title || !countEl || !bar || !msg) return;

    card.classList.remove('hidden');

    // ダークモード用にクラスを補正
    let colorClass = gradeData.color;
    if(colorClass.includes('text-purple-600')) colorClass += ' dark:text-purple-400';
    if(colorClass.includes('text-indigo-600')) colorClass += ' dark:text-indigo-400';
    if(colorClass.includes('text-green-600'))  colorClass += ' dark:text-green-400';
    if(colorClass.includes('text-red-500'))    colorClass += ' dark:text-red-400';
    if(colorClass.includes('text-orange-500')) colorClass += ' dark:text-orange-400';

    title.className = `text-xl font-black mt-1 ${colorClass}`;
    title.textContent = `${gradeData.rank} : ${gradeData.label}`;
    
    countEl.textContent = gradeData.current;
    
    const darkBgMap = {
        'bg-orange-100': 'dark:bg-orange-900/30 dark:border-orange-800',
        'bg-indigo-100': 'dark:bg-indigo-900/30 dark:border-indigo-800',
        'bg-green-100': 'dark:bg-green-900/30 dark:border-green-800',
        'bg-gray-100': 'dark:bg-gray-700 dark:border-gray-600',
        'bg-purple-100': 'dark:bg-purple-900/30 dark:border-purple-800',
        'bg-red-50': 'dark:bg-red-900/20 dark:border-red-800'
    };
    
    const darkClasses = darkBgMap[gradeData.bg] || '';
    
    card.className = `mx-2 mt-4 mb-2 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden transition-colors ${gradeData.bg} ${darkClasses} group cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 active:scale-[0.99] transition-all`;

    requestAnimationFrame(() => {
        if (gradeData.next) {
            let percent = 0;
            if (gradeData.isRookie) {
                 percent = (gradeData.rawRate / gradeData.targetRate) * 100;
                 msg.textContent = `ランクアップまであと少し！ (現在 ${Math.round(gradeData.rawRate * 100)}%)`;
            } else {
                const prevTarget = gradeData.rank === 'A' ? 12 : (gradeData.rank === 'B' ? 8 : 0);
                const range = gradeData.next - prevTarget;
                const currentInRank = gradeData.current - prevTarget;
                percent = (currentInRank / range) * 100;
                msg.textContent = `ランクアップまであと ${gradeData.next - gradeData.current} 日`;
            }
            bar.style.width = `${Math.min(100, Math.max(5, percent))}%`;
        } else {
            bar.style.width = '100%';
            msg.textContent = '最高ランク到達！キープしよう！👑';
        }
    });
}

function renderCheckStatus(checks, logs) {
    const status = DOM.elements['check-status'] || document.getElementById('check-status');
    if(!status) return;

    const today = dayjs();
    const yest = today.subtract(1, 'day');
    
    let targetCheck = null; let type = 'none';

    if (checks.length > 0) {
        for(let i=checks.length-1; i>=0; i--) {
            const c = checks[i];
            const checkDay = dayjs(c.timestamp);
            
            if (checkDay.isSame(today, 'day')) { targetCheck = c; type = 'today'; break; }
            if (checkDay.isSame(yest, 'day')) { targetCheck = c; type = 'yesterday'; break; }
        }
    }

    if (type !== 'none') {
        const msg = getCheckMessage(targetCheck, logs);
        const title = type === 'today' ? "Today's Condition" : "Yesterday's Check";
        
        const style = type === 'today' 
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300" 
            : "bg-white dark:bg-gray-800 border-green-400 border-l-4";
        
        let weightHtml = '';
        if(targetCheck.weight) {
            weightHtml = `<span class="ml-2 text-[10px] bg-gray-100 dark:bg-gray-600 px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-300 font-bold">${targetCheck.weight}kg</span>`;
        }

        const textColor = type === 'today' ? '' : 'text-gray-800 dark:text-gray-200';

        status.innerHTML = `<div class="p-3 rounded-xl border ${style} flex justify-between items-center shadow-sm transition-colors"><div class="flex items-center gap-3"><span class="text-2xl">${type==='today'?'😎':'✅'}</span><div><p class="text-[10px] opacity-70 font-bold uppercase tracking-wider">${title}</p><p class="text-sm font-bold ${textColor} flex items-center">${msg}${weightHtml}</p></div></div><button id="btn-edit-check" class="bg-white dark:bg-gray-700 bg-opacity-50 hover:bg-opacity-100 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm border border-gray-200 dark:border-gray-600 dark:text-white">編集</button></div>`;
        
    } else {
        const lastDate = checks.length > 0 ? dayjs(checks[checks.length-1].timestamp).format('MM/DD') : 'なし';
        status.innerHTML = `<div class="p-3 rounded-xl border bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800 flex justify-between items-center shadow-sm transition-colors"><div class="flex items-center gap-3"><span class="text-2xl">👋</span><div><p class="text-[10px] opacity-70 font-bold uppercase tracking-wider">Daily Check</p><p class="text-sm font-bold">昨日の振り返りをしましょう！</p><p class="text-[10px] opacity-60">最終: ${lastDate}</p></div></div><button id="btn-record-check" class="bg-white dark:bg-gray-800 px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm border border-yellow-300 dark:border-yellow-700 animate-pulse text-yellow-800 dark:text-yellow-400">記録する</button></div>`;
    }
}

function getCheckMessage(check, logs) {
    const drank = Calc.hasAlcoholLog(logs, check.timestamp);
    if (drank || !check.isDryDay) {
        let s = 0; if (check.waistEase) s++; if (check.footLightness) s++; if (check.fiberOk) s++; if (check.waterOk) s++;
        if (s === 4) return '代謝絶好調！😆'; if (s >= 1) return `${s}/4 クリア 😐`; return '不調気味... 😰';
    } else { return (check.waistEase && check.footLightness) ? '休肝日＋絶好調！✨' : '休肝日 (体調イマイチ)🍵'; }
}

function renderWeeklyAndHeatUp(logs, checks) {
    // ★追加: profile取得
    const profile = Store.getProfile();
    // ★修正: profileを渡す
    const streak = Calc.getCurrentStreak(logs, checks, profile);
    const multiplier = Calc.getStreakMultiplier(streak);
    
    const streakEl = DOM.elements['streak-count'] || document.getElementById('streak-count');
    if(streakEl) streakEl.textContent = streak;
    
    const badge = DOM.elements['streak-badge'] || document.getElementById('streak-badge');
    if (badge) {
        if (multiplier > 1.0) {
            badge.textContent = `🔥 x${multiplier.toFixed(1)} Bonus!`;
            badge.className = "mt-1 px-2 py-0.5 bg-orange-500 rounded-full text-[10px] font-bold text-white shadow-sm animate-pulse";
        } else {
            badge.textContent = "x1.0 (Normal)";
            badge.className = "mt-1 px-2 py-0.5 bg-white dark:bg-gray-700 rounded-full text-[10px] font-bold text-gray-400 shadow-sm border border-orange-100 dark:border-gray-600";
        }
    }

    const container = DOM.elements['weekly-stamps'] || document.getElementById('weekly-stamps');
    if (!container) return;
    
    const fragment = document.createDocumentFragment();
    const today = dayjs();
    let dryCountInWeek = 0; 

    for (let i = 6; i >= 0; i--) {
        const d = today.subtract(i, 'day');
        // logic.js で判定されたステータスを取得
        const status = Calc.getDayStatus(d, logs, checks, profile);
        const isToday = i === 0;

        // ★変更: cursor-pointer, active:scale-95, hover効果を追加してクリック可能に見せる
        let elClass = "w-6 h-6 rounded-full flex items-center justify-center text-[10px] shadow-sm transition-all cursor-pointer hover:opacity-80 active:scale-95 ";
        let content = "";

        if (isToday) {
            elClass += "border-2 border-indigo-500 bg-white dark:bg-gray-700 text-indigo-500 dark:text-indigo-300 font-bold relative transform scale-110";
            content = "今";
        } 
        else if (status === 'rest' || status === 'rest_exercise') {
            elClass += "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300 border border-green-200 dark:border-green-800";
            content = "🍵";
            dryCountInWeek++;
        } 
        else if (status === 'drink_exercise_success') {
            elClass += "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800";
            content = "🏃";
        }
        else if (status === 'drink' || status === 'drink_exercise') {
            elClass += "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800";
            content = "🍺";
        } 
        else {
            elClass += "bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-500 border border-gray-200 dark:border-gray-600";
            content = "-";
        }

        const div = document.createElement('div');
        div.className = elClass;
        div.textContent = content;
        div.title = d.format('MM/DD'); 
        
        // ★追加: 日付データを属性に持たせる（クリック時に取得するため）
        div.dataset.date = d.format('YYYY-MM-DD');
        
        fragment.appendChild(div);
    }

    container.innerHTML = '';
    container.appendChild(fragment);

    const msgEl = DOM.elements['weekly-status-text'] || document.getElementById('weekly-status-text');
    if (msgEl) {
        if (dryCountInWeek >= 4) msgEl.textContent = "Excellent! 🌟";
        else if (dryCountInWeek >= 2) msgEl.textContent = "Good pace 👍";
        else msgEl.textContent = "Let's rest... 🍵";
    }
}

function renderChart(logs, checks) {
    const ctxCanvas = document.getElementById('balanceChart');
    if (!ctxCanvas || typeof Chart === 'undefined') return;
    
    // --- フィルターボタンのスタイル更新 ---
    const filters = DOM.elements['chart-filters'] || document.getElementById('chart-filters');
    if(filters) {
        filters.querySelectorAll('button').forEach(btn => {
            const isActive = btn.dataset.range === StateManager.chartRange;
            btn.className = `px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                isActive ? "active-filter bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-300 shadow-sm" 
                         : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            }`;
        });
    }

    try {
        const now = dayjs();
        let cutoffDate = StateManager.chartRange === '1w' ? now.subtract(7, 'day').valueOf() :
                         StateManager.chartRange === '1m' ? now.subtract(30, 'day').valueOf() : 0;

        const allLogsSorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
        const allChecksSorted = [...checks].sort((a, b) => a.timestamp - b.timestamp);
        
        const fullHistoryMap = new Map();
        let runningKcalBalance = 0; // kcalで管理して誤差を防ぐ
        const baseEx = Store.getBaseExercise();
        // ★追加: profile取得
        const userProfile = Store.getProfile();

        // ログの集計
        allLogsSorted.forEach(l => {
            const d = dayjs(l.timestamp);
            const k = d.format('M/D');
            
            if (!fullHistoryMap.has(k)) fullHistoryMap.set(k, {plusKcal:0, minusKcal:0, balKcal:0, weight:null, ts: l.timestamp});
            const e = fullHistoryMap.get(k);
            
            // ★修正: profileを渡す
            const kcal = l.kcal !== undefined ? l.kcal : (l.minutes * Calc.burnRate(6.0, userProfile));
            if (kcal >= 0) e.plusKcal += kcal; else e.minusKcal += kcal;
            
            runningKcalBalance += kcal;
            e.balKcal = runningKcalBalance;
        });

        // 体重データのマージ
        allChecksSorted.forEach(c => {
            const k = dayjs(c.timestamp).format('M/D');
            if (!fullHistoryMap.has(k)) {
                fullHistoryMap.set(k, {plusKcal:0, minusKcal:0, balKcal: runningKcalBalance, weight:null, ts: c.timestamp});
            }
            if (c.weight) fullHistoryMap.get(k).weight = parseFloat(c.weight);
        });

        // 表示用データ配列への変換（ここで初めて「分」に換算）
        let dataArray = Array.from(fullHistoryMap.entries()).map(([label, v]) => ({
            label,
            // ★修正: profileを渡す
            plus: Calc.convertKcalToMinutes(v.plusKcal, baseEx, userProfile),
            minus: Calc.convertKcalToMinutes(v.minusKcal, baseEx, userProfile),
            bal: Calc.convertKcalToMinutes(v.balKcal, baseEx, userProfile),
            weight: v.weight,
            ts: v.ts
        })).sort((a, b) => a.ts - b.ts);

        if (cutoffDate > 0) dataArray = dataArray.filter(d => d.ts >= cutoffDate);
        if (dataArray.length === 0) dataArray.push({label: now.format('M/D'), plus:0, minus:0, bal:0, weight:null});

        // 体重軸の最小・最大計算
        const validWeights = dataArray.map(d => d.weight).filter(w => typeof w === 'number' && !isNaN(w));
        let weightMin = 40, weightMax = 90;
        if (validWeights.length > 0) {
            weightMin = Math.floor(Math.min(...validWeights) - 2);
            weightMax = Math.ceil(Math.max(...validWeights) + 2);
        }

        if (StateManager.chart) StateManager.chart.destroy();
        
        const isDark = document.documentElement.classList.contains('dark');
        const textColor = isDark ? '#9ca3af' : '#6b7280';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

        const newChart = new Chart(ctxCanvas, {
            data: { 
                labels: dataArray.map(d => d.label), 
                datasets: [ 
                    { 
                        type: 'line', 
                        label: '体重 (kg)', 
                        data: dataArray.map(d => d.weight), 
                        borderColor: '#F59E0B', 
                        borderDash: [5, 5],
                        yAxisID: 'y1',
                        spanGaps: true,
                        order: 0 
                    },
                    { 
                        type: 'line', 
                        label: '累積残高', 
                        data: dataArray.map(d => d.bal), 
                        borderColor: '#4F46E5', 
                        tension: 0.3, 
                        fill: false, 
                        order: 1 
                    }, 
                    { 
                        type: 'bar', 
                        label: '返済', 
                        data: dataArray.map(d => d.plus), 
                        backgroundColor: '#10B981', 
                        stack: '0', 
                        order: 2 
                    }, 
                    { 
                        type: 'bar', 
                        label: '借金', 
                        data: dataArray.map(d => d.minus), 
                        backgroundColor: '#EF4444', 
                        stack: '0', 
                        order: 2 
                    } 
                ] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                scales: { 
                    x: { stacked: true }, 
                    y: { 
                        beginAtZero: true,
                        title: { display: true, text: `収支 (${baseEx}分)`, color: textColor },
                        ticks: { color: textColor },
                        grid: { color: gridColor }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: weightMin, // 動的な値を適用
                        max: weightMax, // 動的な値を適用
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: '体重 (kg)', color: textColor },
                        ticks: { color: textColor }
                    }
                }, 
                plugins: { 
                    legend: { display: true, position: 'bottom', labels: { color: textColor } } 
                } 
            }
        });
        
        StateManager.setChart(newChart);

    } catch(e) { console.error('Chart Error', e); }
}

export const UI = {
    // データ取得用ハンドラ (main.jsから注入)
    // 期待する戻り値: Promise<{ logs: Array, totalCount: Number }>
    _fetchLogsHandler: null,

    // ハンドラ設定メソッド
    setFetchLogsHandler: (fn) => {
        UI._fetchLogsHandler = fn;
    },

// 【新規】全データ取得ハンドラ設定メソッド
    setFetchAllDataHandler: (fn) => {
        UI._fetchAllDataHandler = fn;
    },

    getTodayString: () => dayjs().format('YYYY-MM-DD'),

    applyTheme: (theme) => {
        const root = document.documentElement;
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (theme === 'dark' || (theme === 'system' && isSystemDark)) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    },

    toggleDryDay: (cb) => {
        const section = document.getElementById('drinking-section');
        if (section) section.classList.toggle('hidden-area', cb.checked);
    },

    openBeerModal: (log = null, targetDate = null, isCopy = false) => {
    const dateEl = document.getElementById('beer-date');
    const styleSelect = document.getElementById('beer-select');
    const sizeSelect = document.getElementById('beer-size');
    const countInput = document.getElementById('beer-count');
    const abvInput = document.getElementById('preset-abv');
    const breweryInput = document.getElementById('beer-brewery');
    const brandInput = document.getElementById('beer-brand');
    const ratingInput = document.getElementById('beer-rating');
    const memoInput = document.getElementById('beer-memo');
    const submitBtn = document.getElementById('beer-submit-btn') || document.querySelector('#beer-form button[type="submit"]');
    
    if (submitBtn) submitBtn.id = 'beer-submit-btn';

    // モード判定: ログがあり、かつコピーモードでない場合は「更新(編集)」
    const isUpdateMode = log && !isCopy;

    // --- 日付設定 ---
    if (dateEl) {
        if (targetDate) {
            // 指定された日付（カレンダータップ時など）
            dateEl.value = targetDate;
        } else if (isUpdateMode) {
            // 既存ログの日付
            dateEl.value = dayjs(log.timestamp).format('YYYY-MM-DD');
        } else {
            // 新規・コピー時は今日
            dateEl.value = UI.getTodayString();
        }
    }

    // --- フォーム初期化 (デフォルト値) ---
    if (styleSelect) {
        const modes = Store.getModes();
        const currentMode = StateManager.beerMode; 
        const defaultStyle = currentMode === 'mode1' ? modes.mode1 : modes.mode2;
        styleSelect.value = defaultStyle || ''; 
    }
    if (sizeSelect) sizeSelect.value = '350';
    if (countInput) countInput.value = '1';
    if (abvInput) abvInput.value = '5.0';
    if (breweryInput) breweryInput.value = '';
    if (brandInput) brandInput.value = '';
    if (ratingInput) ratingInput.value = '0';
    if (memoInput) memoInput.value = '';
    
    const customAbv = document.getElementById('custom-abv');
    const customAmount = document.getElementById('custom-amount');
    if (customAbv) customAbv.value = '';
    if (customAmount) customAmount.value = '';

    // --- ボタンの表示切り替え ---
    if (submitBtn) {
        if (isUpdateMode) {
            submitBtn.textContent = '更新する';
            submitBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            submitBtn.classList.add('bg-orange-500', 'hover:bg-orange-600');
        } else {
            // 新規 または コピー
            submitBtn.textContent = '記録する';
            submitBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            submitBtn.classList.remove('bg-orange-500', 'hover:bg-orange-600');
        }
    }

    // --- データの充填 (編集 または コピー) ---
    if (log) {
        if (breweryInput) breweryInput.value = log.brewery || '';
        if (brandInput) brandInput.value = log.brand || '';
        if (ratingInput) ratingInput.value = log.rating || 0;
        if (memoInput) memoInput.value = log.memo || '';

        const isCustom = log.style === 'Custom' || log.isCustom; 

        if (isCustom) {
            UI.switchBeerInputTab('custom');
            if (customAbv) customAbv.value = log.abv || '';
            if (customAmount) customAmount.value = log.rawAmount || (parseInt(log.size) || '');
            
            const radios = document.getElementsByName('customType');
            if (log.customType) {
                radios.forEach(r => r.checked = (r.value === log.customType));
            }
        } else {
            UI.switchBeerInputTab('preset');
            if (styleSelect) styleSelect.value = log.style || '';
            if (sizeSelect) sizeSelect.value = log.size || '350';
            if (countInput) countInput.value = log.count || 1;
            if (abvInput) abvInput.value = log.abv || 5.0;
        }
    } else {
        UI.switchBeerInputTab('preset');
    }

    toggleModal('beer-modal', true);
},

    switchBeerInputTab: (mode) => {
        const presetTab = document.getElementById('tab-beer-preset');
        const customTab = document.getElementById('tab-beer-custom');
        const presetContent = document.getElementById('beer-input-preset');
        const customContent = document.getElementById('beer-input-custom');

        if (!presetTab || !customTab) return;

        const activeClass = "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-300 shadow-sm";
        const inactiveClass = "text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600";

        if (mode === 'preset') {
            presetTab.className = `flex-1 py-2 text-xs font-bold rounded-lg transition ${activeClass}`;
            customTab.className = `flex-1 py-2 text-xs font-bold rounded-lg transition ${inactiveClass}`;
            presetContent?.classList.remove('hidden');
            customContent?.classList.add('hidden');
        } else {
            customTab.className = `flex-1 py-2 text-xs font-bold rounded-lg transition ${activeClass}`;
            presetTab.className = `flex-1 py-2 text-xs font-bold rounded-lg transition ${inactiveClass}`;
            customContent?.classList.remove('hidden');
            presetContent?.classList.add('hidden');
        }
    },

    openCheckModal: (check = null, dateStr = null) => { 
        const dateEl = document.getElementById('check-date');
        const isDryCb = document.getElementById('is-dry-day');
        const form = document.getElementById('check-form');
        const submitBtn = document.getElementById('check-submit-btn') || document.querySelector('#check-form button[type="submit"]');
        if (submitBtn) submitBtn.id = 'check-submit-btn';
        
        const weightInput = document.getElementById('check-weight');

        form.reset();
        UI.toggleDryDay(isDryCb);

        if (check) {
            if (dateEl) dateEl.value = dayjs(check.timestamp).format('YYYY-MM-DD');
            if (isDryCb) {
                isDryCb.checked = check.isDryDay;
                UI.toggleDryDay(isDryCb);
            }
            if (form.elements['waistEase']) form.elements['waistEase'].checked = check.waistEase;
            if (form.elements['footLightness']) form.elements['footLightness'].checked = check.footLightness;
            if (form.elements['waterOk']) form.elements['waterOk'].checked = check.waterOk;
            if (form.elements['fiberOk']) form.elements['fiberOk'].checked = check.fiberOk;
            if (weightInput) weightInput.value = check.weight || '';

            if (submitBtn) {
                submitBtn.textContent = '更新する';
                submitBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                submitBtn.classList.add('bg-orange-500', 'hover:bg-orange-600');
            }
        } else {
            if (dateEl) dateEl.value = dateStr || UI.getTodayString();
            
            if (submitBtn) {
                submitBtn.textContent = '完了';
                submitBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                submitBtn.classList.remove('bg-orange-500', 'hover:bg-orange-600');
            }
        }

        toggleModal('check-modal', true); 
    },

    openManualInput: (log = null, isCopy = false) => { 
        const select = document.getElementById('exercise-select');
        const nameEl = DOM.elements['manual-exercise-name'];
        const dateEl = DOM.elements['manual-date'];
        const minInput = document.getElementById('manual-minutes');
        const bonusCheck = document.getElementById('manual-apply-bonus');
        const submitBtn = document.getElementById('btn-submit-manual');

        if (!select || !dateEl || !minInput || !bonusCheck || !submitBtn) return;

        if (log) {
            // logがある場合：編集またはコピー
            
            if (isCopy) {
                // 【コピーモード】
                // ボタンは「記録する」、日付は「今日」
                submitBtn.textContent = '記録する';
                submitBtn.classList.add('bg-green-500', 'hover:bg-green-600');
                submitBtn.classList.remove('bg-orange-500', 'hover:bg-orange-600');
                dateEl.value = UI.getTodayString();
            } else {
                // 【編集モード】
                // ボタンは「更新する」、日付はログの日付
                submitBtn.textContent = '更新する';
                submitBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
                submitBtn.classList.add('bg-orange-500', 'hover:bg-orange-600');
                dateEl.value = dayjs(log.timestamp).format('YYYY-MM-DD');
            }

            // --- 共通: 値の充填 ---
            minInput.value = log.rawMinutes || '';
            
            // 運動の種類を選択状態にする
            let key = log.exerciseKey;
            if (!key) {
                // 古いデータ対応: 名前から逆引き
                const logName = log.name || '';
                const entry = Object.entries(EXERCISE).find(([k, v]) => logName.includes(v.label));
                if (entry) key = entry[0];
            }
            if (key && select.querySelector(`option[value="${key}"]`)) {
                select.value = key;
            }

            // ボーナス有無の復元
            const hasBonus = log.memo && log.memo.includes('Bonus');
            bonusCheck.checked = hasBonus;

            // ラベル更新
            if (nameEl) nameEl.textContent = EXERCISE[select.value]?.label || '運動';

        } else {
            // 【新規モード】
            submitBtn.textContent = '記録する';
            submitBtn.classList.add('bg-green-500', 'hover:bg-green-600');
            submitBtn.classList.remove('bg-orange-500', 'hover:bg-orange-600');
            
            dateEl.value = UI.getTodayString();
            minInput.value = '';
            bonusCheck.checked = true; // デフォルトON
            
            const label = EXERCISE[select.value] ? EXERCISE[select.value].label : '運動';
            if (nameEl) nameEl.textContent = label; 
        }
        
        toggleModal('manual-exercise-modal', true); 
    },

    openSettings: () => {
        const p = Store.getProfile();
        const setVal = (key, val) => { if(DOM.elements[key]) DOM.elements[key].value = val; };
        
        setVal('weight-input', p.weight);
        setVal('height-input', p.height);
        setVal('age-input', p.age);
        setVal('gender-input', p.gender);
        
        const modes = Store.getModes();
        setVal('setting-mode-1', modes.mode1);
        setVal('setting-mode-2', modes.mode2);
        setVal('setting-base-exercise', Store.getBaseExercise());
        setVal('theme-input', Store.getTheme());
        setVal('setting-default-record-exercise', Store.getDefaultRecordExercise());        

        toggleModal('settings-modal', true);
    },

    openHelp: () => {
        toggleModal('help-modal', true);
    },

    updateModeSelector: () => {
        const modes = Store.getModes();
        const select = DOM.elements['home-mode-select'];
        if (!select) return;

        select.innerHTML = '';
        
        const opt1 = document.createElement('option');
        opt1.value = 'mode1';
        opt1.textContent = `${modes.mode1} 換算`;
        
        const opt2 = document.createElement('option');
        opt2.value = 'mode2';
        opt2.textContent = `${modes.mode2} 換算`;

        select.appendChild(opt1);
        select.appendChild(opt2);
        
        select.value = StateManager.beerMode;
    },

    setBeerMode: (mode) => {
        StateManager.setBeerMode(mode); 
        
        const select = DOM.elements['home-mode-select'];
        const liq = document.getElementById('tank-liquid');
        
        if (select && select.value !== mode) {
            select.value = mode;
        }

        requestAnimationFrame(() => {
            if (mode === 'mode1') {
                if(liq) { liq.classList.remove('mode2'); liq.classList.add('mode1'); }
            } else {
                if(liq) { liq.classList.remove('mode1'); liq.classList.add('mode2'); }
            }
        });
        refreshUI();
    },

    switchTab: (tabId) => {
        if (!tabId) return;
        const targetTab = document.getElementById(tabId);
        const targetNav = document.getElementById(`nav-${tabId}`);
        if (!targetTab || !targetNav) return;
    
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        targetTab.classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(el => { 
            el.classList.remove('text-indigo-600', 'dark:text-indigo-400'); 
            el.classList.add('text-gray-400', 'dark:text-gray-500'); 
        });
        targetNav.classList.remove('text-gray-400', 'dark:text-gray-500');
        targetNav.classList.add('text-indigo-600', 'dark:text-indigo-400');
        
        // 履歴タブを開いた時のみリスト更新
        if (tabId === 'tab-history') {
            updateLogListView(false); // リセットして読み込み
            refreshUI(); 
        }
        
        // スクロール位置リセット
        const resetScroll = () => {
            window.scrollTo(0, 0);
            document.body.scrollTop = 0;
            document.documentElement.scrollTop = 0;
        };
        resetScroll();
        requestAnimationFrame(() => requestAnimationFrame(resetScroll));
    },

    openLogDetail: (log) => {
        if (!DOM.elements['log-detail-modal']) return;

        // kcal基準で判定
        const isDebt = (log.kcal !== undefined ? log.kcal : log.minutes) < 0;
        
        // アイコン決定
        let iconChar = isDebt ? '🍺' : '🏃‍♀️';
        if (isDebt && log.style && STYLE_METADATA[log.style]) {
            iconChar = STYLE_METADATA[log.style].icon;
        } else if (!isDebt) {
            const exKey = log.exerciseKey;
            if (exKey && EXERCISE[exKey]) iconChar = EXERCISE[exKey].icon;
            else if (log.name) {
                const exEntry = Object.values(EXERCISE).find(e => log.name.includes(e.label));
                if(exEntry) iconChar = exEntry.icon;
            }
        }
        
        DOM.elements['detail-icon'].textContent = iconChar;
        DOM.elements['detail-title'].textContent = log.name;
        DOM.elements['detail-date'].textContent = dayjs(log.timestamp).format('YYYY/MM/DD HH:mm');
        
        const typeText = isDebt ? '借金' : '返済';
        const signClass = isDebt ? 'text-red-500' : 'text-green-500';
        
        const baseEx = Store.getBaseExercise();
        const baseExData = EXERCISE[baseEx] || EXERCISE['stepper'];
        
        const profile = Store.getProfile();
        const kcal = log.kcal !== undefined ? log.kcal : (log.minutes * Calc.burnRate(6.0, profile));
        const displayMinutes = Calc.convertKcalToMinutes(Math.abs(kcal), baseEx, profile);

        DOM.elements['detail-minutes'].innerHTML = `<span class="${signClass}">${typeText} ${displayMinutes}分</span> <span class="text-xs text-gray-400 font-normal">(${baseExData.label})</span>`;

        if (isDebt && (log.style || log.size || log.brewery || log.brand)) {
            DOM.elements['detail-beer-info'].classList.remove('hidden');
            DOM.elements['detail-style'].textContent = log.style || '-';
            const sizeLabel = SIZE_DATA[log.size] ? SIZE_DATA[log.size].label : log.size;
            DOM.elements['detail-size'].textContent = sizeLabel || '-';
            
            const brewery = log.brewery ? `[${log.brewery}] ` : '';
            const brand = log.brand || '';
            DOM.elements['detail-brand'].textContent = (brewery + brand) || '-';
        } else {
            DOM.elements['detail-beer-info'].classList.add('hidden');
        }

        if (log.memo || log.rating > 0) {
            DOM.elements['detail-memo-container'].classList.remove('hidden');
            const stars = '★'.repeat(log.rating) + '☆'.repeat(5 - log.rating);
            DOM.elements['detail-rating'].textContent = log.rating > 0 ? stars : '';
            DOM.elements['detail-memo'].textContent = log.memo || '';
        } else {
            DOM.elements['detail-memo-container'].classList.add('hidden');
        }

        // ★修正: コピーボタンの制御
        const copyBtn = DOM.elements['btn-detail-copy'] || document.getElementById('btn-detail-copy');
        if (copyBtn) {
            // 常に表示 (運動でも飲酒でもコピー可能に)
            copyBtn.classList.remove('hidden');
            
            // イベントハンドラ再設定
            copyBtn.onclick = () => {
                // 詳細モーダルを閉じる
                toggleModal('log-detail-modal', false);
                
                if (isDebt) {
                    // 飲酒ログのコピー (第3引数 true = コピーモード)
                    UI.openBeerModal(log, null, true);
                } else {
                    // 運動ログのコピー (第2引数 true = コピーモード)
                    UI.openManualInput(log, true);
                }
            };
        }

        DOM.elements['log-detail-modal'].dataset.id = log.id;

        toggleModal('log-detail-modal', true);
    },

    toggleEditMode: () => {
        const isEdit = StateManager.toggleEditMode();
        
        const btn = document.getElementById('btn-toggle-edit-mode');
        if (btn) {
            btn.textContent = isEdit ? '完了' : '編集';
            btn.className = isEdit 
                ? "text-xs font-bold text-white bg-indigo-500 px-3 py-1.5 rounded-lg transition"
                : "text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-gray-700 px-3 py-1.5 rounded-lg transition hover:bg-indigo-100 dark:hover:bg-gray-600";
        }

        const selectAllBtn = document.getElementById('btn-select-all');
        if (selectAllBtn) {
            if (isEdit) selectAllBtn.classList.remove('hidden');
            else {
                selectAllBtn.classList.add('hidden');
                selectAllBtn.textContent = '全選択'; 
            }
        }

        const bar = document.getElementById('bulk-action-bar');
        if (bar) {
            if (isEdit) bar.classList.remove('hidden');
            else bar.classList.add('hidden');
        }

        const checkboxes = document.querySelectorAll('.edit-checkbox-area');
        checkboxes.forEach(el => {
            if (isEdit) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });

        const spacer = document.getElementById('edit-spacer');
        if (spacer) {
            if (isEdit) { spacer.classList.remove('hidden'); spacer.classList.add('block'); }
            else { spacer.classList.add('hidden'); spacer.classList.remove('block'); }
        }

        if (!isEdit) {
            const inputs = document.querySelectorAll('.log-checkbox');
            inputs.forEach(i => i.checked = false);
            UI.updateBulkCount(0);
        }
    },

    toggleSelectAll: () => {
        const btn = document.getElementById('btn-select-all');
        const inputs = document.querySelectorAll('.log-checkbox');
        const isAllSelected = btn.textContent === '全解除';

        if (isAllSelected) {
            inputs.forEach(i => i.checked = false);
            btn.textContent = '全選択';
            UI.updateBulkCount(0);
        } else {
            inputs.forEach(i => i.checked = true);
            btn.textContent = '全解除';
            UI.updateBulkCount(inputs.length);
        }
    },

    updateBulkCount: (count) => {
        const el = document.getElementById('bulk-selected-count');
        if (el) el.textContent = count;
        
        const btn = document.getElementById('btn-bulk-delete');
        if (btn) {
            if (count > 0) btn.removeAttribute('disabled');
            else btn.setAttribute('disabled', 'true');
            btn.style.opacity = count > 0 ? '1' : '0.5';
        }
    },

    initDOM: () => {
    if (DOM.isInitialized) return;
    
    const ids = [
        'message-box', 'drinking-section', 
        'beer-date', 'beer-select', 'beer-size', 'beer-count',
        'beer-input-preset', 'beer-input-custom',
        'custom-abv', 'custom-amount', 
        'tab-beer-preset', 'tab-beer-custom',
        'check-date', 'check-weight', 
        'manual-exercise-name', 'manual-date', 
        'weight-input', 'height-input', 'age-input', 'gender-input',
        'setting-mode-1', 'setting-mode-2', 'setting-base-exercise', 'theme-input','setting-default-record-exercise',
        'home-mode-select', 
        'tank-liquid', 'tank-empty-icon', 'tank-cans', 'tank-minutes', 'tank-message',
        'log-list', 'history-base-label',
        'liver-rank-card', 'rank-title', 'dry-count', 'rank-progress', 'rank-next-msg',
        'check-status', 'streak-count', 'streak-badge', 'weekly-stamps', 'weekly-status-text',
        'chart-filters', 'quick-input-area', 'beer-select-mode-label',
        'tab-history', 
        'heatmap-grid',
        'log-detail-modal', 'detail-icon', 'detail-title', 'detail-date', 'detail-minutes', 
        'detail-beer-info', 'detail-style', 'detail-size', 'detail-brand', 
        'detail-memo-container', 'detail-rating', 'detail-memo',
        'btn-detail-edit', 'btn-detail-delete', 'btn-detail-copy', // ★追加: コピーボタン
        'beer-submit-btn', 'check-submit-btn',
        'btn-toggle-edit-mode', 'bulk-action-bar', 'btn-bulk-delete', 'bulk-selected-count',
        'btn-select-all', 'log-container',
        'heatmap-prev', 'heatmap-next', 'heatmap-period-label', 'btn-reset-all'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) DOM.elements[id] = el;
    });
    
    UI.injectPresetAbvInput();
    UI.injectHeatmapContainer();
    
    // イベントデリゲーションの設定
    const logListEl = document.getElementById('log-list');
    if (logListEl) {
        logListEl.addEventListener('click', (e) => {
            const triggerBtn = e.target.closest('[data-action="trigger-beer-modal"]');
            if (triggerBtn) {
                UI.openBeerModal(null);
            }
        });
    }

    // ★追加: カレンダー日付タップのイベント
    const weeklyStampsEl = DOM.elements['weekly-stamps'] || document.getElementById('weekly-stamps');
    if (weeklyStampsEl) {
        weeklyStampsEl.addEventListener('click', (e) => {
            // data-date属性を持つ要素、またはその親要素をクリックした場合
            const cell = e.target.closest('[data-date]');
            if (cell) {
                // その日付で入力モーダルを開く (新規作成モード)
                UI.openBeerModal(null, cell.dataset.date);
            }
        });
    }

    DOM.isInitialized = true;
},

    injectPresetAbvInput: () => {
        const sizeSelect = DOM.elements['beer-size'] || document.getElementById('beer-size');
        if (!sizeSelect || document.getElementById('preset-abv-container')) return;

        const container = document.createElement('div');
        container.id = 'preset-abv-container';
        container.className = "mb-4";
        container.innerHTML = `
            <label class="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">
                度数 (ABV %) <span class="text-xs font-normal text-gray-500">※変更でカロリー自動補正</span>
            </label>
            <div class="relative">
                <input type="number" id="preset-abv" step="0.1" placeholder="5.0" 
                    class="shadow-sm appearance-none border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded w-full py-3 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 transition">
                <span class="absolute right-3 top-3 text-gray-400 font-bold">%</span>
            </div>
        `;

        if(sizeSelect.parentNode && sizeSelect.parentNode.parentNode) {
             sizeSelect.parentNode.parentNode.insertBefore(container, sizeSelect.parentNode.nextSibling); 
             // 位置調整: Size/Count行の前に挿入したい場合は調整
             // ここではSize要素の親の親（grid）の前か中か...
             // 既存HTML構造: SizeとCountは .grid-cols-2 の中。
             // プリセットABVはその上に入れたい。
             const grid = sizeSelect.closest('.grid');
             if(grid) {
                 grid.parentNode.insertBefore(container, grid);
             }
        }
        DOM.elements['preset-abv'] = document.getElementById('preset-abv');
    },

    injectHeatmapContainer: () => {
        const target = document.getElementById('chart-container');
        if (!target || document.getElementById('heatmap-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'heatmap-wrapper';
        wrapper.className = "mb-6 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4";
        
        wrapper.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <h3 class="text-xs font-bold text-gray-400 uppercase tracking-wider">Continuity</h3>
                <div class="flex items-center gap-2">
                    <button id="heatmap-prev" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 active:scale-95 transition">◀</button>
                    <span id="heatmap-period-label" class="text-[10px] font-bold text-gray-500">Last 5 Weeks</span>
                    <button id="heatmap-next" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 active:scale-95 transition" disabled>▶</button>
                </div>
            </div>
            
            <div id="heatmap-grid" class="grid grid-cols-7 gap-1 mb-3"></div>

            <div class="flex flex-wrap justify-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                <div class="flex items-center"><span class="w-3 h-3 rounded-sm bg-emerald-500 mr-1"></span>休肝+運動</div>
                <div class="flex items-center"><span class="w-3 h-3 rounded-sm bg-green-400 mr-1"></span>休肝日</div>
                <div class="flex items-center"><span class="w-3 h-3 rounded-sm bg-blue-400 mr-1"></span>飲酒+運動</div>
                <div class="flex items-center"><span class="w-3 h-3 rounded-sm bg-red-400 mr-1"></span>飲酒のみ</div>
                <div class="flex items-center"><span class="w-3 h-3 rounded-sm bg-cyan-400 mr-1"></span>運動のみ</div>
            </div>
        `;

        target.parentNode.insertBefore(wrapper, target);
        DOM.elements['heatmap-grid'] = document.getElementById('heatmap-grid');
    },

    showConfetti: () => {
        const duration = 2000;
        const end = Date.now() + duration;

        (function frame() {
            confetti({
                particleCount: 5,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: ['#10B981', '#F59E0B', '#6366F1']
            });
            confetti({
                particleCount: 5,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: ['#10B981', '#F59E0B', '#6366F1']
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
    },

    showMessage: (msg, type) => {
        const mb = document.getElementById('message-box');
        if (!mb) return;
        
        mb.textContent = msg; 
        mb.className = `fixed top-4 left-1/2 transform -translate-x-1/2 p-3 text-white rounded-lg shadow-lg z-[100] text-center font-bold text-sm w-11/12 max-w-sm transition-all ${type === 'error' ? 'bg-red-500' : 'bg-green-500'}`;
        mb.classList.remove('hidden'); 
        
        setTimeout(() => mb.classList.add('hidden'), 3000);
    }
};

// --- ui.js (Part 4/4) ---
// 前回の UIオブジェクトの定義終了 }; の後に続けてください

// プリセット選択肢の更新 (main.jsからインポートされる)
export const updateBeerSelectOptions = () => {
    const s = document.getElementById('beer-select');
    if (!s) return;
    
    // 現在の選択値を保持
    const currentVal = s.value;
    s.innerHTML = '';
    
    // CALORIES.STYLESの全キーを選択肢として生成
    // (将来的にモードに応じた並び替えを行う場合はここにロジックを追加)
    Object.keys(CALORIES.STYLES).forEach(k => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = k;
        s.appendChild(o);
    });
    
    // 選択値の復元、または初期値設定
    const modes = Store.getModes();
    if (currentVal && CALORIES.STYLES[currentVal]) {
        s.value = currentVal;
    } else {
        s.value = StateManager.beerMode === 'mode1' ? modes.mode1 : modes.mode2;
    }
};

// ヒートマップ描画 (refreshUIから呼ばれる)
function renderHeatmap(checks, logs) {
    const grid = document.getElementById('heatmap-grid');
    const label = document.getElementById('heatmap-period-label');
    
    // ページネーションボタン制御
    const prevBtn = document.getElementById('heatmap-prev');
    const nextBtn = document.getElementById('heatmap-next');
    const offset = StateManager.heatmapOffset;

    if (nextBtn) {
        if (offset <= 0) {
            nextBtn.setAttribute('disabled', 'true');
            nextBtn.classList.add('opacity-30', 'cursor-not-allowed');
        } else {
            nextBtn.removeAttribute('disabled');
            nextBtn.classList.remove('opacity-30', 'cursor-not-allowed');
        }
    }

    if (!grid) return;

    // ★追加: profile取得
    const profile = Store.getProfile();

    const offsetMonth = StateManager.heatmapOffset; 
    const baseDate = dayjs().subtract(offsetMonth, 'month'); // 過去へ遡る
    const startOfMonth = baseDate.startOf('month');
    const daysInMonth = baseDate.daysInMonth();
    
    if (label) label.textContent = baseDate.format('YYYY年 M月');

    const weeks = ['日','月','火','水','木','金','土'];
    let html = '';
    weeks.forEach(w => {
        html += `<div class="text-center text-[10px] text-gray-400 font-bold py-1">${w}</div>`;
    });

    const startDay = startOfMonth.day();
    for (let i = 0; i < startDay; i++) {
        html += `<div></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const currentDay = baseDate.date(d);
        const dateStr = currentDay.format('YYYY-MM-DD');
        const isToday = currentDay.isSame(dayjs(), 'day');
        
        // ステータス取得
        // ★修正: profileを渡す
        const status = Calc.getDayStatus(currentDay, logs, checks, profile);

        // デフォルトスタイル
        let bgClass = 'bg-gray-100 dark:bg-gray-700';
        let textClass = 'text-gray-400 dark:text-gray-500';
        let icon = '';

        // ステータス別スタイル適用 (index.htmlの凡例に準拠)
        switch (status) {
            case 'rest_exercise': // 休肝+運動 (Emerald)
                bgClass = 'bg-emerald-500 border border-emerald-600 shadow-sm';
                textClass = 'text-white font-bold';
                icon = '🏃‍♀️'; // または 🍵+🏃‍♀️
                break;
            case 'rest': // 休肝日 (Green)
                bgClass = 'bg-green-400 border border-green-500 shadow-sm';
                textClass = 'text-white font-bold';
                icon = '🍵';
                break;
            // 【ここを追加】完済した場合も、青色（drink_exercise）と同じ見た目でOKだが、
            // ボーダーをゴールドにするなど「偉い！」感を出すことも可能
            case 'drink_exercise_success':
                bgClass = 'bg-blue-500 border-2 border-yellow-400 shadow-md ring-2 ring-yellow-200 dark:ring-yellow-900'; // 完済は枠線を強調！
                textClass = 'text-white font-bold';
                icon = '🏅'; // アイコンも燃やす
                break;
            case 'drink_exercise': // 飲酒+運動 (Blue)
                bgClass = 'bg-blue-400 border border-blue-500 shadow-sm';
                textClass = 'text-white font-bold';
                icon = '💦';
                break;
            case 'drink': // 飲酒のみ (Red)
                bgClass = 'bg-red-400 border border-red-500 shadow-sm';
                textClass = 'text-white font-bold';
                icon = '🍺';
                break;
            case 'exercise': // 運動のみ (Cyan)
                bgClass = 'bg-cyan-400 border border-cyan-500 shadow-sm';
                textClass = 'text-white font-bold';
                icon = '👟';
                break;
        }
        
        if (isToday) {
            bgClass += ' ring-2 ring-indigo-500 dark:ring-indigo-400 z-10';
        }

        html += `
            <div class="heatmap-cell aspect-square rounded-lg flex flex-col items-center justify-center cursor-pointer transition hover:scale-105 active:scale-95 ${bgClass}" data-date="${dateStr}">
                <span class="text-[10px] ${textClass}">${d}</span>
                ${icon ? `<span class="text-[10px] leading-none mt-0.5">${icon}</span>` : ''}
            </div>
        `;
    }

    grid.innerHTML = html;
}

// 【新規】サジェスト機能の更新
function updateInputSuggestions(logs) {
    const breweries = new Set();
    const brands = new Set();

    logs.forEach(log => {
        if (log.brewery && typeof log.brewery === 'string' && log.brewery.trim() !== '') {
            breweries.add(log.brewery.trim());
        }
        if (log.brand && typeof log.brand === 'string' && log.brand.trim() !== '') {
            brands.add(log.brand.trim());
        }
    });

    const updateList = (id, set) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        set.forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            el.appendChild(opt);
        });
    };

    updateList('brewery-list', breweries);
    updateList('brand-list', brands);
}

// 【修正】消失していた「いつもの」ボタン描画関数を復活
function renderQuickButtons(logs) {
    const container = document.getElementById('quick-input-area');
    if (!container) return;
    
    // 履歴から頻出の組み合わせを集計
    const counts = {};
    logs.forEach(l => {
        // 借金ログ（飲酒）のみ対象
        const isDebt = l.kcal !== undefined ? l.kcal < 0 : l.minutes < 0;
        if (isDebt && l.style && l.size) {
            const key = `${l.style}|${l.size}`;
            counts[key] = (counts[key] || 0) + 1;
        }
    });

    // 上位2件を抽出
    const topShortcuts = Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a])
        .slice(0, 2)
        .map(key => {
            const [style, size] = key.split('|');
            return { style, size };
        });

    if (topShortcuts.length === 0) {
        container.innerHTML = ''; 
        return;
    }

    // HTML生成
    container.innerHTML = topShortcuts.map(item => {
        const sizeLabel = SIZE_DATA[item.size] ? SIZE_DATA[item.size].label.replace(/ \(.*\)/, '') : item.size;
        // escapeHtmlはファイル内で定義されているものを使用
        const styleEsc = item.style.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
        
        return `<button data-style="${styleEsc}" data-size="${item.size}" 
            class="quick-beer-btn flex-1 bg-white dark:bg-gray-800 border border-indigo-100 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 font-bold py-3 rounded-xl shadow-sm hover:bg-indigo-50 dark:hover:bg-gray-700 text-xs flex flex-col items-center justify-center transition active:scale-95">
            <span class="mb-0.5 text-[10px] text-indigo-400 uppercase">いつもの</span>
            <span>${styleEsc}</span>
            <span class="text-[10px] opacity-70">${sizeLabel}</span>
        </button>`;
    }).join('');
}

// 画面一括更新 (main.jsから呼ばれるメイン関数)
export const refreshUI = async () => {
    // 1. データ取得 (ハンドラ経由に変更)
    if (!UI._fetchAllDataHandler) {
        console.warn("UI._fetchAllDataHandler is not set.");
        return;
    }
    
    // main.js から注入されたハンドラを実行
    const { logs, checks } = await UI._fetchAllDataHandler();
    
    // ★追加: profile取得
    const profile = Store.getProfile();

    // 2. カロリー収支計算
    // 互換性考慮: kcalがあれば使用、なければminutes(ステッパー)から換算
    const currentKcalBalance = logs.reduce((sum, l) => {
        // ★修正: profileを渡す
        const val = l.kcal !== undefined ? l.kcal : (l.minutes * Calc.burnRate(6.0, profile));
        return sum + val;
    }, 0);

    // 3. 各コンポーネントの描画
    // (Part 1, Part 2で定義した関数を呼び出し)
    renderBeerTank(currentKcalBalance);
    renderLiverRank(checks, logs);
    renderCheckStatus(checks, logs);
    renderWeeklyAndHeatUp(logs, checks);
    renderQuickButtons(logs);
    renderChart(logs, checks);
    
    // 4. ログリストのリセット (無限スクロールの頭出し)
    await updateLogListView(false);

    // 5. ヒートマップ描画
    renderHeatmap(checks, logs);

    // 6. 入力サジェスト更新 (Phase 3)
    updateInputSuggestions(logs);
};
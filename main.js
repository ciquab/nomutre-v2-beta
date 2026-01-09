import { APP, EXERCISE, SIZE_DATA, CALORIES } from './constants.js';
import { db, Store, ExternalApp } from './store.js';
import { Calc } from './logic.js';
import { UI, StateManager, updateBeerSelectOptions, refreshUI, toggleModal } from './ui.js';
import dayjs from 'https://cdn.jsdelivr.net/npm/dayjs@1.11.10/+esm';

/* ==========================================================================
   Global Error Handling
   ========================================================================== */
const showErrorOverlay = (msg, source, lineno) => {
    const overlay = document.getElementById('global-error-overlay');
    const details = document.getElementById('error-details');
    if (overlay && details) {
        const now = new Date().toLocaleString();
        const errText = `[${now}]\nMessage: ${msg}\nSource: ${source}:${lineno}\nUA: ${navigator.userAgent}`;
        details.textContent = errText;
        overlay.classList.remove('hidden');
        document.getElementById('btn-copy-error').onclick = () => {
            navigator.clipboard.writeText(errText)
                .then(() => alert('エラーログをコピーしました'))
                .catch(() => alert('コピーに失敗しました'));
        };
    }
    console.error('Global Error Caught:', msg);
};

window.onerror = function(msg, source, lineno, colno, error) {
    showErrorOverlay(msg, source, lineno);
    return false;
};

window.addEventListener('unhandledrejection', function(event) {
    showErrorOverlay(`Unhandled Promise Rejection: ${event.reason}`, 'Promise', 0);
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// constants.js の CALORIES.STYLES のキーと整合性を取った定義
const STYLE_SPECS = {
    '国産ピルスナー': { abv: 5.0, type: 'sweet' },
    '糖質オフ/新ジャンル': { abv: 4.0, type: 'dry' },
    'ピルスナー': { abv: 5.0, type: 'sweet' },
    'ドルトムンター': { abv: 5.5, type: 'sweet' },
    'シュバルツ': { abv: 5.0, type: 'sweet' },
    'ゴールデンエール': { abv: 5.0, type: 'sweet' },
    'ペールエール': { abv: 5.5, type: 'sweet' },
    'ジャパニーズエール': { abv: 5.5, type: 'sweet' },
    'ヴァイツェン': { abv: 5.0, type: 'sweet' },
    'ベルジャンホワイト': { abv: 5.0, type: 'sweet' },
    'セゾン': { abv: 6.0, type: 'sweet' },
    'セッションIPA': { abv: 4.5, type: 'sweet' },
    'IPA (West Coast)': { abv: 6.5, type: 'sweet' },
    'Hazy IPA': { abv: 7.0, type: 'sweet' },
    'Hazyペールエール': { abv: 6.0, type: 'sweet' },
    'ダブルIPA (DIPA)': { abv: 8.5, type: 'sweet' },
    'アンバーエール': { abv: 5.5, type: 'sweet' },
    'ポーター': { abv: 5.5, type: 'sweet' },
    'スタウト': { abv: 6.0, type: 'sweet' },
    'インペリアルスタウト': { abv: 9.0, type: 'sweet' },
    'ベルジャン・トリペル': { abv: 9.0, type: 'sweet' },
    'バーレイワイン': { abv: 10.0, type: 'sweet' },
    'サワーエール': { abv: 5.0, type: 'sweet' },
    'フルーツビール': { abv: 5.0, type: 'sweet' }
};

const getDateTimestamp = (dateStr) => {
    if (!dateStr) return Date.now();
    return dayjs(dateStr).startOf('day').add(12, 'hour').valueOf();
};

/* ==========================================================================
   Event Handling & App Logic
   ========================================================================== */

let editingLogId = null;
let editingCheckId = null;

const handleSaveSettings = () => {
    const w = parseFloat(document.getElementById('weight-input').value);
    const h = parseFloat(document.getElementById('height-input').value);
    const a = parseInt(document.getElementById('age-input').value);
    const g = document.getElementById('gender-input').value;
    const m1 = document.getElementById('setting-mode-1').value;
    const m2 = document.getElementById('setting-mode-2').value;
    const be = document.getElementById('setting-base-exercise').value;
    const theme = document.getElementById('theme-input').value;
    const de = document.getElementById('setting-default-record-exercise').value;
    
    if (w > 0 && h > 0 && a > 0 && m1 && m2 && be) {
        if (w > 300 || h > 300 || a > 150) {
            return UI.showMessage('入力値を確認してください', 'error');
        }

        localStorage.setItem(APP.STORAGE_KEYS.WEIGHT, w);
        localStorage.setItem(APP.STORAGE_KEYS.HEIGHT, h);
        localStorage.setItem(APP.STORAGE_KEYS.AGE, a);
        localStorage.setItem(APP.STORAGE_KEYS.GENDER, g);
        localStorage.setItem(APP.STORAGE_KEYS.MODE1, m1);
        localStorage.setItem(APP.STORAGE_KEYS.MODE2, m2);
        localStorage.setItem(APP.STORAGE_KEYS.BASE_EXERCISE, be);
        localStorage.setItem(APP.STORAGE_KEYS.THEME, theme);
        localStorage.setItem(APP.STORAGE_KEYS.DEFAULT_RECORD_EXERCISE, de);
        
        toggleModal('settings-modal', false);
        UI.updateModeSelector();
        updateBeerSelectOptions(); 
        const recordSelect = document.getElementById('exercise-select');
        if (recordSelect) recordSelect.value = de;
        
        UI.applyTheme(theme);
        refreshUI();
        UI.showMessage('設定を保存しました', 'success');
    } else {
        UI.showMessage('すべての項目を正しく入力してください', 'error');
    }
};

// 【修正】同日の運動ログを再計算（カロリーベース）
// トランザクション処理によりデータの整合性を保証
const recalcDailyExercises = async (targetTs) => {
    const targetDate = dayjs(targetTs);
    const dayStart = targetDate.startOf('day').valueOf();
    const dayEnd = targetDate.endOf('day').valueOf();

    // ★追加: 純粋関数化に伴い、ここでProfileを取得
    const profile = Store.getProfile();

    // トランザクションの使用 ('rw' は読み書きモード)
    // logsとchecksテーブルを一括してロックし、整合性を保つ
    await db.transaction('rw', db.logs, db.checks, async () => {
        // 同日のログを取得
        const dayLogs = await db.logs.where('timestamp').between(dayStart, dayEnd, true, true).toArray();
        // 運動ログ（借金返済）のみ抽出
        const exerciseLogs = dayLogs.filter(l => (l.kcal !== undefined ? l.kcal > 0 : l.minutes > 0));

        if (exerciseLogs.length === 0) return;

        // 全件取得（トランザクション内なので安全）
        // ※パフォーマンス最適化の余地はあるが、logic.jsの仕様に合わせて全件取得する
        const allLogs = await db.logs.toArray();
        const allChecks = await db.checks.toArray();

        // 飲酒ログがあるか (kcal < 0)
        // ※hasAlcoholLogは引数にprofile不要
        const hasAlcohol = Calc.hasAlcoholLog(allLogs, targetTs);
        // ★修正: profileを渡す
        const streak = Calc.getStreakAtDate(targetTs, allLogs, allChecks, profile);
        const multiplier = hasAlcohol ? 1.0 : Calc.getStreakMultiplier(streak);

        let updatedCount = 0;
        let bonusLost = false;
        let bonusGained = false;
        
        // 更新処理のPromiseを格納する配列
        const updates = [];

        for (const log of exerciseLogs) {
            let exKey = log.exerciseKey;
            if (!exKey) {
                const entry = Object.entries(EXERCISE).find(([k, v]) => log.name.includes(v.label));
                if (entry) exKey = entry[0];
            }

            // 運動種目データを取得（なければステッパー）
            const exData = EXERCISE[exKey] || EXERCISE['stepper'];

            // rawMinutes(実時間)がない古いデータは、保存されているminutesとステッパー基準から逆算して復元
            // ★修正: burnRate, stepperEq に profile を渡す
            const rawMinutes = log.rawMinutes || Math.round(Calc.stepperEq(log.minutes * Calc.burnRate(EXERCISE['stepper'].mets, profile), profile) / Calc.burnRate(exData.mets, profile));
            
            // 計算
            // ★修正: profileを渡す
            const baseKcal = Calc.calculateExerciseKcal(rawMinutes, exKey, profile);
            const bonusKcal = baseKcal * multiplier;

            let newMemo = log.memo || '';
            const hasBonusText = newMemo.includes('Streak Bonus');
            
            if (multiplier > 1.0) {
                if (!hasBonusText) {
                    newMemo = newMemo ? `${newMemo} 🔥 Streak Bonus x${multiplier}` : `🔥 Streak Bonus x${multiplier}`;
                    bonusGained = true;
                }
            } else {
                if (hasBonusText) {
                    newMemo = newMemo.replace(/🔥 Streak Bonus x[\d.]+/g, '').trim();
                    bonusLost = true;
                }
            }

            const currentKcal = log.kcal !== undefined ? log.kcal : 0;

            if (Math.abs(currentKcal - bonusKcal) > 1 || log.memo !== newMemo) {
                // 更新処理をキューに追加
                updates.push(db.logs.update(log.id, {
                    kcal: bonusKcal,
                    memo: newMemo
                }));
                updatedCount++;
            }
        }

        // 全ての更新を並列実行して待機
        await Promise.all(updates);

        // UIメッセージ表示（トランザクション完了後、または処理中に表示してもブロッキングしなければOK）
        if (updatedCount > 0) {
            if (bonusLost) {
                UI.showMessage('飲酒により、本日の運動ボーナスが\n無効になりました... 😭', 'error');
            } else if (bonusGained) {
                UI.showMessage('飲酒記録が消えたため\n運動ボーナスが復活しました！ 🔥', 'success');
            }
        }
    });
};

// 【修正版】飲酒ログ登録 (カロリー保存 + 同日の休肝日設定解除)
const handleBeerSubmit = async (e) => {
    e.preventDefault();
    const dateVal = document.getElementById('beer-date').value;
    const brewery = document.getElementById('beer-brewery').value;
    const brand = document.getElementById('beer-brand').value;
    const rating = parseInt(document.getElementById('beer-rating').value) || 0;
    const memo = document.getElementById('beer-memo').value;
    const useUntappd = document.getElementById('untappd-check').checked;
    
    const ts = dateVal ? getDateTimestamp(dateVal) : Date.now();
    const isCustom = !document.getElementById('beer-input-custom').classList.contains('hidden');
    
    let logName = '';
    let logStyle = '';
    let logSize = '';
    let totalKcal = 0;
    
    let saveCount = 1;
    let saveAbv = 0;
    let saveIsCustom = false;
    let saveCustomType = null;
    let saveRawAmount = null;

    if (isCustom) {
        const abv = parseFloat(document.getElementById('custom-abv').value);
        const ml = parseFloat(document.getElementById('custom-amount').value);
        const type = document.querySelector('input[name="customType"]:checked').value;

        if (isNaN(abv) || isNaN(ml) || abv < 0 || ml <= 0) {
            return UI.showMessage('正しい数値を入力してください', 'error');
        }

        totalKcal = Calc.calculateAlcoholKcal(ml, abv, type);
        
        logName = `Custom ${abv}% ${ml}ml` + (type==='dry' ? '🔥' : '🍺');
        logStyle = 'Custom';
        logSize = `${ml}ml`;
        
        saveCount = 1;
        saveAbv = abv;
        saveIsCustom = true;
        saveCustomType = type;
        saveRawAmount = ml;
    } else {
        const s = document.getElementById('beer-select').value;
        const z = document.getElementById('beer-size').value;
        const c = parseFloat(document.getElementById('beer-count').value);
        const userAbv = parseFloat(document.getElementById('preset-abv').value);

        if (!s || !z || !c || c <= 0 || isNaN(userAbv) || userAbv < 0) {
            return UI.showMessage('正しい数値を入力してください', 'error');
        }

        const sizeMl = parseFloat(z);
        const spec = STYLE_SPECS[s] || { type: 'sweet' };
        
        const unitKcal = Calc.calculateAlcoholKcal(sizeMl, userAbv, spec.type);
        totalKcal = unitKcal * c;

        logName = `${s} (${userAbv}%) x${c}`;
        logStyle = s;
        logSize = z;
        
        saveCount = c;
        saveAbv = userAbv;
        saveIsCustom = false;
    }
    
    // ★修正: profileを渡す
    const min = Calc.stepperEq(totalKcal, Store.getProfile());
    
    const logData = { 
        name: logName, 
        type: '借金', 
        style: logStyle, 
        size: logSize,
        kcal: -totalKcal, 
        minutes: -Math.round(min), 
        timestamp: ts, 
        brewery: brewery, 
        brand: brand, 
        rating: rating, 
        memo: memo,
        count: saveCount, 
        abv: saveAbv, 
        isCustom: saveIsCustom, 
        customType: saveCustomType, 
        rawAmount: saveRawAmount
    };

    let oldTimestamp = null;

    if (editingLogId) {
        // ★追加: 更新を実行する前に、現在のDBから古いデータを取得して日付を保存
        const oldLog = await db.logs.get(editingLogId);
        if (oldLog) {
            oldTimestamp = oldLog.timestamp;
        }

        await db.logs.update(editingLogId, logData);
        UI.showMessage('記録を更新しました', 'success');
        editingLogId = null;
    } else {
        await db.logs.add(logData);
        UI.showMessage('飲酒を記録しました 🍺', 'success'); 
    }
    
    // 同日の休肝日設定をチェックし、もしあれば解除する
    const allChecks = await db.checks.toArray();
    const targetCheck = allChecks.find(c => Calc.isSameDay(c.timestamp, ts));
    
    if (targetCheck && targetCheck.isDryDay) {
        await db.checks.update(targetCheck.id, { isDryDay: false });
    }

    // 1. 今回記録した日付（今日など）の運動ボーナスを再計算
    await recalcDailyExercises(ts);

    // ★追加: もし日付を変更していた場合（昨日→今日など）、変更元の日付（昨日）も再計算する
    // （昨日の飲酒記録が消えたことで、昨日の運動ボーナスが復活する可能性があるため）
    if (oldTimestamp && !Calc.isSameDay(oldTimestamp, ts)) {
        await recalcDailyExercises(oldTimestamp);
    }

    toggleModal('beer-modal', false); 
    await refreshUI();

    document.getElementById('beer-brewery').value = '';
    document.getElementById('beer-brand').value = '';
    document.getElementById('beer-rating').value = '0';
    document.getElementById('beer-memo').value = '';
    document.getElementById('untappd-check').checked = false;
    document.getElementById('beer-count').value = '';
    
    if(document.getElementById('custom-abv')) document.getElementById('custom-abv').value = '';
    if(document.getElementById('custom-amount')) document.getElementById('custom-amount').value = '';

    if (useUntappd) {
        let searchTerm = brand;
        if (brewery) searchTerm = `${brewery} ${brand}`;
        if (!searchTerm) searchTerm = logStyle;
        ExternalApp.searchUntappd(searchTerm);
    }
};

const handleManualExerciseSubmit = async () => { 
    const dateVal = document.getElementById('manual-date').value;
    const m = parseFloat(document.getElementById('manual-minutes').value); 
    const applyBonus = document.getElementById('manual-apply-bonus').checked; 
    
    if (!m || m <= 0) return UI.showMessage('正しい時間を入力してください', 'error'); 
    
    // editingLogId を渡して更新に対応
    await recordExercise(document.getElementById('exercise-select').value, m, dateVal, applyBonus, editingLogId); 
    
    document.getElementById('manual-minutes').value=''; 
    toggleModal('manual-exercise-modal', false); 
    editingLogId = null; 
};

const handleCheckSubmit = async (e) => {
    e.preventDefault();
    const f = document.getElementById('check-form');
    const dateVal = document.getElementById('check-date').value;
    const isDry = document.getElementById('is-dry-day').checked; 
    const w = document.getElementById('check-weight').value;

    const ts = dateVal ? getDateTimestamp(dateVal) : Date.now();
    
    const entry = {
        isDryDay: isDry, 
        waistEase: f.elements['waistEase'].checked, 
        footLightness: f.elements['footLightness'].checked, 
        waterOk: isDry ? null : f.elements['waterOk'].checked, 
        fiberOk: isDry ? null : f.elements['fiberOk'].checked, 
        timestamp: ts
    };

    // ★ 体重はここで一元処理
    if (w === '') {
        entry.weight = null; // ← 削除の意思表示
    } else {
        const val = parseFloat(w);
        if (val > 0) {
            entry.weight = val;
        } else {
            return UI.showMessage('体重は正の数で入力してください', 'error');
        }
    }

    if (editingCheckId) {
        await db.checks.update(editingCheckId, entry);
        editingCheckId = null;
    } else {
        const existing = (await db.checks.toArray())
            .find(c => Calc.isSameDay(c.timestamp, ts));
        if (existing) {
            if (confirm('この日付のデータは既に存在します。上書きしますか？')) {
                await db.checks.update(existing.id, entry);
            } else {
                return;
            }
        } else {
            await db.checks.add(entry);
        }
    }
    
    UI.showMessage('チェック完了！','success'); 
    toggleModal('check-modal', false); 
    document.getElementById('is-dry-day').checked = false; 
    document.getElementById('check-weight').value = '';
    document.getElementById('drinking-section').classList.remove('hidden-area'); 
    await refreshUI(); 
};

const deleteLog = async (id) => {
    if (!confirm('削除しますか？')) return;
    
    const targetLog = await db.logs.get(id);
    const targetTs = targetLog ? targetLog.timestamp : null;
    // 飲酒ログかどうかの判定 (kcalがマイナス、または互換性のためminutesがマイナス)
    const isAlcohol = targetLog && (targetLog.kcal !== undefined ? targetLog.kcal < 0 : targetLog.minutes < 0);

    await db.logs.delete(id);
    UI.showMessage('削除しました', 'success');

    // 飲酒ログ削除時は運動ボーナスが復活する可能性があるため再計算
    if (targetLog && isAlcohol) {
        await recalcDailyExercises(targetTs);
    }
    await refreshUI();
};

const bulkDeleteLogs = async (ids) => {
    if (!ids || ids.length === 0) return;
    if (!confirm(`${ids.length}件のデータを削除しますか？\nこの操作は取り消せません。`)) return;
    
    try {
        const logsToDelete = await db.logs.where('id').anyOf(ids).toArray();
        const affectedDates = new Set();
        logsToDelete.forEach(l => {
            // 飲酒ログが含まれていたらその日付を記録
            const isAlcohol = (l.kcal !== undefined ? l.kcal < 0 : l.minutes < 0);
            if (isAlcohol) {
                affectedDates.add(dayjs(l.timestamp).format('YYYY-MM-DD'));
            }
        });

        await db.logs.bulkDelete(ids);
        UI.showMessage(`${ids.length}件削除しました`, 'success');
        
        // 影響を受けた日付のボーナスを再計算
        for (const dateStr of affectedDates) {
            await recalcDailyExercises(dayjs(dateStr).valueOf());
        }

        UI.toggleEditMode(); 
        await refreshUI();
    } catch (e) {
        console.error(e);
        UI.showMessage('一括削除に失敗しました', 'error');
    }
};

const handleShare = async () => {
    const logs = await db.logs.toArray();
    const checks = await db.checks.toArray();

    // ★追加: profile取得
    const profile = Store.getProfile();

    // ★修正: profileを渡す
    const gradeData = Calc.getRecentGrade(checks, logs, profile);
    const streak = Calc.getCurrentStreak(logs, checks, profile);

    const baseEx = Store.getBaseExercise();
    const baseExData = EXERCISE[baseEx] || EXERCISE['stepper'];

    const totalKcal = logs.reduce((sum, l) => {
        if (l.kcal !== undefined) return sum + l.kcal;
        // ★修正: profileを渡す
        return sum + (l.minutes * Calc.burnRate(6.0, profile));
    }, 0);

    const mode1 = localStorage.getItem(APP.STORAGE_KEYS.MODE1) || APP.DEFAULTS.MODE1;
    const beerCount = Calc.convertKcalToBeerCount(Math.abs(totalKcal), mode1);
    const beerIcon = '🍺';

    // ★修正: profileを渡す
    const balanceMinutes = Calc.convertKcalToMinutes(Math.abs(totalKcal), baseEx, profile);

    const statusText = totalKcal >= 0
        ? `貯金: ${mode1}${beerCount}本分を返済！${beerIcon}`
        : `借金: ${mode1}${beerCount}本分が残ってます…${beerIcon}`;

    const minuteText = `${baseExData.label}${balanceMinutes}分換算`;

    const text = `現在: ${gradeData.label} (${gradeData.rank})
| 連続: ${streak}日🔥
| ${statusText}
（${minuteText}）
#ノムトレ #飲んだら動く`;

    shareToSocial(text);
};

const handleDetailShare = async () => {
    const modal = document.getElementById('log-detail-modal');
    if (!modal || !modal.dataset.id) return;
    
    const id = parseInt(modal.dataset.id);
    const log = await db.logs.get(id);
    if (!log) return;

    // ★追加: profile取得
    const profile = Store.getProfile();

    let text = '';
    const baseEx = Store.getBaseExercise();
    const baseExData = EXERCISE[baseEx] || EXERCISE['stepper'];
    
    // kcal基準で判定（互換対応）
    const isDebt = log.kcal !== undefined ? log.kcal < 0 : log.minutes < 0;
    
    if (isDebt) {
        // --- 飲酒 ---
        const kcalVal = log.kcal !== undefined
            ? Math.abs(log.kcal)
            : Math.abs(log.minutes * Calc.burnRate(6.0, profile)); // ★修正: profileを渡す

        // ★修正: profileを渡す
        const debtMins = Calc.convertKcalToMinutes(kcalVal, baseEx, profile);
        const beerName = log.brand || log.style || 'ビール';
        const star = log.rating > 0 ? '★'.repeat(log.rating) : '';
        
        text = `🍺 飲みました: ${beerName}
| 借金発生: ${baseExData.label}換算で${debtMins}分…😱 ${star}
#ノムトレ`;
    } else {
        // --- 運動 ---
        let exKey = log.exerciseKey;

        // 旧データ救済
        if (!exKey) {
            const entry = Object.entries(EXERCISE)
                .find(([_, v]) => log.name?.includes(v.label));
            if (entry) exKey = entry[0];
        }

        const exData = EXERCISE[exKey] || EXERCISE['stepper'];
        const exLabel = exData.label || log.name || '運動';

        const rawMinutes = log.rawMinutes || log.minutes || 0;

        const earnedKcal = log.kcal !== undefined
            ? log.kcal
            : Calc.calculateExerciseKcal(rawMinutes, exKey, profile); // ★修正: profileを渡す

        const mode1 = localStorage.getItem(APP.STORAGE_KEYS.MODE1) || APP.DEFAULTS.MODE1;
        const beerCount = Calc.convertKcalToBeerCount(earnedKcal, mode1);
        const beerIcon = '🍺';

        text = `🏃‍♀️ 運動しました: ${exLabel}（${rawMinutes}分）
| 借金返済: ${mode1}（350ml）${beerCount}本分を返済！${beerIcon}
#ノムトレ #飲んだら動く`;
    }

    shareToSocial(text);
};

const shareToSocial = async (text) => {
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'ノムトレ - 借金返済ダイエット',
                text: text,
                url: window.location.href
            });
        } catch (err) {
            console.log('Share canceled');
        }
    } else {
        const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`;
        window.open(twitterUrl, '_blank');
    }
};

let touchStartX = 0;
let touchStartY = 0;
const TABS = ['tab-home', 'tab-record', 'tab-history'];

const handleTouchStart = (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
};

const handleTouchEnd = (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    if (Math.abs(diffX) > 60 && Math.abs(diffY) < 50) {
        const currentTabId = document.querySelector('.tab-content.active').id;
        const currentIndex = TABS.indexOf(currentTabId);
        if (diffX < 0) {
            if (currentIndex < TABS.length - 1) UI.switchTab(TABS[currentIndex + 1]);
        } else {
            if (currentIndex > 0) UI.switchTab(TABS[currentIndex - 1]);
        }
    }
};

/* ==========================================================================
   Internal Logic & Functions
   ========================================================================== */

// 【修正】運動記録関数 (カロリーベース)
async function recordExercise(t, m, dateVal = null, applyBonus = true, existingId = null) { 
    const allLogs = await db.logs.toArray();
    const allChecks = await db.checks.toArray();
    
    const ts = dateVal ? getDateTimestamp(dateVal) : Date.now();
    // ★追加: profile取得
    const profile = Store.getProfile();

    // ★修正: profileを渡す
    const streak = Calc.getStreakAtDate(ts, allLogs, allChecks, profile);
    const multiplier = applyBonus ? Calc.getStreakMultiplier(streak) : 1.0;

    const i = EXERCISE[t];
    
    // 【重要】運動時間(分)から基準カロリーを計算して保存
    // ★修正: profileを渡す
    const baseKcal = Calc.calculateExerciseKcal(m, t, profile);
    const bonusKcal = baseKcal * multiplier;
    
    // 既存残高の計算 (kcalベース)
    let currentKcalBalance = allLogs.reduce((sum, l) => {
        if (existingId && l.id === existingId) return sum;
        // 互換性考慮
        // ★修正: profileを渡す
        const val = l.kcal !== undefined ? l.kcal : (l.minutes * Calc.burnRate(6.0, profile));
        return sum + val;
    }, 0);

    let bonusMemo = '';
    if (applyBonus && multiplier > 1.0) {
        bonusMemo = `🔥 Streak Bonus x${multiplier}`;
    } else if (!applyBonus) {
        bonusMemo = `(Bonusなし)`;
    }

    // minutesはステッパー換算値として一応保存しておく（互換性のため）
    // ★修正: profileを渡す
    const stepperEqMinutes = Math.round(Calc.stepperEq(bonusKcal, profile));

    const logData = {
        name: `${i.icon} ${i.label}`, 
        type: '返済', 
        kcal: bonusKcal,        // 【新規】正確なカロリー
        minutes: stepperEqMinutes, // 【維持】後方互換用ステッパー換算分
        rawMinutes: m,          // 【維持】実際の運動時間
        timestamp: ts,
        memo: bonusMemo,
        exerciseKey: t
    };

    if (existingId) {
        await db.logs.update(existingId, logData);
        UI.showMessage('記録を更新しました', 'success');
    } else {
        await db.logs.add(logData);
        
        // 完済演出 (借金状態からプラスになった時のみ)
        if (currentKcalBalance < 0 && (currentKcalBalance + bonusKcal) >= 0) {
            UI.showConfetti();
            UI.showMessage(`借金完済！おめでとう！🎉\n${i.label} ${m}分 記録完了`, 'success');
        } else {
            if (multiplier > 1.0) {
                UI.showMessage(`${i.label} ${m}分 記録！\n🔥連続休肝ボーナス！返済効率 x${multiplier}`, 'success'); 
            } else {
                UI.showMessage(`${i.label} ${m}分 記録！`, 'success'); 
            }
        }
    }
    
    await refreshUI(); 
}

const DataManager = {
    exportCSV: async (t) => { 
        let d=[], c="", n=""; 
        const e = (s) => `"${String(s).replace(/"/g,'""')}"`; 
        
        if(t === 'logs'){ 
            d = await db.logs.toArray();
            d.sort((a,b) => a.timestamp - b.timestamp);
            
            // ★追加: profile取得 (exportCSVスコープ内で必要)
            const profile = Store.getProfile();

            // CSVヘッダーにカロリー追加
            c = "日時,内容,カロリー(kcal),換算分(ステッパー),実運動時間(分),ブルワリー,銘柄,評価,メモ\n" + 
                d.map(r => {
                    const rawMin = r.rawMinutes !== undefined ? r.rawMinutes : '-';
                    // kcalがない場合は補完
                    // ★修正: profileを渡す
                    const kcal = r.kcal !== undefined ? Math.round(r.kcal) : Math.round(r.minutes * Calc.burnRate(6.0, profile));
                    return `${new Date(r.timestamp).toLocaleString()},${e(r.name)},${kcal},${r.minutes},${rawMin},${e(r.brewery)},${e(r.brand)},${r.rating || 0},${e(r.memo || '')}`;
                }).join('\n'); 
            n = "beer-log"; 
        } else { 
            d = await db.checks.toArray();
            d.sort((a,b) => a.timestamp - b.timestamp); 
            c = "日時,休肝日,ウエスト,足,水分,繊維,体重\n" + 
                d.map(r => `${new Date(r.timestamp).toLocaleString()},${r.isDryDay},${r.waistEase||false},${r.footLightness||false},${r.waterOk||false},${r.fiberOk||false},${r.weight||''}`).join('\n'); 
            n = "check-log"; 
        } 
        DataManager.download(c, `nomutore-${n}.csv`, 'text/csv'); 
    },

    getAllData: async () => {
        const logs = await db.logs.toArray();
        const checks = await db.checks.toArray();
        const settings = {};
        Object.values(APP.STORAGE_KEYS).forEach(key => {
            const val = localStorage.getItem(key);
            if (val !== null) settings[key] = val;
        });
        return { logs, checks, settings };
    },

    exportJSON: async () => { 
        const data = await DataManager.getAllData();
        DataManager.download(JSON.stringify(data, null, 2), 'nomutore-backup.json', 'application/json'); 
    },

    copyToClipboard: async () => { 
        const data = await DataManager.getAllData();
        navigator.clipboard.writeText(JSON.stringify(data, null, 2))
            .then(() => UI.showMessage('コピーしました','success')); 
    },

    importJSON: (i) => { 
        const f = i.files[0]; if(!f) return; 
        const r = new FileReader(); 
        r.onload = async (e) => { 
            try { 
                const d = JSON.parse(e.target.result); 
                if(confirm('データを復元しますか？\n※既存のデータと重複しないログのみ追加されます。\n※設定は上書きされます。')){ 
                    
                    if (d.settings) {
                        Object.entries(d.settings).forEach(([k, v]) => localStorage.setItem(k, v));
                    }

                    if (d.logs && Array.isArray(d.logs)) {
                        const existingLogs = await db.logs.toArray();
                        const existingTimestamps = new Set(existingLogs.map(l => l.timestamp));

                        // 重複チェック
                        const uniqueLogs = d.logs
                            .filter(l => !existingTimestamps.has(l.timestamp))
                            .map(l => {
                                const { id, ...rest } = l; // ID除外
                                return rest;
                            });
                        
                        // インポート時のデータ補完 (kcalがない場合)
                        // ★追加: profile取得
                        const profile = Store.getProfile();

                        const migratedLogs = uniqueLogs.map(l => {
                            if (l.kcal === undefined && l.minutes !== undefined) {
                                // ステッパー(6.0METs)基準でカロリー復元
                                // ★修正: profileを渡す
                                const stepperRate = Calc.burnRate(6.0, profile);
                                l.kcal = l.minutes * stepperRate;
                            }
                            return l;
                        });

                        if (migratedLogs.length > 0) {
                            await db.logs.bulkAdd(migratedLogs);
                            console.log(`${migratedLogs.length}件のログを追加しました`);
                        }
                    }

                    if (d.checks && Array.isArray(d.checks)) {
                        const existingChecks = await db.checks.toArray();
                        const existingCheckTimestamps = new Set(existingChecks.map(c => c.timestamp));
                        const uniqueChecks = d.checks
                            .filter(c => !existingCheckTimestamps.has(c.timestamp))
                            .map(c => {
                                const { id, ...rest } = c;
                                return rest;
                            });
                        if (uniqueChecks.length > 0) {
                            await db.checks.bulkAdd(uniqueChecks);
                        }
                    }

                    UI.updateModeSelector();
                    updateBeerSelectOptions(); 
                    UI.applyTheme(localStorage.getItem(APP.STORAGE_KEYS.THEME) || 'system');
                    await refreshUI(); 
                    UI.showMessage('復元しました (重複はスキップ)','success'); 
                } 
            } catch(err) { 
                console.error(err);
                UI.showMessage('読込失敗: データ形式が不正です','error'); 
            } 
            i.value = ''; 
        }; 
        r.readAsText(f); 
    },

    download: (d,n,t) => { 
        const b = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), d], {type:t});
        const u = URL.createObjectURL(b);
        const a = document.createElement('a'); 
        a.href = u; a.download = n; a.click(); 
    }
};

const updTm = () => { 
    const stStr = localStorage.getItem(APP.STORAGE_KEYS.TIMER_START);
    const accStr = localStorage.getItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED);
    let totalMs = 0;
    if (accStr) totalMs += parseInt(accStr, 10);
    if (stStr) totalMs += (Date.now() - parseInt(stStr, 10));

    const mm = Math.floor(totalMs / 60000).toString().padStart(2, '0');
    const ss = Math.floor((totalMs % 60000) / 1000).toString().padStart(2, '0');
    const display = document.getElementById('timer-display');
    if(display) display.textContent = `${mm}:${ss}`;
};

const timerControl = {
    start: () => {
        if (StateManager.timerId) return;
        localStorage.setItem(APP.STORAGE_KEYS.TIMER_START, Date.now());
        timerControl.updateButtons('running');
        updTm();
        StateManager.setTimerId(setInterval(updTm, 1000));
    },
    pause: () => {
        if (StateManager.timerId) {
            clearInterval(StateManager.timerId);
            StateManager.setTimerId(null);
        }
        const stStr = localStorage.getItem(APP.STORAGE_KEYS.TIMER_START);
        if (stStr) {
            const currentSession = Date.now() - parseInt(stStr, 10);
            const prevAcc = parseInt(localStorage.getItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED) || '0', 10);
            localStorage.setItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED, prevAcc + currentSession);
            localStorage.removeItem(APP.STORAGE_KEYS.TIMER_START);
        }
        timerControl.updateButtons('paused');
        updTm();
    },
    resume: () => {
        if (StateManager.timerId) return;
        localStorage.setItem(APP.STORAGE_KEYS.TIMER_START, Date.now());
        timerControl.updateButtons('running');
        updTm();
        StateManager.setTimerId(setInterval(updTm, 1000));
    },
    stop: async () => {
        timerControl.pause();
        const totalMs = parseInt(localStorage.getItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED) || '0', 10);
        const m = Math.round(totalMs / 60000);
        localStorage.removeItem(APP.STORAGE_KEYS.TIMER_START);
        localStorage.removeItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED);
        timerControl.updateButtons('initial');
        document.getElementById('timer-display').textContent = '00:00';
        if (m > 0) {
            // 保存時にセレクトボックスの値を使う
            await recordExercise(document.getElementById('exercise-select').value, m);
        } else {
            UI.showMessage('1分未満のため記録せず', 'error');
        }
    },
    updateButtons: (state) => {
        const startBtn = document.getElementById('start-stepper-btn');
        const manualBtn = document.getElementById('manual-record-btn');
        const pauseBtn = document.getElementById('pause-stepper-btn');
        const resumeBtn = document.getElementById('resume-stepper-btn');
        const stopBtn = document.getElementById('stop-stepper-btn');
        const statusText = document.getElementById('timer-status');
        [startBtn, manualBtn, pauseBtn, resumeBtn, stopBtn].forEach(el => el?.classList.add('hidden'));

        if (state === 'running') {
            pauseBtn?.classList.remove('hidden');
            stopBtn?.classList.remove('hidden');
            if(statusText) { statusText.textContent = '計測中...'; statusText.className = 'text-xs text-green-600 font-bold mb-1 animate-pulse'; }
        } else if (state === 'paused') {
            resumeBtn?.classList.remove('hidden');
            stopBtn?.classList.remove('hidden');
            if(statusText) { statusText.textContent = '一時停止中'; statusText.className = 'text-xs text-yellow-500 font-bold mb-1'; }
        } else { 
            startBtn?.classList.remove('hidden');
            manualBtn?.classList.remove('hidden');
            if(statusText) { statusText.textContent = 'READY'; statusText.className = 'text-xs text-gray-400 mt-1 font-medium'; }
        }
    },
    restoreState: () => {
        const st = localStorage.getItem(APP.STORAGE_KEYS.TIMER_START);
        const acc = localStorage.getItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED);
        if (st) {
            const elapsed = Date.now() - parseInt(st, 10);
            if (elapsed > ONE_DAY_MS) {
                localStorage.removeItem(APP.STORAGE_KEYS.TIMER_START);
                localStorage.removeItem(APP.STORAGE_KEYS.TIMER_ACCUMULATED);
                UI.showMessage('中断された古い計測をリセットしました', 'error');
                return false;
            }
            timerControl.start();
            return true;
        } else if (acc) {
            timerControl.updateButtons('paused');
            updTm();
            return true;
        }
        return false;
    }
};

const showSwipeCoachMark = () => {
    const KEY = 'nomutore_seen_swipe_hint';
    if (localStorage.getItem(KEY)) return;
    const el = document.getElementById('swipe-coach-mark');
    if (!el) return;
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.remove('opacity-0'));
    setTimeout(() => {
        el.classList.add('opacity-0');
        setTimeout(() => {
            el.classList.add('hidden');
            localStorage.setItem(KEY, 'true');
        }, 500);
    }, 3500);
};

// 【新規】データ移行関数：古いminutes基準のログをkcal基準に変換してDB更新
async function migrateData() {
    // 1. LocalStorageからの移行 (既存ロジック)
    const oldLogs = localStorage.getItem(APP.STORAGE_KEYS.LOGS);
    const oldChecks = localStorage.getItem(APP.STORAGE_KEYS.CHECKS);
    if (oldLogs) {
        try { const logs = JSON.parse(oldLogs); if (logs.length > 0) await db.logs.bulkAdd(logs); } catch (e) { console.error(e); }
        localStorage.removeItem(APP.STORAGE_KEYS.LOGS);
    }
    if (oldChecks) {
        try { const checks = JSON.parse(oldChecks); if (checks.length > 0) await db.checks.bulkAdd(checks); } catch (e) { console.error(e); }
        localStorage.removeItem(APP.STORAGE_KEYS.CHECKS);
    }

    // 2. DBスキーマ変更に伴うデータ変換 (minutes -> kcal)
    const logs = await db.logs.toArray();
    // kcalカラムがないデータを抽出
    const needsUpdate = logs.filter(l => l.kcal === undefined && l.minutes !== undefined);
    
    if (needsUpdate.length > 0) {
        console.log(`Migrating ${needsUpdate.length} logs to kcal schema...`);
        // ★追加: profile取得
        const profile = Store.getProfile();

        // ステッパー基準(6.0METs)で換算して保存
        // ★修正: profileを渡す
        const stepperRate = Calc.burnRate(6.0, profile);
        
        // 一括更新
        for (const log of needsUpdate) {
            const kcal = log.minutes * stepperRate;
            await db.logs.update(log.id, { kcal: kcal });
        }
        console.log('Migration completed.');
        // 通知するとユーザーが驚くかもしれないので、初回のみconsole.logにとどめるか、さりげなく出す
        // UI.showMessage('データを新形式(カロリー)に変換しました', 'success'); 
    }
}

function bindEvents() {
    document.getElementById('btn-open-help')?.addEventListener('click', UI.openHelp);
    document.getElementById('btn-open-settings')?.addEventListener('click', UI.openSettings);
    
    document.getElementById('nav-tab-home')?.addEventListener('click', () => UI.switchTab('tab-home'));
    document.getElementById('nav-tab-record')?.addEventListener('click', () => UI.switchTab('tab-record'));
    document.getElementById('nav-tab-history')?.addEventListener('click', () => UI.switchTab('tab-history'));

    const swipeArea = document.getElementById('swipe-area');
    if (swipeArea) {
        swipeArea.addEventListener('touchstart', handleTouchStart, {passive: true});
        swipeArea.addEventListener('touchend', handleTouchEnd);
    }

    document.getElementById('home-mode-select')?.addEventListener('change', (e) => {
        UI.setBeerMode(e.target.value);
    });

    document.getElementById('liver-rank-card')?.addEventListener('click', async () => {
        const todayStr = dayjs().format('YYYY-MM-DD');
        const checks = await db.checks.toArray();
        const target = checks.find(c => dayjs(c.timestamp).format('YYYY-MM-DD') === todayStr);
        if (target) editingCheckId = target.id; else editingCheckId = null;
        UI.openCheckModal(target);
    });

    document.getElementById('chart-filters')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            StateManager.setChartRange(e.target.dataset.range); 
            refreshUI();
        }
    });

    document.getElementById('tab-beer-preset')?.addEventListener('click', () => UI.switchBeerInputTab('preset'));
    document.getElementById('tab-beer-custom')?.addEventListener('click', () => UI.switchBeerInputTab('custom'));
    
    document.querySelectorAll('.btn-quick-amount').forEach(btn => {
        btn.addEventListener('click', function() {
            const customAmt = document.getElementById('custom-amount');
            if(customAmt) customAmt.value = this.dataset.amount;
        });
    });

    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-bg') || e.target.closest('.modal-content').parentNode;
            toggleModal(modal.id, false);
            if (modal.id === 'beer-modal') editingLogId = null;
            if (modal.id === 'check-modal') editingCheckId = null;
        });
    });
    
    document.querySelectorAll('.modal-bg').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                toggleModal(modal.id, false);
                if (modal.id === 'beer-modal') editingLogId = null;
                if (modal.id === 'check-modal') editingCheckId = null;
            }
        });
    });

    document.getElementById('start-stepper-btn')?.addEventListener('click', timerControl.start);
    document.getElementById('pause-stepper-btn')?.addEventListener('click', timerControl.pause);
    document.getElementById('resume-stepper-btn')?.addEventListener('click', timerControl.resume);
    document.getElementById('stop-stepper-btn')?.addEventListener('click', timerControl.stop);
    document.getElementById('manual-record-btn')?.addEventListener('click', () => UI.openManualInput());
    
    document.getElementById('btn-open-beer')?.addEventListener('click', () => {
        editingLogId = null;
        UI.openBeerModal(null);
    });
    document.getElementById('btn-open-check')?.addEventListener('click', () => {
        editingCheckId = null;
        UI.openCheckModal(null);
    });

    document.getElementById('btn-share-sns')?.addEventListener('click', handleShare);
    document.getElementById('btn-detail-share')?.addEventListener('click', handleDetailShare);
    
    document.getElementById('beer-form')?.addEventListener('submit', handleBeerSubmit);
    document.getElementById('check-form')?.addEventListener('submit', handleCheckSubmit);
    document.getElementById('btn-submit-manual')?.addEventListener('click', handleManualExerciseSubmit);
    document.getElementById('btn-save-settings')?.addEventListener('click', handleSaveSettings);

    document.getElementById('is-dry-day')?.addEventListener('change', function() { UI.toggleDryDay(this); });

    document.getElementById('btn-export-logs')?.addEventListener('click', () => DataManager.exportCSV('logs'));
    document.getElementById('btn-export-checks')?.addEventListener('click', () => DataManager.exportCSV('checks'));
    document.getElementById('btn-copy-data')?.addEventListener('click', DataManager.copyToClipboard);
    document.getElementById('btn-download-json')?.addEventListener('click', DataManager.exportJSON);
    document.getElementById('btn-import-json')?.addEventListener('change', function() { DataManager.importJSON(this); });

    document.getElementById('log-list')?.addEventListener('click', async (e) => {
        if (e.target.classList.contains('log-checkbox')) return; 
        const deleteBtn = e.target.closest('.delete-log-btn');
        if (deleteBtn) {
            e.stopPropagation();
            deleteLog(parseInt(deleteBtn.dataset.id));
            return;
        }
        const row = e.target.closest('.log-item-row');
        if (row) {
            const id = parseInt(row.dataset.id);
            const log = await db.logs.get(id);
            if(log) UI.openLogDetail(log);
        }
    });

    document.getElementById('btn-detail-delete')?.addEventListener('click', () => {
        const modal = document.getElementById('log-detail-modal');
        if (modal && modal.dataset.id) {
            const id = parseInt(modal.dataset.id);
            deleteLog(id);
            toggleModal('log-detail-modal', false);
        }
    });

    document.getElementById('btn-detail-edit')?.addEventListener('click', async () => {
        const modal = document.getElementById('log-detail-modal');
        if (modal && modal.dataset.id) {
            const id = parseInt(modal.dataset.id);
            const log = await db.logs.get(id);
            if (log) {
                editingLogId = id;
                toggleModal('log-detail-modal', false);
                // kcalがマイナスならビール、プラスなら運動
                const isDebt = log.kcal !== undefined ? log.kcal < 0 : log.minutes < 0;
                if (isDebt) {
                    UI.openBeerModal(log);
                } else {
                    UI.openManualInput(log);
                }
            }
        }
    });

    document.getElementById('exercise-select')?.addEventListener('change', function() {
        const nameEl = document.getElementById('manual-exercise-name');
        if (nameEl && EXERCISE[this.value]) {
            nameEl.textContent = EXERCISE[this.value].label;
        }
    });

    document.getElementById('btn-toggle-edit-mode')?.addEventListener('click', UI.toggleEditMode);
    document.getElementById('btn-select-all')?.addEventListener('click', UI.toggleSelectAll);

    document.getElementById('btn-bulk-delete')?.addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('.log-checkbox:checked');
        const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));
        if (ids.length > 0) {
            await bulkDeleteLogs(ids);
        }
    });

    document.getElementById('log-list')?.addEventListener('change', (e) => {
        if (e.target.classList.contains('log-checkbox')) {
            const count = document.querySelectorAll('.log-checkbox:checked').length;
            UI.updateBulkCount(count);
        }
    });

    document.getElementById('heatmap-prev')?.addEventListener('click', () => {
        StateManager.incrementHeatmapOffset(); 
        refreshUI();
    });

    document.getElementById('heatmap-next')?.addEventListener('click', () => {
        if (StateManager.heatmapOffset > 0) {
            StateManager.decrementHeatmapOffset();
            refreshUI();
        }
    });

    document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
        if(confirm('本当に全てのデータを削除して初期化しますか？\nこの操作は取り消せません。')) {
            if(confirm('これまでの記録が全て消えます。よろしいですか？')) {
                try {
                    await db.logs.clear();
                    await db.checks.clear();
                    Object.values(APP.STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
                    alert('初期化しました。アプリを再読み込みします。');
                    location.reload();
                } catch(e) {
                    console.error(e);
                    UI.showMessage('削除に失敗しました', 'error');
                }
            }
        }
    });

    document.getElementById('heatmap-grid')?.addEventListener('click', async (e) => {
        const cell = e.target.closest('.heatmap-cell');
        if (cell && cell.dataset.date) {
            const dateStr = cell.dataset.date;
            const checks = await db.checks.toArray();
            const target = checks.find(c => dayjs(c.timestamp).format('YYYY-MM-DD') === dateStr);
            if (target) {
                editingCheckId = target.id;
                UI.openCheckModal(target);
            } else {
                editingCheckId = null;
                UI.openCheckModal(null, dateStr);
            }
        }
    });

    document.getElementById('check-status')?.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-edit-check') || e.target.closest('#btn-record-check')) {
            const todayStr = dayjs().format('YYYY-MM-DD');
            const checks = await db.checks.toArray();
            const target = checks.find(c => dayjs(c.timestamp).format('YYYY-MM-DD') === todayStr);
            if (target) editingCheckId = target.id; else editingCheckId = null;
            UI.openCheckModal(target);
        }
    });

    document.getElementById('quick-input-area')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-beer-btn');
        if (btn) {
            editingLogId = null;
            UI.openBeerModal(null);
            setTimeout(() => {
                const styleSelect = document.getElementById('beer-select');
                const sizeSelect = document.getElementById('beer-size');
                if(styleSelect) styleSelect.value = btn.dataset.style;
                if(sizeSelect) sizeSelect.value = btn.dataset.size;
            }, 50);
        }
    });

    document.getElementById('beer-select')?.addEventListener('change', function() {
        const style = this.value;
        const abvInput = document.getElementById('preset-abv');
        if (style && abvInput) {
            const spec = STYLE_SPECS[style];
            if (spec) abvInput.value = spec.abv;
        }
    });
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const currentSetting = localStorage.getItem(APP.STORAGE_KEYS.THEME) || APP.DEFAULTS.THEME;
        if (currentSetting === 'system') {
            UI.applyTheme('system');
            refreshUI();
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    UI.initDOM();

    const savedTheme = localStorage.getItem(APP.STORAGE_KEYS.THEME) || APP.DEFAULTS.THEME;
    UI.applyTheme(savedTheme);

    bindEvents();
    
    await migrateData();

    // 運動プルダウンの生成
    const exSelect = document.getElementById('exercise-select'); 
    if (exSelect) {
        Object.keys(EXERCISE).forEach(k => { 
            const o = document.createElement('option'); 
            o.value = k; 
            o.textContent = `${EXERCISE[k].icon} ${EXERCISE[k].label}`; 
            exSelect.appendChild(o); 
        });
        exSelect.value = Store.getDefaultRecordExercise();
    }
    
    // 設定モーダルの運動プルダウン生成
    const settingExSelect = document.getElementById('setting-base-exercise');
    if (settingExSelect) {
        settingExSelect.innerHTML = '';
        Object.keys(EXERCISE).forEach(k => { 
            const o = document.createElement('option'); 
            o.value = k; 
            o.textContent = `${EXERCISE[k].icon} ${EXERCISE[k].label}`; 
            settingExSelect.appendChild(o); 
        });
    }
    const settingDefExSelect = document.getElementById('setting-default-record-exercise');
    if (settingDefExSelect) {
        settingDefExSelect.innerHTML = '';
        Object.keys(EXERCISE).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = `${EXERCISE[k].icon} ${EXERCISE[k].label}`;
            settingDefExSelect.appendChild(o);
        });
    }

    // 【追加】設定モーダルの換算基準プルダウン生成 (これが抜けていました)
    const populateModeSelect = (id) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = '';
        Object.keys(CALORIES.STYLES).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = k;
            el.appendChild(o);
        });
    };
    populateModeSelect('setting-mode-1');
    populateModeSelect('setting-mode-2');

    // ビールサイズプルダウン生成
    const zs = document.getElementById('beer-size'); 
    if (zs) {
        Object.keys(SIZE_DATA).forEach(k => { 
            const o = document.createElement('option'); 
            o.value = k; 
            o.textContent = SIZE_DATA[k].label; 
            if(k === '350') o.selected = true; 
            zs.appendChild(o); 
        });
    }

    // プロフィール設定の反映
    const p = Store.getProfile();
    const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    setVal('weight-input', p.weight);
    setVal('height-input', p.height);
    setVal('age-input', p.age);
    setVal('gender-input', p.gender);

    UI.updateModeSelector();
    document.getElementById('mode-selector')?.classList.remove('opacity-0');

    UI.setBeerMode('mode1');
    updateBeerSelectOptions(); 
    
    // タイマー状態などの復元
    const isRestored = timerControl.restoreState();
    if(isRestored) { 
        UI.switchTab('tab-record'); 
    } else { 
        UI.switchTab('tab-home'); 
        
        if (!localStorage.getItem(APP.STORAGE_KEYS.WEIGHT)) {
            // 初回ユーザー設定
            setTimeout(() => {
                UI.openSettings();
                UI.showMessage('👋 ようこそ！まずはプロフィールと\n基準にする運動を設定しましょう！', 'success');
            }, 800);
        } else {
            // 既存ユーザー向けコーチマーク
            setTimeout(() => {
                showSwipeCoachMark();
            }, 1000);
        }
    }

    await refreshUI();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./service-worker.js'); });

}
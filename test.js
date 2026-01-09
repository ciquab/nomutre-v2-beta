// test.js
import { Calc } from './logic.js';
import { CALORIES, EXERCISE } from './constants.js';
// dayjsが必要な場合はロジックと同様にCDNから読み込むか、logic.jsの依存関係を利用
import dayjs from 'https://cdn.jsdelivr.net/npm/dayjs@1.11.10/+esm';

console.log('%c🧪 ノムトレ 単体テスト開始', 'background: #222; color: #bada55; font-size: 1.2em; padding: 4px;');

let passCount = 0;
let failCount = 0;

const assert = (desc, expected, actual) => {
    // 浮動小数点の誤差対策 (小数点第2位までで比較)
    const format = (v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    
    if (format(expected) === format(actual)) {
        console.log(`%c✅ PASS: ${desc}`, 'color: green; font-weight: bold;');
        passCount++;
    } else {
        console.error(`❌ FAIL: ${desc}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual:   ${actual}`);
        failCount++;
    }
};

const runTests = async () => {
    try {
        // --- 1. カロリー計算のテスト ---
        console.group('🍺 アルコールカロリー計算');
        
        // 350ml, 5%, sweet(ビール) -> 350 * 0.05 * 0.8 * 7 + (350 * 0.15) = 98 + 52.5 = 150.5 kcal
        // ※logic.jsの実装に合わせる
        const standardBeer = Calc.calculateAlcoholKcal(350, 5.0, 'sweet');
        assert('350ml 5% (通常ビール)', 150.5, standardBeer);

        // 350ml, 9%, dry(ストロング) -> 350 * 0.09 * 0.8 * 7 + 0 = 176.4 kcal
        const strongZero = Calc.calculateAlcoholKcal(350, 9.0, 'dry');
        assert('350ml 9% (辛口/糖質オフ)', 176.4, strongZero);
        
        console.groupEnd();

        // --- 2. 運動換算のテスト ---
        console.group('🏃‍♀️ 運動換算 (ステッパー基準)');
        // 150.5kcalをステッパー(METs 6.0)で消費する場合の分数
        // プロフィールに依存するため、標準的な体重(60kg, 160cm, 30歳, 女性)を想定した仮の値を計算
        // ※Storeのモックが必要だが、ここではlogic.jsが現在のlocalStorageの値を使う前提で動作確認
        
        // 単純に計算式が通るかチェック（値は環境によるのでNaNにならないか確認）
        const minutes = Calc.stepperEq(150.5);
        if (!isNaN(minutes) && minutes > 0) {
            console.log(`%c✅ PASS: ステッパー換算計算 (結果: ${minutes.toFixed(2)}分)`, 'color: green;');
            passCount++;
        } else {
            console.error('❌ FAIL: ステッパー換算が異常値です');
            failCount++;
        }
        console.groupEnd();

        // --- 3. ランク判定のテスト (モックデータ使用) ---
        console.group('👑 ランク判定ロジック');
        
        // モック: 過去28日間
        const mockChecks = [];
        const mockLogs = [];
        const today = dayjs();

        // ケースA: 28日中20日休肝日 -> Sランクのはず
        for(let i=0; i<20; i++) {
            mockChecks.push({ 
                isDryDay: true, 
                timestamp: today.subtract(i, 'day').valueOf() 
            });
        }
        
        const resultS = Calc.getRecentGrade(mockChecks, mockLogs);
        assert('休肝日20日 -> Sランク', 'S', resultS.rank);

        // ケースB: 28日中5日だけ休肝日 -> Cランクのはず
        const mockChecksC = [];
        for(let i=0; i<5; i++) {
            mockChecksC.push({ 
                isDryDay: true, 
                timestamp: today.subtract(i, 'day').valueOf() 
            });
        }
        const resultC = Calc.getRecentGrade(mockChecksC, mockLogs);
        assert('休肝日5日 -> Cランク', 'C', resultC.rank);

        console.groupEnd();

    } catch (e) {
        console.error('テスト実行中にエラーが発生しました:', e);
    } finally {
        console.log(`\n🎉 テスト完了: ${passCount} 合格 / ${failCount} 失敗`);
    }
};

// 実行
runTests();
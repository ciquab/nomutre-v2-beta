export const APP = {
    STORAGE_KEYS: {
        LOGS: 'hazy_payback_logs', 
        CHECKS: 'hazy_payback_checks', 
        WEIGHT: 'hazy_payback_weight', 
        HEIGHT: 'hazy_payback_height', 
        AGE: 'hazy_payback_age', 
        GENDER: 'hazy_payback_gender', 
        TIMER_START: 'hazy_payback_timer_start',
        TIMER_ACCUMULATED: 'hazy_payback_timer_accumulated', // 【追加】一時停止用 
        MODE1: 'hazy_payback_mode_1', 
        MODE2: 'hazy_payback_mode_2',
        BASE_EXERCISE: 'hazy_payback_base_exercise',
        THEME: 'hazy_payback_theme',
        DEFAULT_RECORD_EXERCISE: 'hazy_payback_default_record_exercise' // 追加
    },
    DEFAULTS: { 
        WEIGHT: 60, HEIGHT: 160, AGE: 30, GENDER: 'female', 
        MODE1: '国産ピルスナー', MODE2: 'Hazy IPA',
        BASE_EXERCISE: 'walking',
        THEME: 'system',
        DEFAULT_RECORD_EXERCISE: 'walking' // 追加
    },
    TANK_MAX_CANS: 3.0
};

export const CALORIES = { 
    STYLES: { 
        // --- ラガー / すっきり系 ---
        '国産ピルスナー': 145,      // 旧: 大手ラガー
        '糖質オフ/新ジャンル': 110, // 旧: 第三のビール
        'ピルスナー': 140,
        'ドルトムンター': 145,
        'シュバルツ': 155,

        // --- エール / 小麦系 ---
        'ゴールデンエール': 150,    // New
        'ペールエール': 160,
        'ジャパニーズエール': 160,
        'ヴァイツェン': 180,
        'ベルジャンホワイト': 160,
        'セゾン': 165,

        // --- IPA / ホップ系 ---
        'セッションIPA': 130,
        'IPA (West Coast)': 190,
        'Hazy IPA': 220,
        'Hazyペールエール': 170,
        'ダブルIPA (DIPA)': 270,

        // --- 黒 / 濃厚系 ---
        'アンバーエール': 165,
        'ポーター': 170,
        'スタウト': 200,
        'インペリアルスタウト': 280, // New

        // --- ハイアルコール / 特殊 ---
        'ベルジャン・トリペル': 250,
        'バーレイワイン': 320,
        
        // --- サワー / フルーツ ---
        'サワーエール': 140,
        'フルーツビール': 160,
  
        // 【追加】ノンアル (350ml換算: 糖質を含むものも考慮して50kcal程度に設定)
        'ノンアル': 50,
    } 
};

export const BEER_COLORS = {
    'pale': 'linear-gradient(to top, #fde047, #fef08a)',   // 薄い黄色 (ライトラガー等)
    'gold': 'linear-gradient(to top, #eab308, #facc15)',   // 黄金色 (ピルスナー等)
    'copper': 'linear-gradient(to top, #d97706, #fbbf24)', // 銅色/オレンジ (IPA, ペールエール)
    'amber': 'linear-gradient(to top, #b45309, #d97706)',  // 茶褐色 (アンバー, バーレイワイン)
    'black': 'linear-gradient(to top, #000000, #4b2c20)',  // 黒
    'white': 'linear-gradient(to top, #fcd34d, #fef3c7)',  // 白濁イエロー
    'hazy': 'linear-gradient(to top, #ca8a04, #facc15)',   // 濁ったオレンジ
    'red': 'linear-gradient(to top, #991b1b, #ef4444)',    // 赤/ルビー
};

// 【変更】スタイルごとの「色」と「アイコン」の定義
export const STYLE_METADATA = {
    // ラガー系
    '国産ピルスナー': { color: 'gold', icon: '🍺' },
    '糖質オフ/新ジャンル': { color: 'pale', icon: '🍺' },
    'ピルスナー': { color: 'gold', icon: '🍺' },
    'ドルトムンター': { color: 'gold', icon: '🍺' },
    'シュバルツ': { color: 'black', icon: '🍺' },

    // エール系
    'アンバーエール': { color: 'amber', icon: '🍺' },
    'ゴールデンエール': { color: 'gold', icon: '🍺' },
    'ペールエール': { color: 'copper', icon: '🍺' },
    'ジャパニーズエール': { color: 'copper', icon: '🍺' },
    'ヴァイツェン': { color: 'white', icon: '🥛' }, // ヴァイツェングラス的なイメージ
    'ベルジャンホワイト': { color: 'white', icon: '🥛' },
    'セゾン': { color: 'white', icon: '🥂' },

    // IPA系
    'セッションIPA': { color: 'copper', icon: '🍺' },
    'IPA (West Coast)': { color: 'copper', icon: '🍺' },
    'Hazy IPA': { color: 'hazy', icon: '🍹' }, // ジュースのような見た目
    'Hazyペールエール': { color: 'hazy', icon: '🍹' },
    'ダブルIPA (DIPA)': { color: 'copper', icon: '🍺' },

    // 黒系
    'ポーター': { color: 'black', icon: '☕' }, // コーヒーのようなニュアンス
    'スタウト': { color: 'black', icon: '☕' },
    'インペリアルスタウト': { color: 'black', icon: '☕' },

    // ハイアル・特殊
    'ベルジャン・トリペル': { color: 'gold', icon: '🍷' }, // ワイングラスで飲むイメージ
    'バーレイワイン': { color: 'amber', icon: '🍷' },
    'サワーエール': { color: 'red', icon: '🍷' },
    'フルーツビール': { color: 'red', icon: '🍒' },

    'ノンアル': { color: 'green', icon: '🍃' },
};

// 互換性維持のためのマッピング (logic.js変更回避のため既存のSTYLE_COLOR_MAPも残すが、中身は新定義を参照)
export const STYLE_COLOR_MAP = {};
Object.keys(CALORIES.STYLES).forEach(style => {
    STYLE_COLOR_MAP[style] = STYLE_METADATA[style] ? STYLE_METADATA[style].color : 'gold';
});

export const EXERCISE = { 'stepper': { label: 'ステッパー', mets: 6.0, icon: '🏃‍♀️' }, 'walking': { label: 'ウォーキング (通勤等)', mets: 3.5, icon: '🚶' }, 'brisk_walking': { label: '早歩き', mets: 4.5, icon: '👟' }, 'cycling': { label: '自転車 (ゆっくり)', mets: 4.0, icon: '🚲' }, 'training': { label: '筋トレ (パーソナル等)', mets: 5.0, icon: '🏋️' }, 'running': { label: 'ランニング', mets: 7.0, icon: '💨' }, 'hiit': { label: 'HIIT (高強度)', mets: 8.0, icon: '🔥' }, 'yoga': { label: 'ヨガ (ストレッチ)', mets: 2.5, icon: '🧘' }, 'cleaning': { label: '部屋の掃除', mets: 3.0, icon: '🧹' } };
export const SIZE_DATA = { '350': { label: '350ml (缶)', ratio: 1.0 }, '500': { label: '500ml (ロング缶)', ratio: 1.43 }, '473': { label: '473ml (USパイント)', ratio: 1.35 }, '568': { label: '568ml (UKパイント)', ratio: 1.62 }, '250': { label: '250ml (小グラス)', ratio: 0.71 }, '1000': { label: '1L (マース)', ratio: 2.86 } };
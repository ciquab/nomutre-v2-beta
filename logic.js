import { EXERCISE, CALORIES, APP, BEER_COLORS, STYLE_COLOR_MAP } from './constants.js'; 
import dayjs from 'https://cdn.jsdelivr.net/npm/dayjs@1.11.10/+esm';

export const Calc = {
    // 1. 引数 profile を必須化
    getBMR: (profile) => {
        if (!profile) return 0; // 安全策
        const p = profile;

        const k = 1000 / 4.186;
        if(p.gender === 'male') {
            return ((0.0481 * p.weight) + (0.0234 * p.height) - (0.0138 * p.age) - 0.4235) * k;
        } else {
            return ((0.0481 * p.weight) + (0.0234 * p.height) - (0.0138 * p.age) - 0.9708) * k;
        }
    },
    
    // 2. 引数 profile を必須化し、getBMR へ渡す
    burnRate: (mets, profile) => {
        const bmr = Calc.getBMR(profile);
        const netMets = Math.max(0, mets - 1);
        return (bmr / 24 * netMets) / 60;
    },
    
    // 引数 profile を追加
    calculateExerciseKcal: (minutes, exerciseKey, profile) => {
        const exData = EXERCISE[exerciseKey] || EXERCISE['stepper'];
        const rate = Calc.burnRate(exData.mets, profile);
        return minutes * rate;
    },

    // 3. 引数 profile を必須化し、burnRate へ渡す
    convertKcalToMinutes: (kcal, targetExerciseKey, profile) => {
        const exData = EXERCISE[targetExerciseKey] || EXERCISE['stepper'];
        const rate = Calc.burnRate(exData.mets, profile);
        if (rate === 0) return 0;
        return Math.round(kcal / rate);
    },

    convertKcalToBeerCount: (kcal, beerStyle) => {
        const unitKcal = CALORIES.STYLES[beerStyle];
        if (!unitKcal) return 0;
        return Math.round((kcal / unitKcal) * 10) / 10; // 小数1桁
    },

    // 4. 引数 profile を必須化
    stepperEq: (kcal, profile) => {
        return Calc.convertKcalToMinutes(kcal, 'stepper', profile);
    },
    
    calculateAlcoholKcal: (ml, abv, type) => {
        const alcoholG = ml * (abv / 100) * 0.8;
        let kcal = alcoholG * 7;
        if (type === 'sweet') {
             kcal += ml * 0.15;
        }
        return kcal;
    },

    // settings ({ modes, baseExercise }) と profile を引数に追加
    getTankDisplayData: (currentKcalBalance, currentBeerMode, settings, profile) => {
        const modes = settings.modes;
        const targetStyle = currentBeerMode === 'mode1' ? modes.mode1 : modes.mode2;
        const unitKcal = CALORIES.STYLES[targetStyle] || 145;
        
        const colorKey = STYLE_COLOR_MAP[targetStyle] || 'default';
        const liquidColor = BEER_COLORS[colorKey];
        const isHazy = (colorKey === 'hazy');

        // カロリーベースで計算
        const canCount = parseFloat((currentKcalBalance / unitKcal).toFixed(1));

        const baseEx = settings.baseExercise;
        const baseExData = EXERCISE[baseEx] || EXERCISE['stepper'];
        
        // カロリーから表示時間を計算
        const displayMinutes = Calc.convertKcalToMinutes(currentKcalBalance, baseEx, profile);
        const displayRate = Calc.burnRate(baseExData.mets, profile);
        
        return {
            targetStyle,
            canCount,
            displayMinutes,
            baseExData,
            unitKcal,
            displayRate,
            totalKcal: currentKcalBalance,
            liquidColor,
            isHazy
        };
    },
    
    isSameDay: (ts1, ts2) => dayjs(ts1).isSame(dayjs(ts2), 'day'),
    
    // profile 引数を追加 (互換計算でburnRateを使うため)
    getDayStatus: (date, logs, checks, profile) => {
        const targetDay = dayjs(date);
        const dayLogs = logs.filter(l => targetDay.isSame(dayjs(l.timestamp), 'day'));
        
        let balance = 0;
        let hasAlcohol = false;
        let hasExercise = false;

        dayLogs.forEach(l => {
            // kcalがあればkcal、なければ互換用minutesを使用 (burnRateにprofileを渡す)
            const val = l.kcal !== undefined ? l.kcal : (l.minutes * Calc.burnRate(6.0, profile));
            balance += val;
            
            if (val < 0) hasAlcohol = true;
            if (val > 0) hasExercise = true;
        });
        
        const isRepaid = hasAlcohol && balance >= -1;

        const isDryCheck = checks.some(c => c.isDryDay && targetDay.isSame(dayjs(c.timestamp), 'day'));
        
        if (isDryCheck) {
            return hasExercise ? 'rest_exercise' : 'rest';
        }
        if (hasAlcohol) {
            if (isRepaid) return 'drink_exercise_success'; 
            return hasExercise ? 'drink_exercise' : 'drink';
        }
        if (hasExercise) {
            return 'exercise';
        }
        return 'none';
    },

    // profile 引数を追加
    getCurrentStreak: (logs, checks, profile) => {
        return Calc.getStreakAtDate(dayjs(), logs, checks, profile);
    },

    // profile 引数を追加
    getStreakAtDate: (dateInput, logs, checks, profile) => {
        let streak = 0;
        const baseDate = dayjs(dateInput); 
        for (let i = 1; i <= 30; i++) {
            const d = baseDate.subtract(i, 'day');
            const status = Calc.getDayStatus(d, logs, checks, profile);
            
            if (status === 'rest' || status === 'rest_exercise' || status === 'drink_exercise_success') {
                streak++;
            } else {
                break;
            }
        }
        return streak;
    },

    getStreakMultiplier: (streak) => {
        if (streak >= 3) return 1.2;
        if (streak >= 2) return 1.1;
        return 1.0;
    },

    // profile不要 (minutesの正負判定のみ)
    hasAlcoholLog: (logs, timestamp) => {
        const target = dayjs(timestamp);
        return logs.some(l => (l.kcal !== undefined ? l.kcal : l.minutes) < 0 && target.isSame(dayjs(l.timestamp), 'day'));
    },
    
    getDryDayCount: (checks) => {
        const uniqueDays = new Set();
        checks.forEach(c => {
            if (c.isDryDay) uniqueDays.add(dayjs(c.timestamp).format('YYYY-MM-DD'));
        });
        return uniqueDays.size;
    },

    // profile 引数を追加
    getRecentGrade: (checks, logs = [], profile) => {
        const NOW = dayjs();
        const PERIOD_DAYS = 28; 
        
        let startTs = NOW.valueOf();
        if (checks.length > 0) startTs = Math.min(startTs, checks[0].timestamp);
        if (logs.length > 0) startTs = Math.min(startTs, logs[logs.length-1].timestamp); 

        const daysSinceStart = Math.max(1, NOW.diff(dayjs(startTs), 'day'));
        const cutoffDate = NOW.subtract(PERIOD_DAYS, 'day').startOf('day');

        const successDays = new Set();

        checks.forEach(c => {
            if (c.isDryDay && dayjs(c.timestamp).isAfter(cutoffDate)) {
                successDays.add(dayjs(c.timestamp).format('YYYY-MM-DD'));
            }
        });

        const dailyBalances = {};
        logs.forEach(l => {
            const d = dayjs(l.timestamp);
            if (d.isAfter(cutoffDate)) {
                const key = d.format('YYYY-MM-DD');
                // profile を渡して計算
                const val = l.kcal !== undefined ? l.kcal : (l.minutes * Calc.burnRate(6.0, profile)); 
                dailyBalances[key] = (dailyBalances[key] || 0) + val;
            }
        });

        Object.keys(dailyBalances).forEach(dateStr => {
            if (dailyBalances[dateStr] >= 0) {
                successDays.add(dateStr);
            }
        });

        const recentSuccessDays = successDays.size;

        if (daysSinceStart < 28) {
            const rate = recentSuccessDays / daysSinceStart;
            if (rate >= 0.7) return { rank: 'Rookie S', label: '新星 🌟', color: 'text-orange-500', bg: 'bg-orange-100', next: 1, current: recentSuccessDays, isRookie: true, rawRate: rate, targetRate: 1.0 };
            if (rate >= 0.4) return { rank: 'Rookie A', label: '期待の星 🔥', color: 'text-indigo-500', bg: 'bg-indigo-100', next: 1, current: recentSuccessDays, isRookie: true, rawRate: rate, targetRate: 0.7 };
            if (rate >= 0.25) return { rank: 'Rookie B', label: '駆け出し 🐣', color: 'text-green-500', bg: 'bg-green-100', next: 1, current: recentSuccessDays, isRookie: true, rawRate: rate, targetRate: 0.4 };
            return { rank: 'Beginner', label: 'たまご 🥚', color: 'text-gray-500', bg: 'bg-gray-100', next: 1, current: recentSuccessDays, isRookie: true, rawRate: rate, targetRate: 0.25 };
        }

        if (recentSuccessDays >= 20) return { rank: 'S', label: '神の肝臓 👼', color: 'text-purple-600', bg: 'bg-purple-100', next: null, current: recentSuccessDays };
        if (recentSuccessDays >= 12) return { rank: 'A', label: '鉄の肝臓 🛡️', color: 'text-indigo-600', bg: 'bg-indigo-100', next: 20, current: recentSuccessDays };
        if (recentSuccessDays >= 8)  return { rank: 'B', label: '健康志向 🌿', color: 'text-green-600', bg: 'bg-green-100', next: 12, current: recentSuccessDays };
        return { rank: 'C', label: '要注意 ⚠️', color: 'text-red-500', bg: 'bg-red-50', next: 8, current: recentSuccessDays };
    }

};
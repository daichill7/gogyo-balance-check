/* 四柱推命 計算エンジン(専門家監修前ドラフト)
   生年月日・時刻・都道府県 → 命式(年柱・月柱・日柱・時柱)と五行バランスを算出する。
   節入りは略算の固定日(±1日誤差の可能性あり)。監修で精緻化予定。 */

const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const STEM_READINGS = ["きのえ", "きのと", "ひのえ", "ひのと", "つちのえ", "つちのと", "かのえ", "かのと", "みずのえ", "みずのと"];
const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const BRANCH_READINGS = ["ね", "うし", "とら", "う", "たつ", "み", "うま", "ひつじ", "さる", "とり", "いぬ", "い"];

/* 天干の五行(甲乙=木 丙丁=火 戊己=土 庚辛=金 壬癸=水) */
const STEM_ELEMENT = ["wood", "wood", "fire", "fire", "earth", "earth", "metal", "metal", "water", "water"];
/* 地支の五行(本気) */
const BRANCH_ELEMENT = ["water", "earth", "wood", "wood", "earth", "fire", "fire", "earth", "metal", "metal", "earth", "water"];
/* 地支の蔵干(本気・中気・余気)と重み */
const HIDDEN_STEMS = [
  [["癸", 1.0]],                             // 子
  [["己", 0.6], ["癸", 0.25], ["辛", 0.15]], // 丑
  [["甲", 0.6], ["丙", 0.25], ["戊", 0.15]], // 寅
  [["乙", 1.0]],                             // 卯
  [["戊", 0.6], ["乙", 0.25], ["癸", 0.15]], // 辰
  [["丙", 0.6], ["庚", 0.25], ["戊", 0.15]], // 巳
  [["丁", 0.7], ["己", 0.3]],                // 午
  [["己", 0.6], ["丁", 0.25], ["乙", 0.15]], // 未
  [["庚", 0.6], ["壬", 0.25], ["戊", 0.15]], // 申
  [["辛", 1.0]],                             // 酉
  [["戊", 0.6], ["辛", 0.25], ["丁", 0.15]], // 戌
  [["壬", 0.7], ["甲", 0.3]]                 // 亥
];

/* 節入りの略算日(月柱の切替日)。index=月(1〜12)、値=その月の節入り日 */
const SETSU_DAY = { 1: 6, 2: 4, 3: 6, 4: 5, 5: 6, 6: 6, 7: 7, 8: 8, 9: 8, 10: 8, 11: 7, 12: 7 };

/* 都道府県の代表経度(時差補正用。明石=東経135度が基準) */
const PREF_LONGITUDE = {
  "北海道": 141.35, "青森県": 140.74, "岩手県": 141.15, "宮城県": 140.87, "秋田県": 140.10,
  "山形県": 140.36, "福島県": 140.47, "茨城県": 140.45, "栃木県": 139.88, "群馬県": 139.06,
  "埼玉県": 139.65, "千葉県": 140.12, "東京都": 139.69, "神奈川県": 139.64, "新潟県": 139.02,
  "富山県": 137.21, "石川県": 136.63, "福井県": 136.22, "山梨県": 138.57, "長野県": 138.18,
  "岐阜県": 136.72, "静岡県": 138.38, "愛知県": 136.91, "三重県": 136.51, "滋賀県": 135.87,
  "京都府": 135.76, "大阪府": 135.52, "兵庫県": 135.18, "奈良県": 135.83, "和歌山県": 135.17,
  "鳥取県": 134.24, "島根県": 133.05, "岡山県": 133.93, "広島県": 132.46, "山口県": 131.47,
  "徳島県": 134.56, "香川県": 134.04, "愛媛県": 132.77, "高知県": 133.53, "福岡県": 130.42,
  "佐賀県": 130.30, "長崎県": 129.87, "熊本県": 130.74, "大分県": 131.61, "宮崎県": 131.42,
  "鹿児島県": 130.56, "沖縄県": 127.68
};

/* グレゴリオ暦 → ユリウス通日 */
function julianDayNumber(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/* 日柱: (JDN + 49) % 60 → 甲子=0 の六十干支 */
function dayPillar(y, m, d) {
  const idx = ((julianDayNumber(y, m, d) + 49) % 60 + 60) % 60;
  return { stem: idx % 10, branch: idx % 12 };
}

/* 年柱: 立春(2/4頃)で年替わり */
function yearPillar(y, m, d) {
  let year = y;
  if (m < 2 || (m === 2 && d < SETSU_DAY[2])) year -= 1;
  return { stem: ((year - 4) % 10 + 10) % 10, branch: ((year - 4) % 12 + 12) % 12, adjustedYear: year };
}

/* 月柱: 節入りで月替わり。月支は寅=1月(立春〜)、月干は五虎遁 */
function monthPillar(y, m, d, yearStem) {
  let monthIdx = m; // 節入り前なら前月扱い
  if (d < SETSU_DAY[m]) monthIdx = m - 1;
  if (monthIdx < 1) monthIdx = 12;
  // 節月番号: 2月(立春)=1(寅月) … 1月(小寒)=12(丑月)
  const setsuMonth = monthIdx >= 2 ? monthIdx - 1 : 11 + monthIdx;
  const branch = (setsuMonth + 1) % 12; // 寅=2
  // 五虎遁: 年干から寅月の月干が決まる(甲己→丙寅、乙庚→戊寅、丙辛→庚寅、丁壬→壬寅、戊癸→甲寅)
  const startStem = [2, 4, 6, 8, 0][yearStem % 5];
  const stem = (startStem + (setsuMonth - 1)) % 10;
  return { stem, branch };
}

/* 時柱: 2時間ごとの十二支。時干は五鼠遁(日干から子刻の時干が決まる) */
function hourPillar(hour, minute, dayStem) {
  const t = hour + minute / 60;
  // 23時〜1時=子, 1〜3=丑, …
  const branch = Math.floor(((t + 1) % 24) / 2);
  const startStem = [0, 2, 4, 6, 8][dayStem % 5]; // 甲己→甲子、乙庚→丙子、丙辛→戊子、丁壬→庚子、戊癸→壬子
  const stem = (startStem + branch) % 10;
  return { stem, branch };
}

/* 五行バランス: 四柱の天干+地支蔵干(重みつき)を集計 */
function countElements(pillars) {
  const counts = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  for (const p of pillars) {
    if (!p) continue;
    counts[STEM_ELEMENT[p.stem]] += 1.0;
    for (const [hs, w] of HIDDEN_STEMS[p.branch]) {
      counts[STEM_ELEMENT[STEMS.indexOf(hs)]] += w;
    }
  }
  return counts;
}

/* メイン: 命式を計算する
   input: { year, month, day, hour(0-23|null), minute, prefecture(string|null) } */
function computeMeishiki(input) {
  let { year, month, day, hour, minute, prefecture } = input;
  minute = minute || 0;
  const hasTime = hour !== null && hour !== undefined && hour !== "";

  // 地方時補正(経度1度=4分。標準時=東経135度)
  let corrected = null;
  if (hasTime && prefecture && PREF_LONGITUDE[prefecture]) {
    const diffMin = Math.round((PREF_LONGITUDE[prefecture] - 135) * 4);
    const dt = new Date(year, month - 1, day, Number(hour), minute + diffMin);
    corrected = { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes(), diffMin };
  } else if (hasTime) {
    corrected = { y: year, m: month, d: day, h: Number(hour), mi: minute, diffMin: 0 };
  }

  const baseDate = corrected
    ? (() => {
        // 23時以降は翌日の子刻として日柱を進める(夜子時は流派差あり: ここでは翌日扱い)
        if (corrected.h >= 23) {
          const nd = new Date(corrected.y, corrected.m - 1, corrected.d + 1);
          return { y: nd.getFullYear(), m: nd.getMonth() + 1, d: nd.getDate() };
        }
        return { y: corrected.y, m: corrected.m, d: corrected.d };
      })()
    : { y: year, m: month, d: day };

  const yp = yearPillar(baseDate.y, baseDate.m, baseDate.d);
  const mp = monthPillar(baseDate.y, baseDate.m, baseDate.d, yp.stem);
  const dp = dayPillar(baseDate.y, baseDate.m, baseDate.d);
  const hp = corrected ? hourPillar(corrected.h, corrected.mi, dp.stem) : null;

  const pillars = [yp, mp, dp, hp].filter(Boolean);
  const counts = countElements(pillars);

  // 傾向 = 最も比重の大きい五行(同数なら月支の五行を優先)
  let tendency = "wood";
  let best = -1;
  const monthEl = BRANCH_ELEMENT[mp.branch];
  for (const el of ["wood", "fire", "earth", "metal", "water"]) {
    const score = counts[el] + (el === monthEl ? 0.01 : 0);
    if (score > best) { best = score; tendency = el; }
  }

  const fmt = (p) => p ? {
    stem: p.stem, branch: p.branch,
    label: STEMS[p.stem] + BRANCHES[p.branch],
    stemChar: STEMS[p.stem], branchChar: BRANCHES[p.branch],
    stemReading: STEM_READINGS[p.stem], branchReading: BRANCH_READINGS[p.branch],
    stemElement: STEM_ELEMENT[p.stem], branchElement: BRANCH_ELEMENT[p.branch]
  } : null;

  return {
    year: fmt(yp), month: fmt(mp), day: fmt(dp), hour: fmt(hp),
    dayStem: dp.stem,
    dayStemChar: STEMS[dp.stem],
    counts, tendency,
    hasTime: !!corrected,
    timeCorrectionMin: corrected ? corrected.diffMin : null,
    spiritKey: `${STEMS[dp.stem]}-${tendency}`
  };
}

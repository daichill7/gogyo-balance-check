/* 四柱推命モード: 入力フォーム → 命式計算(shichusuimei.js) → 精霊カード表示 */
let SPIRITS = null;
let fortuneInited = false;
const FORTUNE_SAVE_KEY = "gogyo_fortune_v1";

const EL_JP = { wood: "木", fire: "火", earth: "土", metal: "金", water: "水" };
const EL_COLOR = { wood: "#35d98a", fire: "#ff5f6e", earth: "#ffb347", metal: "#aebfd6", water: "#3fa8ff" };

async function initFortuneMode() {
  if (fortuneInited) return;
  fortuneInited = true;
  const res = await fetch("data/spirits.json");
  SPIRITS = await res.json();

  // 年月日セレクトを生成
  const selY = document.querySelector("#fortune-year");
  const now = new Date().getFullYear();
  for (let y = now; y >= 1930; y--) selY.add(new Option(`${y}年`, y));
  selY.value = 1990;
  const selM = document.querySelector("#fortune-month");
  for (let m = 1; m <= 12; m++) selM.add(new Option(`${m}月`, m));
  const selD = document.querySelector("#fortune-day");
  for (let d = 1; d <= 31; d++) selD.add(new Option(`${d}日`, d));
  const selH = document.querySelector("#fortune-hour");
  selH.add(new Option("時間不明・入力しない", ""));
  for (let h = 0; h < 24; h++) selH.add(new Option(`${h}時台`, h));
  const selP = document.querySelector("#fortune-pref");
  selP.add(new Option("都道府県(任意)", ""));
  for (const p of Object.keys(PREF_LONGITUDE)) selP.add(new Option(p, p));

  document.querySelector("#fortune-run").addEventListener("click", runFortune);
  document.querySelector("#fortune-disclaimer").textContent = SPIRITS.disclaimer;

  // 前回の結果があれば復元導線を出す
  try {
    const saved = JSON.parse(localStorage.getItem(FORTUNE_SAVE_KEY));
    if (saved && saved.input) {
      const bar = document.querySelector("#fortune-last");
      bar.classList.remove("hidden");
      const [stemChar, tendencyKey] = saved.key.split("-");
      const tendencyName = SPIRITS.tendencies[tendencyKey]?.name || tendencyKey;
      bar.querySelector(".fortune-last-label").textContent =
        `前回の結果: ${saved.spiritName}(${stemChar}×${tendencyName})`;
      bar.querySelector("button").addEventListener("click", () => {
        applyInput(saved.input);
        runFortune();
      });
    }
  } catch (e) { /* noop */ }
}

function applyInput(inp) {
  document.querySelector("#fortune-year").value = inp.year;
  document.querySelector("#fortune-month").value = inp.month;
  document.querySelector("#fortune-day").value = inp.day;
  document.querySelector("#fortune-hour").value = inp.hour ?? "";
  document.querySelector("#fortune-pref").value = inp.prefecture || "";
}

function readInput() {
  return {
    year: Number(document.querySelector("#fortune-year").value),
    month: Number(document.querySelector("#fortune-month").value),
    day: Number(document.querySelector("#fortune-day").value),
    hour: document.querySelector("#fortune-hour").value === "" ? null : Number(document.querySelector("#fortune-hour").value),
    minute: 0,
    prefecture: document.querySelector("#fortune-pref").value || null
  };
}

function pillarCard(title, p) {
  if (!p) return `
    <div class="pillar-card pillar-empty">
      <p class="pillar-title">${title}</p>
      <p class="pillar-kanji">—</p>
      <p class="pillar-note">時間未入力</p>
    </div>`;
  return `
    <div class="pillar-card">
      <p class="pillar-title">${title}</p>
      <p class="pillar-kanji">
        <span style="color:${EL_COLOR[p.stemElement]}">${p.stemChar}</span><span style="color:${EL_COLOR[p.branchElement]}">${p.branchChar}</span>
      </p>
      <p class="pillar-note">${p.stemReading}・${p.branchReading}</p>
    </div>`;
}

function runFortune() {
  const input = readInput();
  // 日付の妥当性(2/30など)
  const dt = new Date(input.year, input.month - 1, input.day);
  if (dt.getMonth() + 1 !== input.month || dt.getDate() !== input.day) {
    showToast("存在しない日付です。月日を確認してください");
    return;
  }

  const m = computeMeishiki(input);
  const spirit = SPIRITS.spirits[`${m.dayStemChar}-${m.tendency}`];
  const stem = SPIRITS.stems[m.dayStemChar];
  const tend = SPIRITS.tendencies[m.tendency];
  const imgFile = `assets/spirits/${m.dayStem}-${m.tendency}.webp`;
  const typeLabel = `${m.dayStemChar}×${tend.name}`;

  // 五行バランスの正規化
  const totalCount = Object.values(m.counts).reduce((a, b) => a + b, 0);
  const bars = ["wood", "fire", "earth", "metal", "water"].map((el) => {
    const pct = Math.round((m.counts[el] / totalCount) * 100);
    return `
      <div class="el-bar-row">
        <span class="el-bar-label" style="color:${EL_COLOR[el]}">${EL_JP[el]}</span>
        <div class="el-bar-track"><div class="el-bar-fill" style="width:${pct}%;background:${EL_COLOR[el]}"></div></div>
        <span class="el-bar-pct">${pct}%</span>
      </div>`;
  }).join("");

  const html = `
    <div class="result-card fortune-hero">
      <p class="fortune-type-label">${typeLabel} タイプ</p>
      <div class="fortune-portrait-wrap"><img class="fortune-portrait" src="${imgFile}" alt="${spirit.name}"></div>
      <p class="fortune-name">${spirit.name}</p>
      <p class="fortune-catch">${spirit.catch}</p>
      <p class="fortune-essence">${stem.essence}</p>
    </div>

    <div class="result-card">
      <h3>あなたの命式</h3>
      <div class="pillar-row">
        ${pillarCard("年柱", m.year)}${pillarCard("月柱", m.month)}${pillarCard("日柱", m.day)}${pillarCard("時柱", m.hour)}
      </div>
      <p class="cycle-caption">日柱の上の字(日干)= あなたの本質。${m.hasTime && m.timeCorrectionMin ? `出生地の時差補正: ${m.timeCorrectionMin > 0 ? "+" : ""}${m.timeCorrectionMin}分。` : ""}${m.hasTime ? "" : "出生時間を入れると時柱まで揃います。"}</p>
    </div>

    <div class="result-card">
      <h3>五行バランス</h3>
      ${bars}
      <p class="cycle-caption">もっとも強い「${EL_JP[m.tendency]}」があなたのエネルギー傾向(${tend.name})です</p>
    </div>

    <div class="result-card">
      <h3>性格</h3><p>${stem.personality}</p>
    </div>
    <div class="result-card">
      <h3>恋愛</h3><p>${stem.love}</p>
    </div>
    <div class="result-card">
      <h3>仕事</h3><p>${stem.work}</p>
    </div>
    <div class="result-card">
      <h3>才能</h3><p>${stem.talent}</p>
    </div>
    <div class="result-card">
      <h3>五行で見るエネルギー傾向 — ${tend.name}(${tend.reading})</h3>
      <p class="relation-label" style="margin-bottom:8px">${tend.aura}</p>
      <p>${tend.energy}</p>
    </div>

    <div class="result-actions result-subactions">
      <button class="secondary-btn" id="fortune-save-btn">💾 この結果を保存</button>
      <button class="secondary-btn" id="fortune-share-btn">🔗 結果をシェア</button>
    </div>
    <div class="result-actions">
      <button class="primary-btn village-btn" id="fortune-village-btn">🏡 この精霊で「五行の村」に参加する</button>
    </div>
    <p class="disclaimer-note">${SPIRITS.disclaimer}</p>`;

  const box = document.querySelector("#fortune-result");
  box.innerHTML = html;
  box.scrollIntoView({ behavior: "smooth", block: "start" });

  document.querySelector("#fortune-save-btn").addEventListener("click", () => {
    try {
      localStorage.setItem(FORTUNE_SAVE_KEY, JSON.stringify({
        t: Date.now(), input, key: `${m.dayStemChar}-${m.tendency}`, spiritName: spirit.name
      }));
      showToast("結果を端末に保存しました(次回この画面で呼び出せます)");
    } catch (e) {
      showToast("保存できませんでした");
    }
  });
  document.querySelector("#fortune-share-btn").addEventListener("click", () => {
    doShare("わたしの精霊タイプ",
      `四柱推命で診断したら、わたしは ${typeLabel}「${spirit.name}」(${spirit.catch})でした`);
  });
  document.querySelector("#fortune-village-btn").addEventListener("click", () => {
    // 未保存でも村で名刺を作れるよう、参加時に自動保存する
    try {
      localStorage.setItem(FORTUNE_SAVE_KEY, JSON.stringify({
        t: Date.now(), input, key: `${m.dayStemChar}-${m.tendency}`, spiritName: spirit.name
      }));
    } catch (e) { /* noop */ }
    setMode("village");
  });
}

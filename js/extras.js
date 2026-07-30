/* Phase1 追加機能: シェア / 結果保存(端末内) / 問い合わせフォーム / 広告枠
   app.js と同じグローバルスコープで動く(state, DATA, computeAssessment 等を参照) */

const APP_URL = "https://gogyo-balance-check.netlify.app/";
const SAVE_KEY = "gogyo_saved_results_v1";

/* ---------- 共通: シェア ---------- */
async function doShare(title, text) {
  const payload = { title, text, url: APP_URL };
  if (navigator.share) {
    try {
      await navigator.share(payload);
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // ユーザーがキャンセル
    }
  }
  // フォールバック: クリップボードにコピー
  try {
    await navigator.clipboard.writeText(`${text}\n${APP_URL}`);
    showToast("リンクをコピーしました。SNSなどに貼り付けてシェアできます");
  } catch (e) {
    prompt("このURLをコピーしてシェアしてください", APP_URL);
  }
}

function showToast(msg) {
  let t = document.querySelector("#app-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "app-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- 結果の保存(localStorage) ---------- */
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function storeSaved(list) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 30))); // 最大30件
  } catch (e) { /* プライベートモード等では保存不可 */ }
}

function currentResultSnapshot() {
  if (!state.region || !state.symptom) return null;
  const a = computeAssessment();
  const root = DATA.patterns[a.finalRootId];
  return {
    t: Date.now(),
    r: state.region.id,
    s: state.symptom.id,
    d: Object.fromEntries(Object.entries(state.details).map(([gid, opt]) => [gid, opt.id])),
    a: Object.fromEntries(Object.entries(state.answers).map(([qid, opt]) => {
      const q = DATA.interview.find((x) => x.id === qid);
      return [qid, q ? q.options.indexOf(opt) : -1];
    })),
    p: root.name,
    label: `${state.region.label}: ${state.symptom.label}`
  };
}

function saveCurrentResult() {
  const snap = currentResultSnapshot();
  if (!snap) return;
  const list = loadSaved();
  list.unshift(snap);
  storeSaved(list);
  renderSavedList();
  showToast("この結果を端末に保存しました(トップ画面から見返せます)");
}

function restoreResult(snap) {
  const region = DATA.regions.find((r) => r.id === snap.r);
  const sym = region && region.symptoms.find((s) => s.id === snap.s);
  if (!region || !sym) {
    showToast("この保存データは現在のバージョンでは開けませんでした");
    return;
  }
  selectRegion(region.id); // stateとUIを整える
  state.symptom = sym;
  state.details = {};
  for (const group of region.details || []) {
    const optId = snap.d && snap.d[group.id];
    if (!optId) continue;
    const opt = group.options.find((o) => o.id === optId);
    if (opt) state.details[group.id] = opt;
  }
  state.answers = {};
  for (const q of DATA.interview) {
    const idx = snap.a ? snap.a[q.id] : -1;
    if (idx >= 0 && q.options[idx]) state.answers[q.id] = q.options[idx];
  }
  renderResult();
  showStep("result");
}

function renderSavedList() {
  const block = document.querySelector("#saved-block");
  const listEl = document.querySelector("#saved-list");
  if (!block || !listEl) return;
  const list = loadSaved();
  block.classList.toggle("hidden", list.length === 0);
  listEl.innerHTML = "";
  list.forEach((snap, i) => {
    const d = new Date(snap.t);
    const item = document.createElement("div");
    item.className = "saved-item";
    item.innerHTML = `
      <button class="saved-open" type="button">
        <span class="saved-date">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span>
        <span class="saved-label">${snap.label}</span>
        <span class="saved-pattern">→ ${snap.p}</span>
      </button>
      <button class="saved-del" type="button" aria-label="削除">🗑</button>`;
    item.querySelector(".saved-open").addEventListener("click", () => restoreResult(snap));
    item.querySelector(".saved-del").addEventListener("click", () => {
      const l = loadSaved();
      l.splice(i, 1);
      storeSaved(l);
      renderSavedList();
    });
    listEl.appendChild(item);
  });
}

/* ---------- 問い合わせモーダル(Netlify Forms) ---------- */
function openContact(kind) {
  const modal = document.querySelector("#contact-modal");
  modal.classList.remove("hidden");
  document.querySelector("#contact-form").classList.remove("hidden");
  document.querySelector("#contact-thanks").classList.add("hidden");
  if (kind) document.querySelector("#contact-kind").value = kind;
}

function closeContact() {
  document.querySelector("#contact-modal").classList.add("hidden");
}

async function submitContact(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.querySelector("#contact-submit");
  btn.disabled = true;
  btn.textContent = "送信中…";
  try {
    const res = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(new FormData(form)).toString()
    });
    if (!res.ok) throw new Error("send failed");
    form.classList.add("hidden");
    document.querySelector("#contact-thanks").classList.remove("hidden");
    form.reset();
  } catch (err) {
    showToast("送信に失敗しました。時間をおいてもう一度お試しください");
  } finally {
    btn.disabled = false;
    btn.textContent = "送信する";
  }
}

/* ---------- 診断結果に連動した商品(楽天アフィリエイト・PR) ---------- */
let PRODUCTS = null;

async function loadProducts() {
  if (PRODUCTS) return PRODUCTS;
  try {
    const res = await fetch("data/products.json");
    PRODUCTS = await res.json();
  } catch (e) {
    PRODUCTS = { byPattern: {} };
  }
  return PRODUCTS;
}

/* 商品リストのHTMLを組み立てる */
function buildPrCard(items, title, note) {
  const cards = items.map((i) => `
    <a class="pr-item" href="${i.url}" target="_blank" rel="noopener sponsored nofollow">
      ${i.img ? `<img class="pr-img" src="${i.img}" alt="" decoding="async">` : ""}
      <span class="pr-body">
        <span class="pr-name">${i.name}</span>
        <span class="pr-price">¥${Number(i.price).toLocaleString()}</span>
      </span>
    </a>`).join("");
  const card = document.createElement("div");
  card.className = "result-card pr-card";
  card.innerHTML = `
    <h3>${title} <span class="pr-badge">PR</span></h3>
    <p class="pr-note">${note}</p>
    <div class="pr-grid">${cards}</div>`;
  return card;
}

/* 結果画面に「この結果に合うおすすめ(PR)」を差し込む。patternId = P01 等 */
async function renderProductsFor(patternId, container) {
  const data = await loadProducts();
  const items = (data.byPattern && data.byPattern[patternId]) || [];
  if (!items.length || !container) return;
  const card = buildPrCard(items, "この結果に合うおすすめ", "食養生にちなんだ商品(楽天市場)。効果の保証はありません");
  // 「ハーブティーと香り」カードの直下に差し込む(なければ免責文の手前)
  const herbCard = [...container.querySelectorAll(".result-card")].find(
    (c) => c.querySelector("h3")?.textContent.trim() === "ハーブティーと香り"
  );
  if (herbCard) herbCard.after(card);
  else {
    const disclaimer = container.querySelector(".disclaimer-note");
    if (disclaimer) container.insertBefore(card, disclaimer);
    else container.appendChild(card);
  }
}

/* 「からだを知る」の部位図鑑の下に、セルフケア用品のPRを差し込む */
async function renderMassageProducts() {
  const holder = document.querySelector("#massage-pr");
  if (!holder || holder.dataset.done) return;
  const data = await loadProducts();
  const items = (data.byTopic && data.byTopic.massage) || [];
  if (!items.length) return;
  holder.appendChild(buildPrCard(items, "セルフケアに使えるもの", "ツボ押し・マッサージ用品(楽天市場)。効果の保証はありません"));
  holder.dataset.done = "1";
}

/* ---------- 広告枠 ---------- */
async function initAdSlot() {
  const box = document.querySelector("#ad-content");
  if (!box) return;
  let ads = [];
  try {
    const res = await fetch("data/ads.json");
    ads = (await res.json()).ads || [];
  } catch (e) { /* 読み込めなければハウス広告 */ }
  const active = ads.filter((a) => a.active !== false);
  const ad = active.length
    ? active[Math.floor(Math.random() * active.length)]
    : { text: "このアプリを一緒に育ててくれるスポンサーを募集しています", cta: "広告掲載のご案内", action: "contact-ad" };

  if (ad.action === "contact-ad") {
    box.innerHTML = `<span class="ad-text">${ad.text}</span><button class="ad-cta" type="button">${ad.cta}</button>`;
    box.querySelector(".ad-cta").addEventListener("click", () => openContact("広告掲載のご相談"));
  } else {
    box.innerHTML = `<a class="ad-link" href="${ad.url}" target="_blank" rel="noopener sponsored"><span class="ad-text">${ad.text}</span><span class="ad-cta">${ad.cta || "詳しく見る"}</span></a>`;
  }
}

/* ---------- 初期化(app.jsのDATA読込を待つ) ---------- */
function initExtras() {
  document.querySelector("#share-app-btn").addEventListener("click", () =>
    doShare("五行バランスチェック", "症状から東洋医学の五行で「根本の乱れ」をたどるセルフチェックアプリ")
  );
  document.querySelector("#share-result-btn").addEventListener("click", () => {
    const snap = currentResultSnapshot();
    const text = snap
      ? `五行バランスチェックで「${snap.label}」をチェック → 根本の乱れの候補は「${snap.p}」でした`
      : "五行バランスチェック";
    doShare("五行バランスチェックの結果", text);
  });
  document.querySelector("#save-result-btn").addEventListener("click", saveCurrentResult);
  document.querySelector("#contact-open-btn").addEventListener("click", () => openContact());
  document.querySelector("#contact-close").addEventListener("click", closeContact);
  document.querySelector("#contact-modal").addEventListener("click", (e) => {
    if (e.target.id === "contact-modal") closeContact();
  });
  document.querySelector("#contact-form").addEventListener("submit", submitContact);
  initAdSlot();
}

(function waitForData() {
  if (typeof DATA !== "undefined" && DATA) {
    initExtras();
    renderSavedList();
    // PWA: Service Worker登録
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* 未対応環境は無視 */ });
    }
    // ディープリンク(#room/xxx や #village)で村へ直行
    if (typeof villageHandleHash === "function") villageHandleHash();
  } else {
    setTimeout(waitForData, 120);
  }
})();

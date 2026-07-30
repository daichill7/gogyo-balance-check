/* 五行バランスチェック v0.2 */
let DATA = null;
const state = {
  region: null,
  symptom: null,
  details: {},      // {detailId: 選択したoption}
  answers: {},      // {questionId: 選択したoption}
  interviewIdx: 0
};

const ELEMENT_ORDER = ["wood", "fire", "earth", "metal", "water"];
const STEPS = ["region", "symptom", "detail", "interview", "result"];

const $ = (sel) => document.querySelector(sel);

init();

async function init() {
  const res = await fetch("data/mapping.json");
  DATA = await res.json();
  $("#footer-disclaimer").textContent = DATA.disclaimer;
  $("#redflag-list-top").innerHTML = DATA.redFlags.map((r) => `<li>${r}</li>`).join("");
  renderBodyFigureStep1();
  renderRegionButtons();

  // モード切替(症状チェック / からだを知る / 四柱推命)
  $("#tab-check").addEventListener("click", () => setMode("check"));
  $("#tab-learn").addEventListener("click", () => setMode("learn"));
  $("#tab-fortune").addEventListener("click", () => setMode("fortune"));
  $("#tab-village").addEventListener("click", () => setMode("village"));

  $("#back-to-region").addEventListener("click", () => showStep("region"));
  $("#back-to-symptom").addEventListener("click", () => showStep("symptom"));
  $("#back-from-interview").addEventListener("click", () => interviewBack());
  $("#detail-next").addEventListener("click", () => startInterview());
  $("#interview-skip").addEventListener("click", () => finishToResult());
  $("#restart-btn").addEventListener("click", () => {
    resetSelections(true);
    showStep("region");
  });

  // ブラウザの「戻る」でもステップを戻れるようにする
  history.replaceState({ step: "region" }, "");
  window.addEventListener("popstate", (e) => {
    let step = (e.state && e.state.step) || "region";
    if ((step === "result" || step === "interview" || step === "detail") && !state.symptom) step = "region";
    if (step === "symptom" && !state.region) step = "region";
    showStep(step, false);
  });
}

function resetSelections(all) {
  state.details = {};
  state.answers = {};
  state.interviewIdx = 0;
  if (all) {
    state.region = null;
    state.symptom = null;
  }
}

function showStep(name, push = true) {
  STEPS.forEach((s) => $("#step-" + s).classList.toggle("hidden", s !== name));
  if (push) history.pushState({ step: name }, "");
  $("#step-" + name).focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setMode(mode) {
  for (const m of ["check", "learn", "fortune", "village"]) {
    $("#mode-" + m).classList.toggle("hidden", m !== mode);
    $("#tab-" + m).classList.toggle("active", m === mode);
  }
  if (mode === "learn") initLearnMode();
  if (mode === "fortune") initFortuneMode();
  if (mode === "village") initVillageMode();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Step1: 人体図(内臓つき)と部位ボタン ---------- */

const HOTSPOTS = {
  head:      { dots: [[110, 12]], r: 6, label: [110, 5, "middle", "頭・髪"] },
  eyes:      { dots: [[103, 34], [117, 34]], r: 4.5, hitR: 6.5, label: [145, 33, "start", "目"] },
  ears:      { dots: [[91, 37], [129, 37]], r: 4.5, hitR: 6.5, label: [72, 33, "end", "耳"] },
  nose:      { dots: [[110, 44]], r: 4.5, hitR: 6, label: [147, 47, "start", "鼻"] },
  mouth:     { dots: [[110, 52]], r: 4, hitR: 6, label: [74, 56, "end", "口"] },
  shoulders: { dots: [[78, 84], [142, 84]], r: 6, label: [158, 82, "start", "肩・首"] },
  abdomen:   { dots: [[110, 158]], r: 6.5, label: [110, 148, "middle", "お腹"] },
  waist:     { dots: [[80, 178], [140, 178]], r: 6, hitR: 12, label: [56, 182, "end", "腰"] },
  hands:     { dots: [[55, 192], [165, 192]], r: 6, hitR: 11, label: [178, 198, "start", "手・指"] },
  legs:      { dots: [[91, 258], [129, 258]], r: 6, label: [147, 261, "start", "膝・脚"] },
  skin:      { dots: [[60, 145], [160, 145]], r: 5.5, hitR: 9, label: [176, 138, "start", "皮膚"] }
};

function hotspotsSvg() {
  const parts = [];
  for (const region of DATA.regions) {
    const spot = HOTSPOTS[region.id];
    if (!spot) continue;
    const dots = spot.dots
      .map(([x, y]) => `<circle class="dot" cx="${x}" cy="${y}" r="${spot.r || 7}"/>`)
      .join("");
    const hits = spot.dots
      .map(([x, y]) => `<circle class="hit" cx="${x}" cy="${y}" r="${spot.hitR || 14}"/>`)
      .join("");
    const [lx, ly, anchor, text] = spot.label;
    parts.push(
      `<g class="hotspot" data-region="${region.id}">` +
        dots +
        `<text x="${lx}" y="${ly}" text-anchor="${anchor}">${text}</text>` +
        hits +
      `</g>`
    );
  }
  return parts.join("");
}

let selectViewer = null;

function renderBodyFigureStep1() {
  const wrap = $("#figure-wrap-select");
  selectViewer = createBodyViewer(wrap, {
    hint: "← スライドで回転 / 部位をタップで拡大&選択 →",
    getContent: (face) =>
      organsLayerSvg(DATA.elements, face, null) + (face === "front" ? hotspotsSvg() : ""),
    onTap: (e, face, viewer) => {
      const g = e.target.closest(".hotspot");
      if (!g) {
        if (viewer.zoomed) viewer.zoomOut();
        return;
      }
      const regionId = g.dataset.region;
      const spot = HOTSPOTS[regionId];
      const [x, y] = spot.dots.length === 2
        ? [(spot.dots[0][0] + spot.dots[1][0]) / 2, (spot.dots[0][1] + spot.dots[1][1]) / 2]
        : spot.dots[0];
      // 部位へズームしてから症状選択へ
      viewer.zoomTo(x, y, () => {
        setTimeout(() => {
          selectRegion(regionId);
          viewer.resetInstant();
        }, 260);
      });
    }
  });
  // ホバー連動(再描画に耐えるよう委譲で)
  wrap.addEventListener("mouseover", (e) => {
    const g = e.target.closest(".hotspot");
    if (g) syncHover(g.dataset.region, true);
  });
  wrap.addEventListener("mouseout", (e) => {
    const g = e.target.closest(".hotspot");
    if (g) syncHover(g.dataset.region, false);
  });
}

function renderRegionButtons() {
  const wrap = $("#region-buttons");
  wrap.innerHTML = "";
  for (const region of DATA.regions) {
    const btn = document.createElement("button");
    btn.className = "region-btn";
    btn.dataset.region = region.id;
    btn.textContent = region.label;
    btn.addEventListener("click", () => selectRegion(region.id));
    btn.addEventListener("mouseenter", () => syncHover(region.id, true));
    btn.addEventListener("mouseleave", () => syncHover(region.id, false));
    wrap.appendChild(btn);
  }
}

function syncHover(regionId, on) {
  document
    .querySelectorAll(`[data-region="${regionId}"]`)
    .forEach((el) => el.classList.toggle("hover", on));
}

/* ---------- Step2: 症状選択 ---------- */

function selectRegion(regionId) {
  state.region = DATA.regions.find((r) => r.id === regionId);
  if (!state.region) return;
  $("#symptom-heading").textContent = `「${state.region.label}」のどんな症状が気になりますか?`;
  $("#window-note").textContent = "東洋医学の見方: " + state.region.windowText;
  const list = $("#symptom-list");
  list.innerHTML = "";
  for (const sym of state.region.symptoms) {
    const btn = document.createElement("button");
    btn.className = "symptom-btn";
    btn.textContent = sym.label;
    btn.addEventListener("click", () => selectSymptom(sym));
    list.appendChild(btn);
  }
  showStep("symptom");
}

function selectSymptom(sym) {
  state.symptom = sym;
  resetSelections(false);
  if (state.region.details && state.region.details.length) {
    renderDetailStep();
    showStep("detail");
  } else {
    startInterview();
  }
}

/* ---------- Step3: 詳細の絞り込み ---------- */

function renderDetailStep() {
  $("#detail-heading").textContent = `「${state.symptom.label}」について、もう少し詳しく`;
  const wrap = $("#detail-groups");
  wrap.innerHTML = "";
  for (const group of state.region.details) {
    const div = document.createElement("div");
    div.className = "detail-group";
    const q = document.createElement("p");
    q.className = "detail-q";
    q.textContent = group.q;
    div.appendChild(q);
    const row = document.createElement("div");
    row.className = "chip-select-row";
    for (const opt of group.options) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "choice-chip";
      chip.textContent = opt.label;
      chip.addEventListener("click", () => {
        const selected = state.details[group.id] === opt;
        row.querySelectorAll(".choice-chip").forEach((c) => c.classList.remove("selected"));
        if (selected) {
          delete state.details[group.id];
        } else {
          state.details[group.id] = opt;
          chip.classList.add("selected");
        }
      });
      row.appendChild(chip);
    }
    div.appendChild(row);
    wrap.appendChild(div);
  }
  $("#detail-note").textContent = "わかる範囲で大丈夫です。選択しなくても先に進めます。";
}

/* ---------- Step4: 問診 ---------- */

function startInterview() {
  state.interviewIdx = 0;
  renderInterviewQ();
  showStep("interview");
}

function renderInterviewQ() {
  const questions = DATA.interview;
  const i = state.interviewIdx;
  const total = questions.length;
  const q = questions[i];
  $("#interview-progress").textContent = `問診 ${i + 1} / ${total}`;
  $("#interview-q").textContent = q.q;
  const box = $("#interview-options");
  box.innerHTML = "";
  for (const opt of q.options) {
    const btn = document.createElement("button");
    btn.className = "symptom-btn interview-opt" + (state.answers[q.id] === opt ? " selected" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      state.answers[q.id] = opt;
      if (i + 1 < total) {
        state.interviewIdx++;
        renderInterviewQ();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        finishToResult();
      }
    });
    box.appendChild(btn);
  }
  $("#back-from-interview").textContent = i === 0 ? "← 戻る" : "← ひとつ前の質問へ";
}

function interviewBack() {
  if (state.interviewIdx > 0) {
    state.interviewIdx--;
    renderInterviewQ();
  } else if (state.region.details && state.region.details.length) {
    showStep("detail");
  } else {
    showStep("symptom");
  }
}

function finishToResult() {
  renderResult();
  showStep("result");
}

/* ---------- 判定ロジック ---------- */

function elMeta(key) {
  return DATA.elements[key];
}

function computeAssessment() {
  const sym = state.symptom;
  const region = state.region;
  const windowEl = sym.windowOverride || region.windowElement;

  // 1) 詳細の絞り込みによる根本候補の上書き
  let effRootId = sym.root;
  let overrideRelation = null;
  const detailNotes = [];
  let extraHighlight = null;
  for (const group of region.details || []) {
    const opt = state.details[group.id];
    if (!opt) continue;
    if (opt.note) detailNotes.push({ label: `${group.q} → ${opt.label}`, note: opt.note });
    else detailNotes.push({ label: `${group.q} → ${opt.label}`, note: group.note || "" });
    if (opt.highlight) extraHighlight = opt.highlight;
    const ov = opt.rootOverride;
    if (ov && ov.appliesTo.includes(sym.id)) {
      effRootId = ov.pattern;
      overrideRelation = { type: "other", label: ov.label, text: opt.note || "" };
    }
  }

  // 2) 問診による重みづけ(候補 = 上書き後の根本 + 元の根本 + also に限定)
  const scores = {};
  const priority = [];
  const addCand = (pid, base) => {
    if (!(pid in scores)) {
      scores[pid] = 0;
      priority.push(pid);
    }
    scores[pid] += base;
  };
  addCand(effRootId, 3);
  if (sym.root !== effRootId) addCand(sym.root, 2);
  for (const pid of sym.also || []) addCand(pid, 1);

  const insights = [];
  for (const q of DATA.interview) {
    const opt = state.answers[q.id];
    if (!opt) continue;
    for (const [pid, w] of Object.entries(opt.w || {})) {
      if (pid in scores) scores[pid] += w;
    }
    if (opt.insight) insights.push({ q: q.q, a: opt.label, insight: opt.insight });
  }

  let finalRootId = priority[0];
  for (const pid of priority) {
    if (scores[pid] > scores[finalRootId]) finalRootId = pid;
  }

  // 3) 表示する関係性の決定
  let relation;
  const interviewShifted = finalRootId !== effRootId;
  if (interviewShifted) {
    relation = {
      type: "other",
      label: "問診による絞り込み",
      text: `部位からの対応では「${DATA.patterns[effRootId].name}」が第一候補ですが、問診の回答を重ねると「${DATA.patterns[finalRootId].name}」の傾向がより強く見られました。両方の養生を意識してみてください。`
    };
  } else if (overrideRelation) {
    relation = overrideRelation;
  } else {
    relation = sym.relation;
  }

  return {
    windowEl,
    finalRootId,
    baseRootId: effRootId,
    relation,
    detailNotes,
    insights,
    interviewShifted,
    extraHighlight,
    candidates: priority
  };
}

/* ---------- Step5: 結果 ---------- */

function organBadge(elementKey) {
  const m = elMeta(elementKey);
  return `<span class="organ-badge el-${elementKey}">${m.zang}(${m.label})</span>`;
}

function markerFor(region) {
  const spot = HOTSPOTS[region.id];
  if (!spot) return null;
  const side = state.details.side;
  if (spot.dots.length === 2 && side) {
    // 正面向きの図なので、本人の左=画面の右
    if (side.id === "left") return spot.dots[1];
    if (side.id === "right") return spot.dots[0];
  }
  if (spot.dots.length === 2) {
    const [[x1, y1], [x2, y2]] = spot.dots;
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }
  return spot.dots[0];
}

function renderResult() {
  const sym = state.symptom;
  const region = state.region;
  const a = computeAssessment();
  const root = DATA.patterns[a.finalRootId];
  const rootEl = root.element;
  const windowEl = a.windowEl;
  const cards = [];

  if (sym.urgent) {
    cards.push(`
      <div class="result-card urgent-card">
        <h3>まずご確認ください</h3>
        <p>${sym.urgentText || "急に始まった強い症状は、セルフケアの前に<strong>医療機関の受診</strong>をご検討ください。"}
        以下のチェック結果は、緊急性がないことを確認したうえでの参考情報です。</p>
      </div>`);
  }
  if (sym.caution) {
    cards.push(`
      <div class="result-card urgent-card">
        <h3>ご注意</h3>
        <p>${sym.caution}</p>
      </div>`);
  }

  cards.push(`
    <div class="result-card redflag-card">
      <h3>受診の目安</h3>
      <p>以下にあてはまる場合は、このチェックの結果にかかわらず医療機関を受診してください。</p>
      <ul class="redflag-list">${DATA.redFlags.map((r) => `<li>${r}</li>`).join("")}</ul>
    </div>`);

  // からだの中でみる(内臓ハイライト)
  const highlights = [{ element: rootEl, role: "root" }];
  if (windowEl !== rootEl) highlights.push({ element: windowEl, role: "window" });
  if (a.extraHighlight && a.extraHighlight !== rootEl && a.extraHighlight !== windowEl) {
    highlights.push({ element: a.extraHighlight, role: "extra" });
  }
  const legendRows = [];
  legendRows.push(`<span class="legend-item"><span class="legend-swatch swatch-marker"></span>症状の場所</span>`);
  legendRows.push(`<span class="legend-item"><span class="legend-swatch swatch-root"></span>根本の乱れの候補: ${organNamesFor(rootEl).join("・")}(表裏でつながる臓と腑)</span>`);
  if (windowEl !== rootEl) {
    legendRows.push(`<span class="legend-item"><span class="legend-swatch swatch-window"></span>症状の窓口: ${organNamesFor(windowEl).join("・")}</span>`);
  }
  if (a.extraHighlight && a.extraHighlight !== rootEl && a.extraHighlight !== windowEl) {
    legendRows.push(`<span class="legend-item"><span class="legend-swatch swatch-extra"></span>経絡のヒント: ${organNamesFor(a.extraHighlight).join("・")}</span>`);
  }
  cards.push(`
    <div class="result-card figure-card">
      <h3>からだの中でみる、今回の乱れ</h3>
      <div class="figure-result">${buildBodySvg({
        mode: "result",
        elements: DATA.elements,
        highlights,
        marker: markerFor(region)
      })}</div>
      <div class="figure-legend">${legendRows.join("")}</div>
      <p class="cycle-caption">臓と腑はペア(表裏)で働くため、セットで光らせています。腎は背中側にある臓器です。</p>
    </div>`);

  // まとめ
  const detailLine = Object.entries(state.details)
    .map(([, opt]) => opt.label)
    .join(" / ");
  cards.push(`
    <div class="result-card">
      <h3>チェック結果のまとめ</h3>
      <p class="summary-lead">「${region.label}」の症状 <strong>${sym.label}</strong>${detailLine ? `<span class="detail-line">(${detailLine})</span>` : ""}</p>
      <p class="summary-lead">症状の窓口: ${organBadge(windowEl)} ${
        rootEl !== windowEl
          ? ` → 根本の乱れの候補: ${organBadge(rootEl)}`
          : "(この内臓そのものの乱れが候補です)"
      }</p>
      <p class="pattern-name">${root.name}</p>
      <p class="pattern-reading">${root.reading} — 関連する臓腑(ぞうふ): ${root.organ}</p>
      <span class="relation-label">${a.relation.label}</span>
      <p class="relation-text">${a.relation.text}</p>
    </div>`);

  // 詳細からのヒント
  if (a.detailNotes.length) {
    cards.push(`
      <div class="result-card">
        <h3>選んだ詳細からのヒント</h3>
        ${a.detailNotes
          .filter((d) => d.note)
          .map((d) => `<p class="detail-note-item"><span class="detail-note-label">${d.label}</span><br>${d.note}</p>`)
          .join("")}
      </div>`);
  }

  // 問診での気づき
  if (a.insights.length) {
    cards.push(`
      <div class="result-card">
        <h3>問診からの気づき</h3>
        ${a.insights
          .map(
            (ins) => `
          <div class="insight-item">
            <p class="insight-a">「${ins.a}」</p>
            <p class="insight-text">${ins.insight}</p>
          </div>`
          )
          .join("")}
      </div>`);
  }

  // 五行循環図
  cards.push(`
    <div class="result-card cycle-wrap">
      <h3>五行の循環でみる、今回の乱れ</h3>
      ${buildCycleSvg(windowEl, rootEl)}
      <p class="cycle-caption">実線=相生(生み育てる関係) / 点線=相克(抑制する関係)<br>
      赤い太矢印=今回の乱れの流れ(候補) / 円内は五行と対応する臓腑(ぞうふ=内臓)</p>
    </div>`);

  // こころ
  cards.push(`
    <div class="result-card">
      <h3>こころとの関わり</h3>
      <p class="psych-question">${sym.psych}</p>
      <p class="psych-tendency">「${root.name}」のときに出やすい心理面: ${root.psychology}。
      五行では「${elMeta(rootEl).zang}」は「${elMeta(rootEl).emotion}」の感情と結びつくとされます。</p>
    </div>`);

  // 食養生+栄養素
  cards.push(`
    <div class="result-card">
      <h3>食養生(おすすめの食材と栄養素)</h3>
      <div class="chip-row">${root.foods.map((f) => `<span class="chip">${f}</span>`).join("")}</div>
      ${root.nutrients ? `
      <p class="sub-label">意識したい栄養素</p>
      <div class="chip-row">${root.nutrients.map((n) => `<span class="chip nutrient">${n}</span>`).join("")}</div>` : ""}
      <p class="sub-label">控えたいもの・こと</p>
      <div class="chip-row">${root.avoid.map((f) => `<span class="chip avoid">${f}</span>`).join("")}</div>
      <p class="food-note">食物アレルギーのある方は該当する食材を避けてください。妊娠中・授乳中の方、乳幼児、通院・服薬中の方は、取り入れる前に医師・薬剤師にご相談ください(はちみつは1歳未満のお子さまには与えないでください)。</p>
    </div>`);

  // ハーブティー・香り
  if (root.herbTea || root.aroma) {
    cards.push(`
      <div class="result-card">
        <h3>ハーブティーと香り</h3>
        ${root.herbTea ? `
        <p class="sub-label">おすすめのお茶・ブレンド</p>
        <div class="chip-row">${root.herbTea.map((t) => `<span class="chip tea">${t}</span>`).join("")}</div>` : ""}
        ${root.aroma ? `
        <p class="sub-label">合うとされる香り(アロマ)</p>
        <div class="chip-row">${root.aroma.map((t) => `<span class="chip aroma">${t}</span>`).join("")}</div>` : ""}
      </div>`);
  }

  // ツボ・マッサージ
  if (root.massage && root.massage.length) {
    cards.push(`
      <div class="result-card">
        <h3>ツボ・マッサージ(どこと、つながっているか)</h3>
        ${root.massage
          .map(
            (m) => `
        <div class="point-item">
          <p class="point-name">${m.point}</p>
          <p class="point-where"><span class="point-tag">場所</span>${m.where}</p>
          <p class="point-link"><span class="point-tag">つながり</span>${m.link}</p>
        </div>`
          )
          .join("")}
        <p class="food-note">${DATA.remedyNote || ""}</p>
      </div>`);
  }

  // 生活習慣
  cards.push(`
    <div class="result-card">
      <h3>生活習慣のヒント</h3>
      <ul class="lifestyle-list">${root.lifestyle.map((l) => `<li>${l}</li>`).join("")}</ul>
    </div>`);

  // 他の候補
  const others = a.candidates.filter((pid) => pid !== a.finalRootId);
  if (others.length) {
    cards.push(`
      <div class="result-card">
        <h3>ほかに考えられる背景</h3>
        <div class="also-row">${others
          .map((pid) => {
            const p = DATA.patterns[pid];
            return `<span class="also-chip">${p.name}(${p.organ})</span>`;
          })
          .join("")}</div>
      </div>`);
  }

  cards.push(`<p class="disclaimer-note">${DATA.disclaimer}</p>`);

  $("#result-body").innerHTML = cards.join("");
  // 証に連動した商品(PR)を免責の手前に差し込む
  if (typeof renderProductsFor === "function") {
    renderProductsFor(a.finalRootId, $("#result-body"));
  }
}

/* ---------- 五行循環図 SVG ---------- */

function nodePos(elementKey, cx, cy, r) {
  const idx = ELEMENT_ORDER.indexOf(elementKey);
  const angle = (-90 + idx * 72) * (Math.PI / 180);
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function shrinkLine(x1, y1, x2, y2, offset) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  return [x1 + ux * offset, y1 + uy * offset, x2 - ux * offset, y2 - uy * offset];
}

function curvePath(fromEl, toEl, cx, cy, r, nodeR, outside, factorOverride) {
  const [x1, y1] = nodePos(fromEl, cx, cy, r);
  const [x2, y2] = nodePos(toEl, cx, cy, r);
  const [sx1, sy1, sx2, sy2] = shrinkLine(x1, y1, x2, y2, nodeR + 4);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const factor = factorOverride ?? (outside ? 1.35 : 0.45);
  const qx = cx + (mx - cx) * factor;
  const qy = cy + (my - cy) * factor;
  return `M${sx1},${sy1} Q${qx},${qy} ${sx2},${sy2}`;
}

function isAdjacent(a, b) {
  const d = Math.abs(ELEMENT_ORDER.indexOf(a) - ELEMENT_ORDER.indexOf(b));
  return d === 1 || d === 4;
}

function buildCycleSvg(windowEl, rootEl) {
  const cx = 160, cy = 150, R = 104, nodeR = 27;
  const parts = [];

  parts.push(`<svg id="cycle-svg" viewBox="0 -14 320 314" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`
    <defs>
      <marker id="arrow-soft" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#7d93b8"/>
      </marker>
      <marker id="arrow-main" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#ff6b5e"/>
      </marker>
    </defs>`);

  for (let i = 0; i < 5; i++) {
    const from = ELEMENT_ORDER[i];
    const to = ELEMENT_ORDER[(i + 1) % 5];
    parts.push(
      `<path d="${curvePath(from, to, cx, cy, R, nodeR, true)}" fill="none" stroke="#7d93b8" stroke-width="1.6" marker-end="url(#arrow-soft)"/>`
    );
  }
  const SOKOKU = [["wood","earth"],["earth","water"],["water","fire"],["fire","metal"],["metal","wood"]];
  for (const [from, to] of SOKOKU) {
    parts.push(
      `<path d="${curvePath(from, to, cx, cy, R, nodeR, false)}" fill="none" stroke="#7d93b8" stroke-width="1.3" stroke-dasharray="4 4" marker-end="url(#arrow-soft)"/>`
    );
  }

  if (rootEl !== windowEl) {
    const outside = isAdjacent(rootEl, windowEl);
    parts.push(
      `<path d="${curvePath(rootEl, windowEl, cx, cy, R, nodeR, outside, outside ? 1.55 : 0.28)}" fill="none" stroke="#ff6b5e" stroke-width="3.4" marker-end="url(#arrow-main)"/>`
    );
  }

  for (const key of ELEMENT_ORDER) {
    const m = elMeta(key);
    const [x, y] = nodePos(key, cx, cy, R);
    const involved = key === windowEl || key === rootEl;
    const opacity = involved ? 1 : 0.3;
    parts.push(`<g opacity="${opacity}">`);
    if (key === rootEl) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${nodeR + 6}" fill="none" stroke="#ff6b5e" stroke-width="2.4"/>`);
      const label = rootEl === windowEl ? "この臓腑の乱れ" : "根本の候補";
      parts.push(`<text x="${x}" y="${y - nodeR - 12}" text-anchor="middle" font-size="10.5" fill="#ff6b5e" font-weight="bold">${label}</text>`);
    }
    if (key === windowEl && key !== rootEl) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${nodeR + 6}" fill="none" stroke="#ffb347" stroke-width="2" stroke-dasharray="3 3"/>`);
      parts.push(`<text x="${x}" y="${y + nodeR + 20}" text-anchor="middle" font-size="10.5" fill="#ffb347" font-weight="bold">症状の窓口</text>`);
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="${nodeR}" fill="${m.color}"/>`);
    parts.push(`<text x="${x}" y="${y - 1}" text-anchor="middle" font-size="15" fill="#fff" font-weight="bold">${m.label}</text>`);
    parts.push(`<text x="${x}" y="${y + 14}" text-anchor="middle" font-size="10.5" fill="#fff">${m.zang}・${m.fu}</text>`);
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("");
}

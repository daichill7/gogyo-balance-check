/* 「からだを知る」学習モード */
let LEARN = null;
let learnViewer = null;
let learnLayer = "organs";
let learnInited = false;
let currentDiagram = "hand";

const LAYER_ORDER = ["organs", "bones", "vessels", "meridians", "chakras"];

async function initLearnMode() {
  if (learnInited) return;
  learnInited = true;
  const res = await fetch("data/learn.json");
  LEARN = await res.json();

  document.querySelector("#learn-disclaimer").textContent = LEARN.disclaimer;

  // レイヤータブ
  const tabs = document.querySelector("#learn-tabs");
  tabs.innerHTML = "";
  for (const key of LAYER_ORDER) {
    const btn = document.createElement("button");
    btn.className = "choice-chip" + (key === learnLayer ? " selected" : "");
    btn.textContent = LEARN.layers[key].title;
    btn.addEventListener("click", () => {
      learnLayer = key;
      tabs.querySelectorAll(".choice-chip").forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      learnViewer.resetInstant();
      learnViewer.rerender();
      showLayerIntro();
    });
    tabs.appendChild(btn);
  }

  // 人体ビューア
  learnViewer = createBodyViewer(document.querySelector("#learn-figure"), {
    getContent: (face) => layerContent(face),
    onTap: handleLearnTap,
    onZoomOut: showLayerIntro
  });

  showLayerIntro();

  // 部位別図鑑タブ
  const dTabs = document.querySelector("#diagram-tabs");
  dTabs.innerHTML = "";
  const dKeys = ["hand", "foot", "ear", "face"];
  for (const key of dKeys) {
    const btn = document.createElement("button");
    btn.className = "choice-chip" + (key === currentDiagram ? " selected" : "");
    btn.textContent = LEARN.diagrams[key].title;
    btn.addEventListener("click", () => {
      currentDiagram = key;
      dTabs.querySelectorAll(".choice-chip").forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      renderDiagram();
    });
    dTabs.appendChild(btn);
  }
  renderDiagram();
  if (typeof renderMassageProducts === "function") renderMassageProducts();
}

/* ---------- レイヤー内容 ---------- */

function layerContent(face) {
  const L = LEARN.layers;
  switch (learnLayer) {
    case "organs":
      return organsLayerSvg(DATA.elements, face, null);
    case "bones":
      return bonesLayerSvg(face);
    case "vessels":
      return vesselsLayerSvg(face);
    case "meridians":
      return meridiansLayerSvg(face === "front" ? L.meridians.points : L.meridians.pointsBack, face);
    case "chakras":
      return chakrasLayerSvg(L.chakras.points);
    default:
      return "";
  }
}

function showLayerIntro() {
  const L = LEARN.layers[learnLayer];
  const info = document.querySelector("#learn-info");
  const parts = [`<h4>${L.title}</h4><p>${L.intro}</p>`];

  if (learnLayer === "organs") {
    parts.push(`<div class="learn-list">`);
    for (const [id, item] of Object.entries(L.items)) {
      parts.push(`<button class="learn-list-item" data-organ-item="${id}">
        <span class="li-name">${item.name}</span> <span class="time-badge">活発な時間: ${item.time}</span><br>
        <span class="li-desc">${item.desc.slice(0, 42)}…</span></button>`);
    }
    parts.push(`</div><p class="li-desc" style="margin-top:8px">${L.extra}</p>`);
  } else if (learnLayer === "bones" || learnLayer === "vessels") {
    parts.push(`<div class="learn-list">`);
    L.items.forEach((item, i) => {
      parts.push(`<button class="learn-list-item" data-list-idx="${i}">
        <span class="li-name">${item.name}</span><br><span class="li-desc">${item.desc}</span></button>`);
    });
    parts.push(`</div>`);
  } else if (learnLayer === "meridians") {
    parts.push(`<p class="li-desc">${L.extra}</p>`);
    parts.push(`<p class="li-desc" style="margin-top:6px">図のツボ(光る点)をタップすると詳細が見られます。人体をスライドすると背面のツボも表示されます。</p>`);
  } else if (learnLayer === "chakras") {
    parts.push(`<p class="li-desc" style="margin-top:6px">図の7つの光をタップすると詳細が見られます。</p>`);
  }
  info.innerHTML = parts.join("");

  info.querySelectorAll("[data-organ-item]").forEach((btn) => {
    btn.addEventListener("click", () => showOrganInfo(btn.dataset.organItem, true));
  });
}

function showOrganInfo(organId, zoom) {
  const item = LEARN.layers.organs.items[organId];
  if (!item) return;
  const shape = ORGAN_SHAPES.find((o) => o.id === organId);
  const info = document.querySelector("#learn-info");
  info.innerHTML = `
    <h4>${item.name}</h4>
    <span class="time-badge">活発な時間帯(子午流注): ${item.time}</span>
    <p>${item.desc}</p>
    <p class="li-desc" style="margin-top:8px">タップで人体図が拡大されます。「全体に戻す」で戻れます。</p>`;
  if (zoom && shape && learnViewer) {
    if (shape.faces.includes(learnViewer.face)) {
      learnViewer.zoomTo(shape.tapAt[0], shape.tapAt[1]);
    }
  }
}

function handleLearnTap(e, face, viewer) {
  const organG = e.target.closest("[data-organ]");
  if (organG && learnLayer === "organs") {
    showOrganInfo(organG.dataset.organ, false);
    const shape = ORGAN_SHAPES.find((o) => o.id === organG.dataset.organ);
    if (shape) viewer.zoomTo(shape.tapAt[0], shape.tapAt[1]);
    return;
  }
  const acuG = e.target.closest(".acu-g");
  if (acuG && learnLayer === "meridians") {
    const list = face === "front" ? LEARN.layers.meridians.points : LEARN.layers.meridians.pointsBack;
    const pt = list[Number(acuG.dataset.idx)];
    if (!pt) return;
    document.querySelector("#learn-info").innerHTML = `
      <h4>${pt.name}</h4>
      <p class="reading">${pt.reading}</p>
      <p><span class="point-tag">場所</span>${pt.where}</p>
      <p style="margin-top:6px"><span class="point-tag">働き</span>${pt.link}</p>`;
    viewer.zoomTo(pt.x, pt.y);
    return;
  }
  const chakraG = e.target.closest(".chakra-point");
  if (chakraG && learnLayer === "chakras") {
    const pt = LEARN.layers.chakras.points[Number(chakraG.dataset.idx)];
    if (!pt) return;
    document.querySelector("#learn-info").innerHTML = `
      <h4>${pt.name}<span style="color:${pt.color}"> ●</span></h4>
      <p class="reading">${pt.sanskrit} — テーマ: ${pt.theme}</p>
      <p>${pt.desc}</p>`;
    viewer.zoomTo(110, pt.y);
    return;
  }
  // 何もない場所のタップ: ズーム中なら戻す
  if (viewer.zoomed) {
    viewer.zoomOut();
    showLayerIntro();
  }
}

/* ---------- 部位別図鑑(手・足裏・耳・顔) ---------- */

function renderDiagram() {
  const d = LEARN.diagrams[currentDiagram];
  const box = document.querySelector("#diagram-box");
  const info = document.querySelector("#diagram-info");

  let base = "";
  if (currentDiagram === "hand") base = handSvg(d);
  else if (currentDiagram === "foot") base = footSvg(d);
  else if (currentDiagram === "ear") base = earSvg(d);
  else base = faceSvg(d);
  box.innerHTML = base;

  const parts = [`<h4>${d.title}</h4><p class="li-desc">${d.note}</p>`];
  if (d.fingers) {
    parts.push(`<div class="chip-row" style="margin-top:8px">` +
      d.fingers.map((f) => `<span class="chip">${f.finger} = ${f.meridian}</span>`).join("") + `</div>`);
  }
  if (d.zones) {
    parts.push(`<div class="learn-list">` +
      d.zones.map((z) => `<div class="learn-list-item" style="cursor:default"><span class="li-name">${z.name}</span><br><span class="li-desc">${z.desc}</span></div>`).join("") + `</div>`);
  }
  parts.push(`<div class="learn-list">` +
    d.points.map((p, i) => `<button class="learn-list-item" data-dp="${i}"><span class="li-name">${p.name}(${p.reading})</span><br><span class="li-desc">${p.desc}</span></button>`).join("") + `</div>`);
  info.innerHTML = parts.join("");

  const activate = (i) => {
    box.querySelectorAll(".acu-point").forEach((c, j) => {
      c.setAttribute("r", j === i ? 7 : 4.5);
    });
  };
  info.querySelectorAll("[data-dp]").forEach((btn) => {
    btn.addEventListener("click", () => activate(Number(btn.dataset.dp)));
  });
  box.querySelectorAll(".diagram-pt").forEach((g) => {
    g.addEventListener("click", () => activate(Number(g.dataset.idx)));
  });
}

// 本体の人体図と揃えたネオンの共通定義(グラデーション塗り+輪郭グロー+粒子)
function diagDefs(uid) {
  return `<defs>
    <linearGradient id="dg-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(50,130,215,0.30)"/>
      <stop offset="1" stop-color="rgba(22,55,115,0.24)"/>
    </linearGradient>
    <filter id="dgGlow-${uid}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.4"/>
    </filter>
  </defs>`;
}

function diagramPoints(points) {
  return points.map((p, i) =>
    `<g class="diagram-pt" data-idx="${i}" style="cursor:pointer">
      <circle class="acu-point" cx="${p.x}" cy="${p.y}" r="4.5"/>
      <text class="acu-label" x="${p.x}" y="${p.y - 9}" text-anchor="middle">${p.name}</text>
    </g>`).join("");
}

function handSvg(d) {
  const fingers = d.fingers || [];
  const colorOf = (el) => (DATA.elements[el] ? DATA.elements[el].color : "#58c8ff");
  // [先端x, 先端y, 付け根x, 付け根y] の4指 + 親指
  const F = [
    [64, 44, 66, 116],   // 人差し指=大腸
    [92, 32, 92, 116],   // 中指=心包
    [120, 36, 120, 116], // 薬指=三焦
    [146, 52, 148, 116]  // 小指=心/小腸
  ];
  let glow = "", line = "";
  F.forEach((p, i) => {
    const c = colorOf(fingers[i + 1]?.element);
    // 色は控えめに内側グロー、輪郭はネオン水色で統一
    glow += `<path d="M${p[0]},${p[1]} L${p[2]},${p[3]}" stroke="${c}" stroke-width="17" stroke-linecap="round" fill="none" opacity="0.32"/>`;
    line += `<path class="diag-neon" d="M${p[0]},${p[1]} L${p[2]},${p[3]}" stroke-width="18" stroke-linecap="round" fill="none"/>`;
  });
  const thumbC = colorOf(fingers[0]?.element);
  return `<svg viewBox="0 0 210 250" xmlns="http://www.w3.org/2000/svg">
    ${diagDefs("hand")}
    <g filter="url(#dgGlow-hand)" opacity="0.6">
      ${line}
      <path class="diag-neon" d="M44,150 L22,116" stroke-width="20" stroke-linecap="round" fill="none"/>
      <rect class="diag-neon" x="52" y="104" width="112" height="92" rx="28" fill="none"/>
    </g>
    <path d="M44,150 L22,116" stroke="${thumbC}" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.32"/>
    ${glow}
    <rect x="52" y="104" width="112" height="92" rx="28" fill="url(#dg-hand)"/>
    ${line}
    <path class="diag-neon" d="M44,150 L22,116" stroke-width="20" stroke-linecap="round" fill="none"/>
    <rect class="diag-neon" x="52" y="104" width="112" height="92" rx="28" fill="none"/>
    <path class="diag-neon" d="M74,196 Q108,206 140,196" stroke-width="1.5" fill="none"/>
    <!-- 指の関節線 -->
    <path class="diag-detail" d="M60,76 h8 M88,64 h8 M116,68 h8 M142,84 h8"/>
    <text class="zone-label" x="26" y="92" text-anchor="middle">親指=肺</text>
    <text class="zone-label" x="60" y="28" text-anchor="middle">人=大腸</text>
    <text class="zone-label" x="92" y="14" text-anchor="middle">中=心包</text>
    <text class="zone-label" x="124" y="28" text-anchor="middle">薬=三焦</text>
    <text class="zone-label" x="154" y="42" text-anchor="middle">小=心</text>
    ${diagramPoints(d.points)}
  </svg>`;
}

function footSvg(d) {
  return `<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg">
    ${diagDefs("foot")}
    <g filter="url(#dgGlow-foot)" opacity="0.55">
      <path class="diag-neon" d="M60,60 Q58,20 85,18 Q108,16 118,34 Q150,30 152,55 Q158,90 150,140 Q145,190 120,215 Q95,232 78,210 Q55,180 52,120 Q50,85 60,60 Z" fill="none"/>
    </g>
    <path d="M60,60 Q58,20 85,18 Q108,16 118,34 Q150,30 152,55 Q158,90 150,140 Q145,190 120,215 Q95,232 78,210 Q55,180 52,120 Q50,85 60,60 Z" fill="url(#dg-foot)"/>
    <!-- 反射区ゾーン(有機的なやわらかい帯) -->
    <path class="zone-band" d="M56,52 Q104,44 154,54 Q150,74 104,78 Q60,74 56,52 Z" fill="#3fa8ff"/>
    <path class="zone-band" d="M54,92 Q104,86 153,94 Q152,132 104,150 Q56,132 54,92 Z" fill="#ffb347"/>
    <path class="zone-band" d="M66,172 Q104,166 138,174 Q135,205 104,216 Q72,205 66,172 Z" fill="#ff5f6e"/>
    <path class="diag-neon" d="M60,60 Q58,20 85,18 Q108,16 118,34 Q150,30 152,55 Q158,90 150,140 Q145,190 120,215 Q95,232 78,210 Q55,180 52,120 Q50,85 60,60 Z" fill="none"/>
    <ellipse class="diag-neon" cx="70" cy="34" rx="12" ry="13" fill="none"/>
    <ellipse class="diag-neon" cx="99" cy="26" rx="8.5" ry="9" fill="none"/>
    <ellipse class="diag-neon" cx="121" cy="28" rx="7.5" ry="8" fill="none"/>
    <ellipse class="diag-neon" cx="139" cy="36" rx="6.5" ry="7" fill="none"/>
    <ellipse class="diag-neon" cx="151" cy="48" rx="5.5" ry="6" fill="none"/>
    <text class="zone-label" x="105" y="68" text-anchor="middle">肩・肺</text>
    <text class="zone-label" x="140" y="112" text-anchor="middle">消化器</text>
    <text class="zone-label" x="102" y="198" text-anchor="middle">骨盤</text>
    <text class="zone-label" x="100" y="12" text-anchor="middle">指先=頭・目・耳</text>
    ${diagramPoints(d.points)}
  </svg>`;
}

function earSvg(d) {
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    ${diagDefs("ear")}
    <g filter="url(#dgGlow-ear)" opacity="0.55">
      <path class="diag-neon" d="M112,15 Q162,25 152,88 Q147,128 122,160 Q108,182 90,166 Q60,140 60,90 Q60,30 112,15 Z" fill="none"/>
    </g>
    <path d="M112,15 Q162,25 152,88 Q147,128 122,160 Q108,182 90,166 Q60,140 60,90 Q60,30 112,15 Z" fill="url(#dg-ear)"/>
    <path class="diag-neon" d="M112,15 Q162,25 152,88 Q147,128 122,160 Q108,182 90,166 Q60,140 60,90 Q60,30 112,15 Z" fill="none"/>
    <path class="diag-detail" d="M108,35 Q140,42 133,85 Q128,112 110,135"/>
    <path class="diag-detail" d="M88,60 Q108,52 112,72 Q114,88 98,95"/>
    <path class="diag-detail" d="M96,150 Q112,150 116,138"/>
    <text class="zone-label" x="150" y="182" text-anchor="end">耳たぶ=頭・目</text>
    <text class="zone-label" x="42" y="24">上部=足・腰</text>
    ${diagramPoints(d.points)}
  </svg>`;
}

function faceSvg(d) {
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    ${diagDefs("face")}
    <g filter="url(#dgGlow-face)" opacity="0.55">
      <path class="diag-neon" d="M100,26 Q142,26 143,86 Q143,120 128,150 Q116,172 100,175 Q84,172 72,150 Q57,120 57,86 Q58,26 100,26 Z" fill="none"/>
    </g>
    <path d="M100,26 Q142,26 143,86 Q143,120 128,150 Q116,172 100,175 Q84,172 72,150 Q57,120 57,86 Q58,26 100,26 Z" fill="url(#dg-face)"/>
    <!-- 五臓ゾーンのやわらかい発光 -->
    <ellipse class="zone-band" cx="100" cy="48" rx="30" ry="16" fill="#ff5f6e"/>
    <ellipse class="zone-band" cx="100" cy="112" rx="14" ry="20" fill="#ffb347"/>
    <ellipse class="zone-band" cx="72" cy="96" rx="15" ry="20" fill="#aebfd6"/>
    <ellipse class="zone-band" cx="128" cy="96" rx="15" ry="20" fill="#35d98a"/>
    <ellipse class="zone-band" cx="100" cy="158" rx="20" ry="12" fill="#3fa8ff"/>
    <path class="diag-neon" d="M100,26 Q142,26 143,86 Q143,120 128,150 Q116,172 100,175 Q84,172 72,150 Q57,120 57,86 Q58,26 100,26 Z" fill="none"/>
    <path class="diag-detail" d="M72,74 Q82,68 92,74 M108,74 Q118,68 128,74"/>
    <ellipse class="diag-detail" cx="82" cy="82" rx="7" ry="4"/>
    <ellipse class="diag-detail" cx="118" cy="82" rx="7" ry="4"/>
    <path class="diag-detail" d="M99,90 Q97,106 94,110 Q99,115 106,112"/>
    <path class="diag-detail" d="M87,134 Q100,142 113,134"/>
    <text class="zone-label" x="100" y="44" text-anchor="middle">額=心</text>
    <text class="zone-label" x="100" y="116" text-anchor="middle">鼻=脾</text>
    <text class="zone-label" x="60" y="98" text-anchor="middle">頬=肺</text>
    <text class="zone-label" x="140" y="98" text-anchor="middle">頬=肝</text>
    <text class="zone-label" x="100" y="166" text-anchor="middle">あご=腎</text>
    ${diagramPoints(d.points)}
  </svg>`;
}

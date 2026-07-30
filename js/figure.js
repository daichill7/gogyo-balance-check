/* ネオン人体ビューア: ホログラム風リアル人体 + 内臓/骨格/血管/経絡/チャクラの各レイヤーと、
   スライド回転・タップズームの Viewer を提供する */

const VIEWBOX_FULL = [0, 0, 220, 360];
let SVG_UID = 0;

/* ---------- リアル等身のシルエットパス(正面) ---------- */
/* 胴体+脚+腕(中心x=110)。内臓レイヤー(y84〜200)と整合する座標系 */
const BODY_PATH = `
M103,56
C102,62 102,66 101,68
Q94,72 80,80
Q66,84 64,96
Q60,116 58,136
Q55,155 54,174
Q50,182 50,192
Q51,202 56,204
Q60,190 60,178
Q65,158 68,134
Q71,118 74,102
Q76,122 79,140
Q81,158 76,172
Q74,176 76,180
Q74,205 82,252
Q80,286 87,316
Q80,330 79,340
Q90,346 99,341
Q101,330 99,318
Q102,286 104,252
Q106,225 108,198
Q110,194 112,198
Q114,225 116,252
Q118,286 121,318
Q119,330 121,341
Q130,346 141,340
Q140,330 133,316
Q140,286 138,252
Q146,205 144,180
Q146,176 144,172
Q139,158 141,140
Q144,122 146,102
Q149,118 152,134
Q155,158 160,178
Q160,190 164,204
Q169,202 170,192
Q170,182 166,174
Q165,155 162,136
Q160,116 156,96
Q154,84 140,80
Q126,72 119,68
C118,66 118,62 117,56
Q110,60 103,56 Z`;

/* 頭部(頬→あごのラインつき) */
const HEAD_PATH = `
M110,12
Q126,12 127,31
Q127,42 122,48
Q117,55 110,57
Q103,55 98,48
Q93,42 93,31
Q94,12 110,12 Z`;

/* 体内にクリップした等高線メッシュ+粒子(ワイヤーフレーム感) */
function meshSvg(clipId) {
  const p = [`<g clip-path="url(#${clipId})">`];
  // 胸部のコア発光
  p.push(`<ellipse cx="110" cy="122" rx="42" ry="58" fill="url(#coreGlow-${clipId})"/>`);
  // 横方向の等高線(下向きの弧で立体感)
  for (let y = 16; y <= 344; y += 11) {
    p.push(`<path d="M46,${y} Q110,${y + 7} 174,${y}" fill="none" stroke="rgba(120,220,255,0.16)" stroke-width="0.7"/>`);
  }
  // 縦のガイド線
  for (const x of [88, 110, 132]) {
    p.push(`<path d="M${x},12 L${x},348" fill="none" stroke="rgba(120,220,255,0.08)" stroke-width="0.7"/>`);
  }
  // 粒子ドット(決定的な擬似ランダム)
  let seed = 7;
  for (let i = 0; i < 46; i++) {
    seed = (seed * 137 + 71) % 997;
    const x = 52 + (seed % 116);
    const y = 14 + ((seed * 31) % 330);
    const r = 0.5 + ((seed % 3) * 0.35);
    p.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(160,235,255,${0.25 + (seed % 4) * 0.12})"/>`);
  }
  p.push(`</g>`);
  return p.join("");
}

function silhouetteSvg(face = "front") {
  const uid = `sil${++SVG_UID}`;
  const parts = [];

  parts.push(`<defs>
    <linearGradient id="bodyFill-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(50,130,215,0.34)"/>
      <stop offset="0.5" stop-color="rgba(35,95,175,0.30)"/>
      <stop offset="1" stop-color="rgba(22,55,115,0.26)"/>
    </linearGradient>
    <radialGradient id="coreGlow-${uid}" cx="0.5" cy="0.5" r="0.6">
      <stop offset="0" stop-color="rgba(140,225,255,0.4)"/>
      <stop offset="1" stop-color="rgba(140,225,255,0)"/>
    </radialGradient>
    <filter id="blur3-${uid}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.6"/>
    </filter>
    <clipPath id="clip-${uid}">
      <path d="${BODY_PATH}"/>
      <path d="${HEAD_PATH}"/>
    </clipPath>
  </defs>`);

  // 背後の光柱(参考イラストの縦のライトビーム)
  for (const [x, w, o] of [[34, 5, 0.06], [72, 8, 0.09], [148, 8, 0.09], [186, 5, 0.06]]) {
    parts.push(`<rect x="${x}" y="6" width="${w}" height="348" fill="rgba(90,200,255,${o})" filter="url(#blur3-${uid})"/>`);
  }

  // 足元のホログラム台座
  parts.push(`<ellipse class="holo-ring" cx="110" cy="345" rx="95" ry="12" style="animation-duration:20s" opacity="0.5"/>`);
  parts.push(`<ellipse class="holo-ring" cx="110" cy="345" rx="74" ry="9"/>`);
  parts.push(`<ellipse cx="110" cy="345" rx="52" ry="6.5" fill="rgba(79,216,255,0.10)" stroke="rgba(120,220,255,0.5)" stroke-width="0.8"/>`);
  // 胴回りのスキャンリング
  parts.push(`<ellipse class="holo-ring" cx="110" cy="150" rx="88" ry="11" style="animation-duration:15s" opacity="0.6"/>`);
  parts.push(`<ellipse class="holo-ring" cx="110" cy="52" rx="55" ry="8" style="animation-duration:11s" opacity="0.5"/>`);

  // 外側のオーラ(ぼかした太いストローク)
  parts.push(`<g filter="url(#blur3-${uid})">
    <path d="${BODY_PATH}" fill="none" stroke="rgba(79,216,255,0.55)" stroke-width="3"/>
    <path d="${HEAD_PATH}" fill="none" stroke="rgba(79,216,255,0.55)" stroke-width="3"/>
  </g>`);

  // 本体(塗り+シャープなネオンライン)
  parts.push(`<path d="${BODY_PATH}" fill="url(#bodyFill-${uid})" stroke="#9be9ff" stroke-width="1.2"/>`);
  parts.push(`<path d="${HEAD_PATH}" fill="url(#bodyFill-${uid})" stroke="#9be9ff" stroke-width="1.2"/>`);
  // 耳
  parts.push(`<path d="M93,32 Q89,33 90,38 Q91,42 94,42 M127,32 Q131,33 130,38 Q129,42 126,42" fill="none" stroke="#9be9ff" stroke-width="1"/>`);

  // ワイヤーフレームメッシュ+粒子
  parts.push(meshSvg(`clip-${uid}`));

  // 身体のディテール(筋肉の陰影ライン)
  const detail = `stroke="rgba(150,230,255,0.35)" stroke-width="0.9" fill="none"`;
  parts.push(`<path d="M96,96 Q110,104 124,96 M96,96 Q93,106 97,112 M124,96 Q127,106 123,112" ${detail}/>`); // 胸筋
  parts.push(`<path d="M110,116 L110,168 M102,126 Q110,129 118,126 M102,140 Q110,143 118,140 M103,154 Q110,157 117,154" ${detail} opacity="0.6"/>`); // 腹筋
  parts.push(`<path d="M80,84 Q72,90 68,100 M140,84 Q148,90 152,100" ${detail}/>`); // 三角筋
  parts.push(`<path d="M84,255 Q91,260 98,255 M122,255 Q129,260 136,255" ${detail} opacity="0.6"/>`); // 膝

  if (face === "front") {
    // 顔のヒント(うっすら)
    parts.push(`<path d="M100,33 Q103,31 106,33 M114,33 Q117,31 120,33 M110,38 L110,45 Q108,47 106,46 M105,51 Q110,53 115,51" fill="none" stroke="rgba(150,230,255,0.5)" stroke-width="0.9"/>`);
  } else {
    // 後頭部・背中のライン
    parts.push(`<path d="M110,60 L110,86 M104,70 Q110,74 116,70" fill="none" stroke="rgba(150,230,255,0.4)" stroke-width="0.9"/>`);
    parts.push(`<path d="M110,88 L110,190" fill="none" stroke="rgba(150,230,255,0.3)" stroke-width="1"/>`); // 背骨ライン
  }

  return parts.join("");
}

/* ---------- 臓腑シェイプ(front/back両対応) ---------- */
const ORGAN_SHAPES = [
  { id: "lintestine", name: "大腸", element: "metal", faces: ["front"], labelAt: [144, 190, "start"], tapAt: [110, 173],
    svg: (c) => `<path d="M87,186 L87,164 Q87,159 92,159 L128,159 Q133,159 133,164 L133,186" fill="none" stroke="${c}" stroke-width="7.5" stroke-linecap="round"/>` },
  { id: "sintestine", name: "小腸", element: "fire", faces: ["front"], labelAt: [76, 196, "end"], tapAt: [110, 175],
    svg: (c) => `<ellipse cx="110" cy="175" rx="13.5" ry="10.5" fill="${c}"/>
      <path d="M99,171 Q110,166 121,171 M98,176 Q110,181 122,176 M101,182 Q110,178 119,182" fill="none" stroke="rgba(6,12,24,0.4)" stroke-width="1.6" stroke-linecap="round"/>` },
  { id: "bladder", name: "膀胱", element: "water", faces: ["front", "back"], labelAt: [144, 199, "start"], tapAt: [110, 194],
    svg: (c) => `<ellipse cx="110" cy="194" rx="7" ry="5" fill="${c}"/>` },
  { id: "kidney", name: "腎", element: "water", faces: ["front", "back"], labelAt: [76, 178, "end"], tapAt: [90, 174],
    svg: (c) => `<g>
      <ellipse cx="90" cy="174" rx="6" ry="9.5" fill="${c}" transform="rotate(8 90 174)"/>
      <ellipse cx="130" cy="174" rx="6" ry="9.5" fill="${c}" transform="rotate(-8 130 174)"/>
      <ellipse cx="92.5" cy="174" rx="2" ry="4" fill="rgba(255,255,255,0.35)"/>
      <ellipse cx="127.5" cy="174" rx="2" ry="4" fill="rgba(255,255,255,0.35)"/>
    </g>` },
  { id: "liver", name: "肝", element: "wood", faces: ["front"], labelAt: [72, 146, "end"], tapAt: [95, 145],
    svg: (c) => `<path d="M80,141 Q79,135 93,135 L115,139 Q117,148 106,153 Q88,156 81,148 Z" fill="${c}"/>` },
  { id: "gall", name: "胆", element: "wood", faces: ["front"], labelAt: [86, 163, "end"], tapAt: [99, 151],
    svg: (c) => `<ellipse cx="99" cy="151" rx="3.4" ry="5.4" fill="${c}" transform="rotate(-12 99 151)"/>` },
  { id: "spleen", name: "脾", element: "earth", faces: ["front"], labelAt: [148, 156, "start"], tapAt: [138, 150],
    svg: (c) => `<ellipse cx="138" cy="150" rx="4.6" ry="8" fill="${c}" transform="rotate(14 138 150)"/>` },
  { id: "stomach", name: "胃", element: "earth", faces: ["front"], labelAt: [148, 141, "start"], tapAt: [122, 147],
    svg: (c) => `<path d="M113,139 Q126,135 132,143 Q136,150 128,155 Q118,159 112,152 Q107,145 113,139 Z" fill="${c}"/>` },
  { id: "lung", name: "肺", element: "metal", faces: ["front"], labelAt: [74, 106, "end"], tapAt: [93, 112],
    svg: (c) => `<g>
      <path d="M96,94 Q104,96 103,112 Q102,130 91,131 Q81,130 81,114 Q82,98 96,94 Z" fill="${c}"/>
      <path d="M124,94 Q116,96 117,112 Q118,130 129,131 Q139,130 139,114 Q138,98 124,94 Z" fill="${c}"/>
    </g>` },
  { id: "heart", name: "心", element: "fire", faces: ["front"], labelAt: [146, 114, "start"], tapAt: [113, 119],
    svg: (c) => `<path d="M108,107 Q120,105 123,115 Q125,126 115,130 Q104,132 102,121 Q101,111 108,107 Z" fill="${c}"/>` }
];

function organNamesFor(elementKey) {
  return ORGAN_SHAPES.filter((o) => o.element === elementKey).map((o) => o.name);
}

/* ---------- 内臓レイヤー ---------- */
function organsLayerSvg(elements, face, highlights) {
  const hlMap = {};
  (highlights || []).forEach((h) => { if (!hlMap[h.element]) hlMap[h.element] = h.role; });
  const anyHl = (highlights || []).length > 0;
  const parts = [`<g class="organs">`];
  for (const organ of ORGAN_SHAPES) {
    if (!organ.faces.includes(face)) continue;
    const color = elements[organ.element].color;
    const role = hlMap[organ.element];
    let cls = "organ";
    if (role) cls += ` hl hl-${role}`;
    else if (anyHl) cls += " dim";
    parts.push(`<g class="${cls}" data-organ="${organ.id}" style="cursor:pointer">${organ.svg(color)}</g>`);
  }
  if (face === "back") {
    parts.push(`<text x="110" y="222" text-anchor="middle" class="acu-label" font-size="10">背面: 腎(左右)と膀胱。腎は腰の高さ、背中側にあります</text>`);
  }
  parts.push(`</g>`);
  return parts.join("");
}

/* ---------- 骨格レイヤー(詳細データは anatomy-data.js) ---------- */
function bonesLayerSvg(face) {
  return face === "front" ? ANATOMY.bonesFront : ANATOMY.bonesBack;
}

/* ---------- 血管レイヤー(正面のみ) ---------- */
function vesselsLayerSvg(face) {
  if (face === "back") {
    return `<text x="110" y="180" text-anchor="middle" class="acu-label" font-size="10">血管は正面ビューでご覧ください</text>`;
  }
  // 心臓 + 詳細な動静脈ツリー(anatomy-data.js)
  return `<g class="vessels-layer">
    <path class="organ" d="M108,107 Q120,105 123,115 Q125,126 115,130 Q104,132 102,121 Q101,111 108,107 Z" fill="#ff5f6e" filter="drop-shadow(0 0 6px rgba(255,95,110,0.9))"/>
    ${ANATOMY.vesselsFront}
  </g>`;
}

/* ---------- 経絡・ツボレイヤー ---------- */
function meridiansLayerSvg(points, face) {
  const p = [`<g class="meridians-layer">`];
  p.push(face === "front" ? ANATOMY.linesFront : ANATOMY.linesBack);
  (points || []).forEach((pt, i) => {
    p.push(`<g class="acu-g" data-idx="${i}" style="cursor:pointer">` +
      `<circle class="acu-point" cx="${pt.x}" cy="${pt.y}" r="4"/>` +
      (pt.pair ? `<circle class="acu-point" cx="${220 - pt.x}" cy="${pt.y}" r="4"/>` : "") +
      `<text class="acu-label" x="${pt.x + (pt.x <= 110 ? -7 : 7)}" y="${pt.y + 3}" text-anchor="${pt.x <= 110 ? "end" : "start"}">${pt.name}</text>` +
      `</g>`);
  });
  p.push(`</g>`);
  return p.join("");
}

/* ---------- チャクラレイヤー ---------- */
function chakrasLayerSvg(points) {
  const p = [`<g class="chakras-layer">`];
  p.push(`<path class="meridian-line" d="M110,8 L110,205"/>`);
  (points || []).forEach((pt, i) => {
    p.push(`<g class="chakra-point" data-idx="${i}">` +
      `<circle cx="110" cy="${pt.y}" r="6.5" fill="${pt.color}" style="filter: drop-shadow(0 0 7px ${pt.color})"/>` +
      `<text class="acu-label" x="123" y="${pt.y + 3}" text-anchor="start">${pt.name}</text>` +
      `</g>`);
  });
  p.push(`</g>`);
  return p.join("");
}

/* ---------- 結果画面用の静的ボディ(正面・発光ハイライト) ---------- */
function buildBodySvg(opts) {
  const { elements } = opts;
  const highlights = opts.highlights || [];
  const parts = [];
  parts.push(`<svg class="body-figure" viewBox="0 0 220 360" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`);
  parts.push(silhouetteSvg("front"));
  parts.push(organsLayerSvg(elements, "front", highlights));
  if (opts.mode === "result") {
    const hlMap = {};
    highlights.forEach((h) => { if (!hlMap[h.element]) hlMap[h.element] = h.role; });
    for (const organ of ORGAN_SHAPES) {
      const role = hlMap[organ.element];
      if (!role || !organ.faces.includes("front")) continue;
      const [lx, ly, anchor] = organ.labelAt;
      const roleColor = role === "root" ? "#ff6b5e" : role === "window" ? "#ffb347" : "#b28cff";
      parts.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="organ-label" fill="${roleColor}">${organ.name}</text>`);
    }
    if (opts.marker) {
      const [mx, my] = opts.marker;
      parts.push(`<circle cx="${mx}" cy="${my}" r="11" class="marker-ring"/>`);
      parts.push(`<circle cx="${mx}" cy="${my}" r="4" fill="#ff6b5e"/>`);
    }
  }
  if (opts.mode === "select" && opts.hotspotsHtml) parts.push(opts.hotspotsHtml);
  parts.push(`</svg>`);
  return parts.join("");
}

/* ---------- 回転・ズーム Viewer ---------- */
function createBodyViewer(container, opts) {
  container.innerHTML = `
    <div class="viewer-holder">
      <button class="zoom-close" style="display:none">全体に戻す</button>
      <div class="viewer3d">
        <div class="viewer-stage"></div>
      </div>
    </div>
    <p class="viewer-hint">${opts.hint || "← 左右にスライドで回転 / 気になる場所をタップで拡大 →"}<span class="face-badge">正面</span></p>`;

  const v3d = container.querySelector(".viewer3d");
  const stage = container.querySelector(".viewer-stage");
  const closeBtn = container.querySelector(".zoom-close");
  const badge = container.querySelector(".face-badge");

  const state = { angle: 0, face: "front", vb: [...VIEWBOX_FULL], zoomed: false };

  function faceOf(angle) {
    const a = ((angle % 360) + 360) % 360;
    return a > 90 && a < 270 ? "back" : "front";
  }

  function svgEl() { return stage.querySelector("svg"); }

  function render() {
    const face = state.face;
    let content = silhouetteSvg(face) + opts.getContent(face);
    // 背面はrotateY(≒180°)で鏡像になるため、内容を反転し直してラベルを読めるようにする
    if (face === "back") {
      content = `<g transform="translate(220,0) scale(-1,1)">${content}</g>`;
    }
    stage.innerHTML = `<svg class="body-figure" viewBox="${state.vb.join(" ")}" xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
    badge.textContent = face === "front" ? "正面" : "背面";
  }

  function setAngle(a) {
    state.angle = a;
    const f = faceOf(a);
    if (f !== state.face) {
      state.face = f;
      render();
    }
    // 端(横向き)ではSVGが紙のように薄くなるため、明度と縮尺の演出で奥行きをカバー
    const c = Math.abs(Math.cos((a * Math.PI) / 180));
    stage.style.opacity = (0.35 + 0.65 * c).toFixed(3);
    stage.style.transform = `rotateY(${a}deg) scale(${(0.96 + 0.04 * c).toFixed(3)})`;
  }

  function setViewBox(vb) {
    state.vb = vb;
    const s = svgEl();
    if (s) s.setAttribute("viewBox", vb.join(" "));
  }

  function animateViewBox(to, done) {
    const from = [...state.vb];
    const t0 = performance.now();
    const dur = 380;
    function tick(t) {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setViewBox(from.map((f, i) => f + (to[i] - f) * e));
      if (k < 1) requestAnimationFrame(tick);
      else if (done) done();
    }
    requestAnimationFrame(tick);
  }

  const api = {
    zoomTo(cx, cy, done) {
      state.zoomed = true;
      closeBtn.style.display = "block";
      setAngle(Math.round(state.angle / 180) * 180); // スイング中でも正対してからズーム
      const w = 110, h = 150;
      animateViewBox([
        Math.max(-10, Math.min(220 - w + 10, cx - w / 2)),
        Math.max(-10, Math.min(360 - h + 10, cy - h / 2)),
        w, h
      ], done);
    },
    zoomOut(done) {
      state.zoomed = false;
      closeBtn.style.display = "none";
      animateViewBox([...VIEWBOX_FULL], () => {
        scheduleIdle();
        if (done) done();
      });
    },
    resetInstant() {
      state.zoomed = false;
      closeBtn.style.display = "none";
      state.vb = [...VIEWBOX_FULL];
      const s = svgEl();
      if (s) s.setAttribute("viewBox", VIEWBOX_FULL.join(" "));
    },
    rerender: render,
    get face() { return state.face; },
    get zoomed() { return state.zoomed; }
  };

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    api.zoomOut();
    if (opts.onZoomOut) opts.onZoomOut();
  });

  // --- ドラッグ回転(慣性つき) / タップ判定 ---
  let dragging = false, moved = false, startX = 0, baseAngle = 0;
  let velocity = 0, lastX = 0, momentumRaf = null, idleTimer = null, idleRaf = null;

  function stopMotion() {
    cancelAnimationFrame(momentumRaf);
    cancelAnimationFrame(idleRaf);
    clearTimeout(idleTimer);
  }

  // 指を離した後: 勢いで回り続け、減速したら最寄りの面へスプリングで吸着
  function startMomentum() {
    cancelAnimationFrame(momentumRaf);
    const friction = 0.945;
    function tick() {
      if (dragging) return;
      velocity *= friction;
      if (Math.abs(velocity) < 0.35) {
        const target = Math.round(state.angle / 180) * 180;
        const diff = target - state.angle;
        if (Math.abs(diff) < 0.15) {
          setAngle(target);
          scheduleIdle();
          return;
        }
        setAngle(state.angle + diff * 0.13);
      } else {
        setAngle(state.angle + velocity);
      }
      momentumRaf = requestAnimationFrame(tick);
    }
    momentumRaf = requestAnimationFrame(tick);
  }

  // しばらく触れないと、ゆったり左右にスイング(キャラクリ風の「生きてる」感)
  function scheduleIdle() {
    clearTimeout(idleTimer);
    cancelAnimationFrame(idleRaf);
    idleTimer = setTimeout(() => {
      if (state.zoomed) return;
      const base = state.angle;
      const t0 = performance.now();
      function sway(t) {
        if (dragging || state.zoomed) return;
        setAngle(base + Math.sin((t - t0) / 1500) * 6);
        idleRaf = requestAnimationFrame(sway);
      }
      idleRaf = requestAnimationFrame(sway);
    }, 3800);
  }

  v3d.addEventListener("pointerdown", (e) => {
    stopMotion();
    dragging = true;
    moved = false;
    startX = e.clientX;
    lastX = e.clientX;
    baseAngle = state.angle;
    velocity = 0;
    v3d.classList.add("dragging");
    v3d.setPointerCapture(e.pointerId);
  });

  v3d.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 6) moved = true;
    // 直近の指の速さを平滑化して慣性の初速にする
    velocity = velocity * 0.65 + (e.clientX - lastX) * 0.55 * 0.35;
    lastX = e.clientX;
    if (!moved) return;
    setAngle(baseAngle + dx * 0.55);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    v3d.classList.remove("dragging");
    if (moved) {
      startMomentum();
    } else {
      if (opts.onTap) {
        // pointer captureでe.targetがコンテナになるため、指の位置から実要素を取得する
        const target = document.elementFromPoint(e.clientX, e.clientY) || e.target;
        opts.onTap({ target, clientX: e.clientX, clientY: e.clientY }, state.face, api);
      }
      scheduleIdle();
    }
  }
  v3d.addEventListener("pointerup", endDrag);
  v3d.addEventListener("pointercancel", () => {
    dragging = false;
    v3d.classList.remove("dragging");
    scheduleIdle();
  });

  render();
  setAngle(0);
  scheduleIdle();
  return api;
}

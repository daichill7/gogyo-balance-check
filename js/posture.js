/* 写真で歪みチェック(β): MediaPipeによる完全端末内解析。
   写真は外部送信・保存を一切しない。解析後は「解析を終える」で破棄できる。 */
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from "./vendor/mediapipe/vision_bundle.mjs";

let poseLm = null;
let faceLm = null;
let filesetPromise = null;

function status(msg) {
  const el = document.querySelector("#posture-status");
  if (!msg) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.textContent = msg;
}

async function fileset() {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks("js/vendor/mediapipe/wasm");
  }
  return filesetPromise;
}

async function ensurePose() {
  if (poseLm) return poseLm;
  status("AIモデルを読み込んでいます…(初回のみ・約15MB)");
  poseLm = await PoseLandmarker.createFromOptions(await fileset(), {
    baseOptions: { modelAssetPath: "assets/models/pose_landmarker_lite.task" },
    runningMode: "IMAGE",
    numPoses: 1
  });
  return poseLm;
}

async function ensureFace() {
  if (faceLm) return faceLm;
  status("AIモデルを読み込んでいます…(初回のみ・約13MB)");
  faceLm = await FaceLandmarker.createFromOptions(await fileset(), {
    baseOptions: { modelAssetPath: "assets/models/face_landmarker.task" },
    runningMode: "IMAGE",
    numFaces: 1
  });
  return faceLm;
}

/* 2点を結ぶ線の水平からの傾き(度)。yは下向きが正 */
function tiltDeg(p1, p2, w, h) {
  let a = Math.atan2((p2.y - p1.y) * h, (p2.x - p1.x) * w) * 180 / Math.PI;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}

function band(absDeg) {
  if (absDeg < 1) return { label: "ほぼ水平です", cls: "ok" };
  if (absDeg < 2.5) return { label: "わずかな傾き", cls: "mild" };
  if (absDeg < 5) return { label: "傾きがあります", cls: "mid" };
  return { label: "大きめの傾き(撮影条件もご確認を)", cls: "strong" };
}

/* 本人基準の「低い側」。leftPt=本人の左のランドマーク */
function lowerSide(leftPt, rightPt) {
  if (Math.abs(leftPt.y - rightPt.y) < 0.004) return null;
  return leftPt.y > rightPt.y ? "左" : "右";
}

function metricRow(name, deg, side, note) {
  const b = band(Math.abs(deg));
  return `
    <div class="posture-metric">
      <div class="posture-metric-head">
        <span class="posture-metric-name">${name}</span>
        <span class="posture-metric-val posture-${b.cls}">${Math.abs(deg).toFixed(1)}°${side ? `(本人の${side}側が低め)` : ""}</span>
      </div>
      <p class="posture-metric-band posture-${b.cls}">${b.label}</p>
      ${note ? `<p class="posture-metric-note">${note}</p>` : ""}
    </div>`;
}

async function loadBitmap(file) {
  return await createImageBitmap(file, { imageOrientation: "from-image" });
}

function drawBase(bmp) {
  const maxW = 460;
  const scale = Math.min(1, maxW / bmp.width);
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  cv.className = "posture-canvas";
  const ctx = cv.getContext("2d");
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return { cv, ctx };
}

function line(ctx, p1, p2, w, h, color, dash) {
  ctx.beginPath();
  ctx.setLineDash(dash || []);
  ctx.moveTo(p1.x * w, p1.y * h);
  ctx.lineTo(p2.x * w, p2.y * h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [p1, p2]) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

const RESULT_FOOTER = `
  <div class="posture-cautions">
    <p>⚠️ この結果について</p>
    <ul>
      <li>計測値は撮影条件(カメラの傾き・姿勢・照明)で1〜2°ほど変わります。数値そのものより、<strong>同じ条件で撮り続けたときの変化</strong>を目安にしてください</li>
      <li>これは姿勢・バランスのセルフチェックであり、<strong>医療的な診断ではありません</strong></li>
      <li>強い左右差が続く場合や、痛み・しびれ・急に現れた左右差(顔のゆがみ等)を伴う場合は、チェックより先に医療機関を受診してください</li>
      <li>🔒 写真は端末内で解析済みです。送信・保存はされていません。「解析を終える」で画面からも消去できます</li>
    </ul>
  </div>
  <div class="result-actions">
    <button class="secondary-btn" id="posture-clear">🗑 解析を終える(画像を消す)</button>
  </div>`;

function renderResult(cv, metricsHtml, adviceHtml) {
  const box = document.querySelector("#posture-result");
  box.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "posture-result-inner";
  wrap.appendChild(cv);
  const info = document.createElement("div");
  info.innerHTML = `
    <p class="cycle-caption" style="margin:8px 0 10px">左右の表記は「写真に写っている本人」基準です(鏡とは逆になります)。</p>
    ${metricsHtml}
    ${adviceHtml}
    ${RESULT_FOOTER}`;
  wrap.appendChild(info);
  box.appendChild(wrap);
  document.querySelector("#posture-clear").addEventListener("click", () => {
    box.innerHTML = `<p class="cycle-caption">画像を消去しました。写真はどこにも残っていません。</p>`;
  });
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function adviceBlock(items) {
  if (!items.length) {
    return `<div class="posture-advice"><p class="posture-advice-title">🌿 いまのバランス</p>
      <p>大きな傾きは見られませんでした。この状態を保てるよう、長時間の同一姿勢を避けて、ときどき伸びをしてあげてください。</p></div>`;
  }
  return `<div class="posture-advice"><p class="posture-advice-title">🌿 気づきとセルフケアのヒント(東洋医学の見方・監修前ドラフト)</p>
    <ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
}

async function analyzeBody(file) {
  const lm = await ensurePose();
  status("解析中…");
  const bmp = await loadBitmap(file);
  const { cv, ctx } = drawBase(bmp);
  const res = lm.detect(cv);
  status(null);
  if (!res.landmarks || !res.landmarks.length) {
    document.querySelector("#posture-result").innerHTML =
      `<p class="posture-error">全身を検出できませんでした。明るい場所で、全身(頭〜足)が写るように撮り直してみてください。写真は送信されていません。</p>`;
    return;
  }
  const p = res.landmarks[0];
  const [lSh, rSh, lHip, rHip, lEar, rEar] = [p[11], p[12], p[23], p[24], p[7], p[8]];
  const w = cv.width, h = cv.height;

  line(ctx, rSh, lSh, w, h, "#ff5f6e");
  line(ctx, rHip, lHip, w, h, "#ffb347");
  line(ctx, rEar, lEar, w, h, "#4fd8ff");
  const midSh = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 };
  const midAn = { x: (p[27].x + p[28].x) / 2, y: (p[27].y + p[28].y) / 2 };
  line(ctx, midSh, midAn, w, h, "rgba(155,233,255,0.8)", [6, 6]);

  const shoulderDeg = tiltDeg(rSh, lSh, w, h);
  const pelvisDeg = tiltDeg(rHip, lHip, w, h);
  const headDeg = tiltDeg(rEar, lEar, w, h);
  const leanPct = ((midSh.x - midAn.x) * w) / (h * Math.abs(midAn.y - p[0].y) || 1) * 100;

  const metrics = [
    metricRow("肩のライン", shoulderDeg, lowerSide(lSh, rSh)),
    metricRow("骨盤のライン", pelvisDeg, lowerSide(lHip, rHip)),
    metricRow("頭の傾き", headDeg, lowerSide(lEar, rEar)),
  ].join("");

  const advice = [];
  if (Math.abs(shoulderDeg) >= 1) {
    advice.push("肩の高さに差があります。いつも同じ側でかばんを持つ・頬杖・マウス操作のくせがないか振り返ってみましょう。肩井(肩の一番高いところ)をやさしくほぐすのも◎。東洋医学では筋のこわばりは「肝」の気の滞りと関わるとされます。");
  }
  if (Math.abs(pelvisDeg) >= 1) {
    advice.push("骨盤の高さに差があります。脚を組むくせ・片足重心で立つくせをチェック。腰まわり(腎兪・命門)を温めるケアがおすすめです。腰を支える骨は「腎」と関わるとされます。");
  }
  if (Math.abs(headDeg) >= 1) {
    advice.push("頭がわずかに傾いています。スマホを見るときの姿勢や枕の高さを見直してみましょう。首の後ろ(風池)のツボ押しも助けになります。");
  }
  if (Math.abs(leanPct) >= 3) {
    advice.push("身体の中心線が左右どちらかに寄っています。立つときに両足へ均等に体重を乗せる意識を数日続けると変化が出やすい部分です。");
  }
  renderResult(cv, metrics, adviceBlock(advice));
}

async function analyzeFace(file) {
  const lm = await ensureFace();
  status("解析中…");
  const bmp = await loadBitmap(file);
  const { cv, ctx } = drawBase(bmp);
  const res = lm.detect(cv);
  status(null);
  if (!res.faceLandmarks || !res.faceLandmarks.length) {
    document.querySelector("#posture-result").innerHTML =
      `<p class="posture-error">顔を検出できませんでした。正面から、顔全体が明るく写るように撮り直してみてください。写真は送信されていません。</p>`;
    return;
  }
  const f = res.faceLandmarks[0];
  const w = cv.width, h = cv.height;
  // 本人の右目外側=33 / 左目外側=263、口角 右=61 / 左=291、眉 右=70 / 左=300
  const [rEye, lEye, rMouth, lMouth, rBrow, lBrow] = [f[33], f[263], f[61], f[291], f[70], f[300]];

  line(ctx, rEye, lEye, w, h, "#4fd8ff");
  line(ctx, rMouth, lMouth, w, h, "#ff5f6e");
  line(ctx, rBrow, lBrow, w, h, "#ffb347");

  const eyeDeg = tiltDeg(rEye, lEye, w, h);
  const mouthDeg = tiltDeg(rMouth, lMouth, w, h);
  const browDeg = tiltDeg(rBrow, lBrow, w, h);

  const metrics = [
    metricRow("目のライン", eyeDeg, lowerSide(lEye, rEye)),
    metricRow("眉のライン", browDeg, lowerSide(lBrow, rBrow)),
    metricRow("口角のライン", mouthDeg, lowerSide(lMouth, rMouth)),
  ].join("");

  const advice = [];
  if (Math.abs(eyeDeg) >= 1 || Math.abs(browDeg) >= 1) {
    advice.push("目もとの高さに差があります。頬杖・うつぶせ寝・片側だけで噛むくせがないか振り返ってみましょう。");
  }
  if (Math.abs(mouthDeg) >= 1.2) {
    advice.push("口角の高さに差があります。食事のとき左右均等に噛む意識と、あご周り(地倉・頬車のあたり)のやさしいマッサージがおすすめ。口もとは「脾胃」と関わるとされます。");
  }
  advice.push("顔の左右差は誰にでもあり、その日の むくみ・疲れでも変わります。「今日は左が重いな」といった変化に気づく道具として使ってください。");
  renderResult(cv, metrics, adviceBlock(advice));
}

async function handleFile(input, fn) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  try {
    await fn(file);
  } catch (e) {
    status(null);
    document.querySelector("#posture-result").innerHTML =
      `<p class="posture-error">解析に失敗しました。別の写真でもう一度お試しください(写真は送信されていません)。</p>`;
  }
}

export function initPostureCheck() {
  const bodyIn = document.querySelector("#posture-file-body");
  const faceIn = document.querySelector("#posture-file-face");
  if (!bodyIn) return;
  bodyIn.addEventListener("change", () => handleFile(bodyIn, analyzeBody));
  faceIn.addEventListener("change", () => handleFile(faceIn, analyzeFace));
}

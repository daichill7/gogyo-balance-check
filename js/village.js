/* 五行の村 v2: LINE風構成
   タブ: トーク(参加中の村) / 村をさがす / フレンド
   チャットは全画面オーバーレイ。画像送信・フレンド登録・引継ぎコード対応。
   バックエンド: Cloudflare Workers + Durable Objects (server/village-worker) */

const VILLAGE_API = localStorage.getItem("gogyo_api_override") || "https://gogyo-village.gas-teki-nd.workers.dev";
const DEVICE_KEY = "gogyo_device_id";
const NICK_KEY = "gogyo_village_nick";
const OKITE_KEY = "gogyo_okite_agreed_v1";
const ADMIN_KEY_STORE = "gogyo_admin_key";
const JOINED_KEY = "gogyo_joined_v1";
const FRIENDS_KEY = "gogyo_friends_v1";

const VILLAGE_THEMES = ["眠り", "冷え", "胃腸", "こころ", "食養生", "ツボ", "美容", "運動", "雑談"];

let villageInited = false;
let currentRoom = null; // { id, name, ws, closedByUser }
let adminTapCount = 0;
let currentVTab = "talk";

/* ---------- 共通ユーティリティ ---------- */
function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function saveJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* noop */ }
}

function myProfile() {
  let spirit = null;
  try {
    const saved = JSON.parse(localStorage.getItem("gogyo_fortune_v1"));
    if (saved && saved.key) spirit = { key: saved.key, name: saved.spiritName };
  } catch (e) { /* noop */ }
  return { device: deviceId(), nickname: localStorage.getItem(NICK_KEY) || "", spirit };
}

function spiritImg(key) {
  if (!key) return "";
  const [stemChar, tendency] = key.split("-");
  const idx = typeof STEMS !== "undefined" ? STEMS.indexOf(stemChar) : -1;
  return idx >= 0 ? `assets/spirits/${idx}-${tendency}.webp` : "";
}

async function api(path, opts = {}) {
  const res = await fetch(`${VILLAGE_API}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) }
  });
  return res.json();
}

function timeAgo(ts) {
  if (!ts) return "まだ静か";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

/* ---------- 入口・タブ ---------- */
async function initVillageMode() {
  if (!villageInited) {
    villageInited = true;
    document.querySelector("#village-hub-title").addEventListener("click", () => {
      adminTapCount++;
      if (adminTapCount >= 7) { adminTapCount = 0; openAdminPanel(); }
    });
    document.querySelectorAll(".vtab").forEach((b) =>
      b.addEventListener("click", () => showVTab(b.dataset.vtab))
    );
    document.querySelector("#village-create-btn").addEventListener("click", renderCreateForm);
    document.querySelector("#vc-back").addEventListener("click", () => showVTab("search"));
    document.querySelector("#vc-submit").addEventListener("click", submitCreate);
    document.querySelector("#admin-back").addEventListener("click", () => showVTab("search"));

    // チャット(全画面)
    document.querySelector("#chat-back").addEventListener("click", () => {
      if (location.hash.startsWith("#room/")) history.back();
      else closeChatOverlay();
    });
    document.querySelector("#chat-send").addEventListener("click", sendChat);
    document.querySelector("#chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendChat(); }
    });
    document.querySelector("#chat-img-input").addEventListener("change", sendImage);
    window.addEventListener("pagehide", leaveRoom);
    window.addEventListener("popstate", () => {
      if (!location.hash.startsWith("#room/")) closeChatOverlay();
    });

    // フレンド
    document.querySelector("#nick-edit-btn").addEventListener("click", () => {
      const nick = (prompt("村で使うニックネーム(12文字まで)", localStorage.getItem(NICK_KEY) || "") || "").trim().slice(0, 12);
      if (nick) { localStorage.setItem(NICK_KEY, nick); renderFriends(); }
    });
    document.querySelector("#transfer-export-btn").addEventListener("click", exportTransferCode);
    document.querySelector("#transfer-import-btn").addEventListener("click", importTransferCode);
  }
  renderMeishiSection();
  showVTab(currentVTab);
}

function showVTab(name) {
  currentVTab = name;
  for (const v of ["talk", "search", "friends"]) {
    document.querySelector(`#vtab-${v}`).classList.toggle("hidden", v !== name);
    document.querySelector(`.vtab[data-vtab="${v}"]`).classList.toggle("vtab-active", v === name);
  }
  document.querySelector("#village-view-create").classList.add("hidden");
  document.querySelector("#village-view-admin").classList.add("hidden");
  document.querySelector("#village-tabs-area").classList.remove("hidden");
  if (name === "talk") renderTalk();
  if (name === "search") renderSearch();
  if (name === "friends") renderFriends();
}

function showSubView(name) { // create | admin
  document.querySelector("#village-tabs-area").classList.add("hidden");
  document.querySelector("#village-view-create").classList.toggle("hidden", name !== "create");
  document.querySelector("#village-view-admin").classList.toggle("hidden", name !== "admin");
}

/* ディープリンク(#room/xxx で直接入村。PWA起動時にも使う) */
async function villageHandleHash() {
  const m = location.hash.match(/^#room\/([0-9a-f-]{36})/);
  if (m) {
    setMode("village");
    await openRoomById(m[1], { replaceHash: true });
  } else if (location.hash === "#village") {
    setMode("village");
  }
}

async function openRoomById(id, opts = {}) {
  try {
    const d = await api(`/api/villages/${id}`);
    if (d.village) { enterVillage(d.village, opts); return; }
  } catch (e) { /* noop */ }
  showToast("その村は見つかりませんでした(閉村した可能性があります)");
  const joined = loadJson(JOINED_KEY, []).filter((j) => j.id !== id);
  saveJson(JOINED_KEY, joined);
  renderTalk();
}

/* ---------- トーク(参加中の村) ---------- */
async function renderTalk() {
  const listEl = document.querySelector("#talk-list");
  const joined = loadJson(JOINED_KEY, []);
  if (!joined.length) {
    listEl.innerHTML = `<p class="cycle-caption" style="text-align:left">まだ参加した村がありません。「村をさがす」から気になる村に入ってみましょう。</p>`;
    return;
  }
  listEl.innerHTML = "";
  let live = {};
  try {
    const d = await api("/api/villages");
    for (const v of d.villages || []) live[v.id] = v;
  } catch (e) { /* オフラインでも一覧は出す */ }

  for (const j of joined.sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0))) {
    const v = live[j.id];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "talk-row" + (v ? "" : " talk-closed");
    const icon = document.createElement("span");
    icon.className = "talk-icon";
    icon.textContent = "🏡";
    const body = document.createElement("span");
    body.className = "talk-body";
    const nm = document.createElement("span");
    nm.className = "talk-name";
    nm.textContent = j.name;
    const sub = document.createElement("span");
    sub.className = "talk-sub";
    sub.textContent = v ? `${v.theme} ・ ${timeAgo(v.last_active)} ・ 発言 ${v.message_count}` : "閉村しました";
    body.append(nm, sub);
    row.append(icon, body);
    if (v) {
      row.addEventListener("click", () => enterVillage(v));
    } else {
      const del = document.createElement("span");
      del.className = "talk-del";
      del.textContent = "✕";
      row.appendChild(del);
      row.addEventListener("click", () => {
        saveJson(JOINED_KEY, loadJson(JOINED_KEY, []).filter((x) => x.id !== j.id));
        renderTalk();
      });
    }
    listEl.appendChild(row);
  }
}

function rememberJoined(village) {
  const joined = loadJson(JOINED_KEY, []).filter((j) => j.id !== village.id);
  joined.unshift({ id: village.id, name: village.name, theme: village.theme, lastVisit: Date.now() });
  saveJson(JOINED_KEY, joined.slice(0, 30));
}

/* ---------- 村をさがす ---------- */
async function renderSearch() {
  const p = myProfile();
  const profEl = document.querySelector("#village-profile");
  profEl.innerHTML = "";
  if (p.spirit) {
    const img = document.createElement("img");
    img.className = "vp-icon";
    img.src = spiritImg(p.spirit.key);
    img.alt = "";
    const span = document.createElement("span");
    span.textContent = `${p.spirit.name} として参加します`;
    profEl.append(img, span);
  } else {
    profEl.innerHTML = `<span>まず四柱推命で精霊を呼び出すと、そのキャラクターで村に参加できます</span>`;
    const btn = document.createElement("button");
    btn.className = "choice-chip";
    btn.textContent = "🔮 精霊を呼び出す";
    btn.addEventListener("click", () => setMode("fortune"));
    profEl.appendChild(btn);
  }

  const listEl = document.querySelector("#village-list");
  listEl.innerHTML = `<p class="cycle-caption">村を探しています…</p>`;
  try {
    const [pub, mine] = await Promise.all([
      api("/api/villages"),
      api(`/api/mine?device=${deviceId()}`)
    ]);
    const mineEl = document.querySelector("#village-mine");
    mineEl.innerHTML = "";
    const pending = (mine.villages || []).filter((v) => v.status === "pending");
    if (pending.length) {
      const div = document.createElement("div");
      div.className = "village-pending-note";
      div.textContent = `⏳ 審査待ちの申請: ${pending.map((v) => `「${v.name}」`).join("、")}(村長の承認をお待ちください)`;
      mineEl.appendChild(div);
    }
    listEl.innerHTML = "";
    const villages = pub.villages || [];
    if (!villages.length) {
      listEl.innerHTML = `<p class="cycle-caption">まだ村がありません。最初の村をつくってみませんか?</p>`;
      return;
    }
    for (const v of villages) {
      const card = document.createElement("button");
      card.className = "village-card-item";
      card.type = "button";
      const head = document.createElement("div");
      head.className = "vc-head";
      const nm = document.createElement("span");
      nm.className = "vc-name";
      nm.textContent = v.name;
      const tag = document.createElement("span");
      tag.className = "vc-tag";
      tag.textContent = v.theme;
      head.append(nm, tag);
      const desc = document.createElement("p");
      desc.className = "vc-desc";
      desc.textContent = v.description;
      const meta = document.createElement("p");
      meta.className = "vc-meta";
      meta.textContent = `発言 ${v.message_count} ・ ${timeAgo(v.last_active)} ・ 村長: ${v.founder_name}`;
      card.append(head, desc, meta);
      card.addEventListener("click", () => enterVillage(v));
      listEl.appendChild(card);
    }
  } catch (e) {
    listEl.innerHTML = `<p class="posture-error">村の一覧を読み込めませんでした。通信環境を確認して、時間をおいてお試しください。</p>`;
  }
}

/* ---------- 村をつくる ---------- */
function renderCreateForm() {
  const themeEl = document.querySelector("#vc-theme");
  if (!themeEl.options.length) {
    for (const t of VILLAGE_THEMES) themeEl.add(new Option(t, t));
  }
  document.querySelector("#vc-name").value = "";
  document.querySelector("#vc-desc").value = "";
  showSubView("create");
}

async function submitCreate() {
  const p = myProfile();
  if (!p.spirit) { showToast("先に四柱推命で精霊を呼び出してください"); return; }
  const nickname = ensureNickname();
  if (!nickname) return;
  const name = document.querySelector("#vc-name").value.trim();
  const theme = document.querySelector("#vc-theme").value;
  const description = document.querySelector("#vc-desc").value.trim();
  if (!name || !description) { showToast("村の名前と紹介文を入力してください"); return; }
  const btn = document.querySelector("#vc-submit");
  btn.disabled = true;
  try {
    const r = await api("/api/villages", {
      method: "POST",
      body: JSON.stringify({ name, theme, description, founder: { device: p.device, name: nickname, spirit: p.spirit.key } })
    });
    if (r.error) { showToast(r.error); return; }
    showToast("申請しました!村長の承認をお待ちください(承認されると一覧に登場します)");
    showVTab("search");
  } catch (e) {
    showToast("送信に失敗しました。時間をおいてお試しください");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 入村(おきて同意 → ニックネーム → チャット) ---------- */
function ensureNickname() {
  let nick = localStorage.getItem(NICK_KEY);
  if (!nick) {
    nick = (prompt("村で使うニックネームを教えてください(12文字まで)") || "").trim().slice(0, 12);
    if (!nick) return null;
    localStorage.setItem(NICK_KEY, nick);
  }
  return nick;
}

function enterVillage(village, opts = {}) {
  const p = myProfile();
  if (!p.spirit) {
    showToast("まず四柱推命で精霊を呼び出してください(そのキャラで参加します)");
    setMode("fortune");
    return;
  }
  if (!localStorage.getItem(OKITE_KEY)) {
    document.querySelector("#okite-modal").classList.remove("hidden");
    document.querySelector("#okite-agree").onclick = () => {
      localStorage.setItem(OKITE_KEY, "1");
      document.querySelector("#okite-modal").classList.add("hidden");
      enterVillage(village, opts);
    };
    return;
  }
  const nickname = ensureNickname();
  if (!nickname) return;
  openRoom(village, nickname, p, opts);
}

/* ---------- チャット(全画面オーバーレイ) ---------- */
function openChatOverlay() {
  document.querySelector("#chat-overlay").classList.remove("hidden");
  document.body.classList.add("chat-open");
}

function closeChatOverlay() {
  leaveRoom();
  document.querySelector("#chat-overlay").classList.add("hidden");
  document.body.classList.remove("chat-open");
  if (currentVTab === "talk") renderTalk();
}

function appendMessage(m, mine) {
  const list = document.querySelector("#chat-messages");
  if (list.querySelector(`[data-msg-id="${m.id}"]`)) return; // 二重表示防止
  const row = document.createElement("div");
  row.className = "chat-row" + (mine ? " chat-mine" : "");
  row.dataset.msgId = m.id;

  const icon = document.createElement("img");
  icon.className = "chat-icon";
  icon.src = spiritImg(m.spirit);
  icon.alt = "";
  if (!mine) {
    icon.classList.add("chat-icon-tappable");
    icon.title = "フレンドに追加";
    icon.addEventListener("click", () => addFriendFromMessage(m));
  }

  const body = document.createElement("div");
  body.className = "chat-body";
  const meta = document.createElement("p");
  meta.className = "chat-meta";
  const d = new Date(m.created_at);
  meta.textContent = `${m.name} ・ ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  body.appendChild(meta);

  if (m.img) {
    const img = document.createElement("img");
    img.className = "chat-img";
    img.src = `${VILLAGE_API}/api/images/${m.img}`;
    img.alt = "投稿画像";
    img.addEventListener("click", () => window.open(img.src, "_blank", "noopener"));
    body.appendChild(img);
  }
  if (m.text) {
    const bubble = document.createElement("p");
    bubble.className = "chat-bubble";
    bubble.textContent = m.text;
    body.appendChild(bubble);
  }

  row.append(icon, body);
  if (!mine) {
    const rep = document.createElement("button");
    rep.className = "chat-report";
    rep.title = "この発言を通報";
    rep.textContent = "⚑";
    rep.addEventListener("click", () => reportMessage(m));
    row.appendChild(rep);
  }
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

async function reportMessage(m) {
  if (!confirm(`この発言を村長に通報しますか?\n\n「${(m.text || "(画像)").slice(0, 40)}」`)) return;
  const reason = prompt("差し支えなければ理由を教えてください(任意)") || "";
  try {
    await api(`/api/rooms/${currentRoom.id}/report`, {
      method: "POST",
      body: JSON.stringify({ messageId: m.id, reason, device: deviceId() })
    });
    showToast("通報しました。村長が確認します");
  } catch (e) {
    showToast("通報を送れませんでした");
  }
}

function openRoom(village, nickname, profile, opts = {}) {
  leaveRoom(); // 前の接続が残っていたら必ず閉じる(多重接続の防止)
  rememberJoined(village);
  openChatOverlay();
  if (opts.replaceHash) history.replaceState(null, "", `#room/${village.id}`);
  else if (!location.hash.startsWith(`#room/${village.id}`)) location.hash = `#room/${village.id}`;

  document.querySelector("#chat-title").textContent = village.name;
  document.querySelector("#chat-theme").textContent = village.theme;
  document.querySelector("#chat-messages").innerHTML = `<p class="cycle-caption">村に入っています…</p>`;
  document.querySelector("#chat-online").textContent = "";

  const wsBase = VILLAGE_API.replace(/^http/, "ws");
  const params = new URLSearchParams({ device: profile.device, name: nickname, spirit: profile.spirit.key });
  const ws = new WebSocket(`${wsBase}/api/rooms/${village.id}/ws?${params}`);
  currentRoom = { id: village.id, name: village.name, ws, closedByUser: false };

  ws.onmessage = (e) => {
    if (!currentRoom || currentRoom.ws !== ws) return; // 古い接続からのイベントは無視
    const d = JSON.parse(e.data);
    if (d.type === "history") {
      document.querySelector("#chat-messages").innerHTML = "";
      for (const m of d.messages) appendMessage(m, m.device === profile.device);
      document.querySelector("#chat-online").textContent = `${d.online}人`;
    } else if (d.type === "msg") {
      appendMessage(d.message, d.message.device === profile.device);
    } else if (d.type === "presence") {
      document.querySelector("#chat-online").textContent = `${d.online}人`;
    } else if (d.type === "deleted") {
      const row = document.querySelector(`[data-msg-id="${d.id}"]`);
      if (row) {
        const b = row.querySelector(".chat-bubble") || row.querySelector(".chat-body");
        row.querySelector(".chat-img")?.remove();
        if (b) b.textContent = "(村長により削除されました)";
      }
    } else if (d.type === "error") {
      showToast(d.error);
    }
  };
  ws.onclose = (e) => {
    if (!currentRoom || currentRoom.ws !== ws) return;
    if (!currentRoom.closedByUser) {
      const list = document.querySelector("#chat-messages");
      const p = document.createElement("p");
      p.className = "cycle-caption";
      p.textContent = e.code === 1008 ? "この村への参加が制限されています" : "接続が切れました。戻ってもう一度入ってください";
      list.appendChild(p);
    }
  };
}

function sendChat() {
  const input = document.querySelector("#chat-input");
  const text = input.value.trim();
  if (!text || !currentRoom || currentRoom.ws.readyState !== WebSocket.OPEN) return;
  currentRoom.ws.send(JSON.stringify({ type: "msg", text }));
  input.value = "";
  input.focus();
}

/* 画像送信: 端末で縮小してからアップロード */
async function sendImage() {
  const input = document.querySelector("#chat-img-input");
  const file = input.files && input.files[0];
  input.value = "";
  if (!file || !currentRoom) return;
  showToast("画像を送信しています…");
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.82));
    if (!blob || blob.size > 2 * 1024 * 1024) { showToast("画像を2MB以下にできませんでした"); return; }
    const p = myProfile();
    const params = new URLSearchParams({ device: p.device, name: localStorage.getItem(NICK_KEY) || "旅人", spirit: p.spirit?.key || "" });
    const res = await fetch(`${VILLAGE_API}/api/rooms/${currentRoom.id}/image?${params}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: blob
    });
    const r = await res.json();
    if (r.error) showToast(r.error);
  } catch (e) {
    showToast("画像を送信できませんでした");
  }
}

function leaveRoom() {
  if (currentRoom) {
    currentRoom.closedByUser = true;
    try { currentRoom.ws.close(); } catch (e) { /* noop */ }
    currentRoom = null;
  }
}

/* ---------- フレンド ---------- */
function addFriendFromMessage(m) {
  const friends = loadJson(FRIENDS_KEY, []);
  if (m.device === deviceId()) return;
  if (friends.some((f) => f.device === m.device)) { showToast(`${m.name} はすでにフレンドです`); return; }
  if (!confirm(`${m.name} をフレンドに追加しますか?\n(フレンドタブから、いまどの村にいるかが見られます)`)) return;
  friends.unshift({ device: m.device, name: m.name, spirit: m.spirit, metIn: currentRoom?.name || "", addedAt: Date.now() });
  saveJson(FRIENDS_KEY, friends.slice(0, 100));
  showToast(`${m.name} をフレンドに追加しました`);
}

async function renderFriends() {
  const p = myProfile();
  // 自分のプロフィール
  const me = document.querySelector("#friend-me");
  me.innerHTML = "";
  const icon = document.createElement("img");
  icon.className = "vp-icon";
  icon.src = p.spirit ? spiritImg(p.spirit.key) : "";
  const info = document.createElement("div");
  info.className = "friend-me-info";
  const n1 = document.createElement("p");
  n1.className = "friend-me-nick";
  n1.textContent = p.nickname || "(ニックネーム未設定)";
  const n2 = document.createElement("p");
  n2.className = "friend-me-spirit";
  n2.textContent = p.spirit ? `精霊: ${p.spirit.name}` : "精霊: 未召喚";
  info.append(n1, n2);
  me.append(icon, info);

  // フレンド一覧
  const listEl = document.querySelector("#friend-list");
  const friends = loadJson(FRIENDS_KEY, []);
  if (!friends.length) {
    listEl.innerHTML = `<p class="cycle-caption" style="text-align:left">まだフレンドがいません。村のチャットで相手の精霊アイコンをタップすると追加できます。</p>`;
    return;
  }
  listEl.innerHTML = `<p class="cycle-caption" style="text-align:left">オンライン状態を確認中…</p>`;
  let presence = {};
  try {
    const d = await api("/api/presence/query", { method: "POST", body: JSON.stringify({ devices: friends.map((f) => f.device) }) });
    presence = d.presence || {};
  } catch (e) { /* noop */ }

  listEl.innerHTML = "";
  for (const f of friends) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const img = document.createElement("img");
    img.className = "vp-icon";
    img.src = spiritImg(f.spirit);
    const body = document.createElement("div");
    body.className = "friend-body";
    const nm = document.createElement("p");
    nm.className = "friend-name";
    nm.textContent = f.name;
    const st = document.createElement("p");
    st.className = "friend-status";
    const here = presence[f.device];
    st.textContent = here ? `🟢 いま「${here.villageName}」にいます` : `⚪ オフライン(出会った村: ${f.metIn || "-"})`;
    body.append(nm, st);
    row.append(img, body);
    if (here) {
      const go = document.createElement("button");
      go.className = "choice-chip";
      go.textContent = "会いに行く";
      go.addEventListener("click", () => openRoomById(here.villageId));
      row.appendChild(go);
    }
    const del = document.createElement("button");
    del.className = "friend-del";
    del.textContent = "✕";
    del.title = "フレンドから外す";
    del.addEventListener("click", () => {
      saveJson(FRIENDS_KEY, loadJson(FRIENDS_KEY, []).filter((x) => x.device !== f.device));
      renderFriends();
    });
    row.appendChild(del);
    listEl.appendChild(row);
  }
}

/* ---------- 引継ぎコード ---------- */
function exportTransferCode() {
  const data = {
    v: 1,
    d: localStorage.getItem(DEVICE_KEY),
    n: localStorage.getItem(NICK_KEY),
    f: localStorage.getItem("gogyo_fortune_v1"),
    ok: localStorage.getItem(OKITE_KEY),
    fr: localStorage.getItem(FRIENDS_KEY),
    jv: localStorage.getItem(JOINED_KEY)
  };
  const code = "GOGYO1." + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const box = document.querySelector("#transfer-code-box");
  box.classList.remove("hidden");
  box.value = code;
  box.select();
  navigator.clipboard?.writeText(code).then(
    () => showToast("引継ぎコードをコピーしました。新しい端末(ホーム画面版)で貼り付けてください"),
    () => showToast("コードを表示しました。長押しでコピーしてください")
  );
}

function importTransferCode() {
  const code = (prompt("引継ぎコードを貼り付けてください") || "").trim();
  if (!code.startsWith("GOGYO1.")) { if (code) showToast("コードの形式が違います"); return; }
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.slice(7)))));
    if (data.d) localStorage.setItem(DEVICE_KEY, data.d);
    if (data.n) localStorage.setItem(NICK_KEY, data.n);
    if (data.f) localStorage.setItem("gogyo_fortune_v1", data.f);
    if (data.ok) localStorage.setItem(OKITE_KEY, data.ok);
    if (data.fr) localStorage.setItem(FRIENDS_KEY, data.fr);
    if (data.jv) localStorage.setItem(JOINED_KEY, data.jv);
    showToast("引継ぎが完了しました!");
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    showToast("コードを読み込めませんでした");
  }
}

/* ---------- 村長パネル ---------- */
async function openAdminPanel() {
  let key = localStorage.getItem(ADMIN_KEY_STORE);
  if (!key) {
    key = prompt("村長キーを入力してください") || "";
    if (!key) return;
    localStorage.setItem(ADMIN_KEY_STORE, key);
  }
  showSubView("admin");
  const box = document.querySelector("#admin-body");
  box.innerHTML = `<p class="cycle-caption">読み込み中…</p>`;
  try {
    const d = await api("/api/admin/overview", { headers: { "x-admin-key": key } });
    if (d.error) {
      localStorage.removeItem(ADMIN_KEY_STORE);
      box.innerHTML = `<p class="posture-error">村長キーが違います。もう一度お試しください。</p>`;
      return;
    }
    box.innerHTML = "";

    const h1 = document.createElement("h3");
    h1.textContent = `審査待ちの村 (${d.pending.length})`;
    box.appendChild(h1);
    if (!d.pending.length) box.insertAdjacentHTML("beforeend", `<p class="cycle-caption">いまはありません</p>`);
    for (const v of d.pending) {
      const div = document.createElement("div");
      div.className = "admin-item";
      const p = document.createElement("p");
      p.textContent = `「${v.name}」(${v.theme}) — ${v.description} / 申請者: ${v.founder_name}`;
      const row = document.createElement("div");
      row.className = "result-actions";
      const ok = document.createElement("button");
      ok.className = "primary-btn village-btn";
      ok.textContent = "承認";
      ok.addEventListener("click", async () => {
        await api(`/api/admin/villages/${v.id}/approve`, { method: "POST", headers: { "x-admin-key": key } });
        showToast(`「${v.name}」を承認しました`);
        openAdminPanel();
      });
      const ng = document.createElement("button");
      ng.className = "secondary-btn";
      ng.textContent = "却下";
      ng.addEventListener("click", async () => {
        await api(`/api/admin/villages/${v.id}/reject`, { method: "POST", headers: { "x-admin-key": key } });
        openAdminPanel();
      });
      row.append(ok, ng);
      div.append(p, row);
      box.appendChild(div);
    }

    const h2 = document.createElement("h3");
    h2.textContent = `未対応の通報 (${d.reports.length})`;
    box.appendChild(h2);
    if (!d.reports.length) box.insertAdjacentHTML("beforeend", `<p class="cycle-caption">いまはありません</p>`);
    for (const r of d.reports) {
      const div = document.createElement("div");
      div.className = "admin-item";
      const p = document.createElement("p");
      p.textContent = `[${r.village_name}] ${r.message_author}「${r.message_text}」/ 理由: ${r.reason}`;
      const row = document.createElement("div");
      row.className = "result-actions";
      const del = document.createElement("button");
      del.className = "secondary-btn";
      del.textContent = "発言を削除";
      del.addEventListener("click", async () => {
        await api(`/api/admin/rooms/${r.village_id}/delete`, { method: "POST", headers: { "x-admin-key": key }, body: JSON.stringify({ messageId: r.message_id }) });
        showToast("削除しました");
      });
      const ban = document.createElement("button");
      ban.className = "secondary-btn";
      ban.textContent = "投稿者をBAN";
      ban.addEventListener("click", async () => {
        if (!confirm(`${r.message_author} をこの村からBANしますか?`)) return;
        await api(`/api/admin/rooms/${r.village_id}/ban`, { method: "POST", headers: { "x-admin-key": key }, body: JSON.stringify({ device: r.author_device }) });
        showToast("BANしました");
      });
      const done = document.createElement("button");
      done.className = "choice-chip";
      done.textContent = "対応済みにする";
      done.addEventListener("click", async () => {
        await api(`/api/admin/reports/${r.id}/resolve`, { method: "POST", headers: { "x-admin-key": key } });
        openAdminPanel();
      });
      row.append(del, ban, done);
      div.append(p, row);
      box.appendChild(div);
    }
  } catch (e) {
    box.innerHTML = `<p class="posture-error">読み込みに失敗しました。</p>`;
  }
}

/* ---------- 住民証(既存機能・フレンドタブ内) ---------- */
async function ensureSpirits() {
  if (typeof SPIRITS !== "undefined" && SPIRITS) return SPIRITS;
  const res = await fetch("data/spirits.json");
  SPIRITS = await res.json();
  return SPIRITS;
}

async function renderMeishiSection() {
  const box = document.querySelector("#village-meishi");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("gogyo_fortune_v1")); } catch (e) { /* noop */ }

  if (!saved || !saved.key) {
    box.innerHTML = `
      <p>四柱推命であなたの精霊を呼び出して「保存」すると、ここで<strong>住民証(名刺画像)</strong>が作れます。</p>
      <div class="result-actions"><button class="primary-btn gold-btn" id="village-to-fortune">🔮 先に精霊を呼び出す</button></div>`;
    box.querySelector("#village-to-fortune").addEventListener("click", () => setMode("fortune"));
    return;
  }

  const data = await ensureSpirits();
  const spirit = data.spirits[saved.key];
  const [stemChar, tendency] = saved.key.split("-");
  box.innerHTML = `
    <p>あなたの精霊「<strong>${spirit.name}</strong>」の住民証を作って、村の自己紹介に使えます。</p>
    <div class="result-actions">
      <button class="primary-btn village-btn" id="meishi-make">🪪 住民証を作る</button>
    </div>
    <div id="meishi-preview" class="meishi-preview"></div>`;
  box.querySelector("#meishi-make").addEventListener("click", () => makeMeishi(saved, spirit, stemChar, tendency));
}

async function makeMeishi(saved, spirit, stemChar, tendency) {
  const nickname = (localStorage.getItem(NICK_KEY) || "").trim();
  const stemIdx = STEMS.indexOf(stemChar);
  const tendName = SPIRITS.tendencies[tendency].name;

  const W = 750, H = 1000;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 330, 60, W / 2, 330, 520);
  glow.addColorStop(0, "rgba(53,217,138,0.22)");
  glow.addColorStop(1, "rgba(53,217,138,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(53,217,138,0.7)";
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.strokeStyle = "rgba(255,179,71,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(34, 34, W - 68, H - 68);

  ctx.textAlign = "center";
  ctx.fillStyle = "#9fe8c4";
  ctx.font = "700 34px 'Hiragino Mincho ProN', serif";
  ctx.fillText("五 行 の 村 ・ 住 民 証", W / 2, 92);
  ctx.fillStyle = "rgba(159,232,196,0.6)";
  ctx.font = "16px 'Hiragino Kaku Gothic ProN', sans-serif";
  ctx.fillText("GOGYO VILLAGE RESIDENT CARD", W / 2, 120);

  const img = new Image();
  img.src = `assets/spirits/${stemIdx}-${tendency}.webp`;
  await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; });
  const iw = 320, ih = Math.min(420, iw * img.height / img.width);
  ctx.save();
  ctx.beginPath();
  const rx = (W - iw) / 2, ry = 150;
  ctx.roundRect(rx, ry, iw, ih, 20);
  ctx.clip();
  ctx.fillStyle = "#f7f0e2";
  ctx.fillRect(rx, ry, iw, ih);
  ctx.drawImage(img, rx, ry, iw, ih);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,179,71,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(rx, ry, iw, ih, 20);
  ctx.stroke();

  let y = ry + ih + 64;
  ctx.fillStyle = "#ffb347";
  ctx.font = "24px 'Hiragino Kaku Gothic ProN', sans-serif";
  ctx.fillText(`${stemChar} × ${tendName} タイプ`, W / 2, y);
  y += 62;
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 56px 'Hiragino Mincho ProN', serif";
  ctx.fillText(spirit.name, W / 2, y);
  y += 40;
  ctx.fillStyle = "#9fe8c4";
  ctx.font = "22px 'Hiragino Kaku Gothic ProN', sans-serif";
  ctx.fillText(spirit.catch, W / 2, y);

  if (nickname) {
    y += 56;
    ctx.fillStyle = "#e8f1fb";
    ctx.font = "30px 'Hiragino Kaku Gothic ProN', sans-serif";
    ctx.fillText(`村の名前: ${nickname}`, W / 2, y);
  }

  ctx.fillStyle = "rgba(147,169,196,0.9)";
  ctx.font = "18px 'Hiragino Kaku Gothic ProN', sans-serif";
  ctx.fillText("五行バランスチェック", W / 2, H - 84);
  ctx.fillStyle = "rgba(79,216,255,0.9)";
  ctx.fillText("gogyo-balance-check.netlify.app", W / 2, H - 56);

  const url = cv.toDataURL("image/png");
  const prev = document.querySelector("#meishi-preview");
  prev.innerHTML = `
    <img src="${url}" alt="住民証プレビュー" class="meishi-img">
    <div class="result-actions result-subactions">
      <button class="secondary-btn" id="meishi-share">🔗 画像をシェア</button>
      <a class="secondary-btn" id="meishi-dl" href="${url}" download="五行の村_住民証_${spirit.name}.png" style="text-decoration:none;display:inline-block">⬇ 保存する</a>
    </div>`;
  prev.scrollIntoView({ behavior: "smooth", block: "nearest" });

  document.querySelector("#meishi-share").addEventListener("click", async () => {
    try {
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
      const file = new File([blob], "gogyo_resident_card.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "五行の村 住民証" });
      } else {
        showToast("この環境では画像シェアに未対応です。「保存する」から画像を保存してください");
      }
    } catch (e) { /* キャンセル等 */ }
  });
}

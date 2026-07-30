/* 五行の村 バックエンド (Cloudflare Workers + Durable Objects)
   - VillageRegistry: 村の一覧・作成申請・承認・通報の集約 (シングルトン)
   - VillageRoom: 村ごとのチャット部屋 (WebSocket Hibernation + SQLite) */
import { DurableObject } from "cloudflare:workers";

const ALLOWED_ORIGINS = [
  "https://gogyo-balance-check.netlify.app",
  "http://localhost:8752",
  "http://localhost:8787"
];

/* 禁止ワード(部分一致・小文字比較)。村のおきて: 連絡先交換・勧誘・宣伝の禁止 */
const NG_WORDS = [
  "line交換", "ライン交換", "line id", "ラインid", "カカオ", "テレグラム",
  "儲かる", "稼げる", "副業紹介", "投資勧誘", "マルチ商法", "ネットワークビジネス",
  "http://", "https://", "www."
];

const MAX_MSG_LEN = 300;
const MAX_NAME_LEN = 12;
const HISTORY_LIMIT = 50;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-admin-key",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) }
  });
}

function findNgWord(text) {
  const t = (text || "").toLowerCase();
  return NG_WORDS.find((w) => t.includes(w)) || null;
}

/* ============ 村の台帳 (シングルトン) ============ */
export class VillageRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS villages (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          theme TEXT NOT NULL,
          description TEXT NOT NULL,
          founder_device TEXT NOT NULL,
          founder_name TEXT NOT NULL,
          founder_spirit TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          message_count INTEGER NOT NULL DEFAULT 0,
          last_active INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          village_id TEXT NOT NULL,
          village_name TEXT NOT NULL,
          message_id TEXT NOT NULL,
          message_text TEXT NOT NULL,
          message_author TEXT NOT NULL,
          author_device TEXT NOT NULL,
          reason TEXT NOT NULL,
          reporter_device TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS presence (
          device TEXT PRIMARY KEY,
          village_id TEXT NOT NULL,
          village_name TEXT NOT NULL,
          spirit TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL
        );
      `);
    });
  }

  /* フレンドのオンライン表示用。online=falseで退室 */
  setPresence(device, villageId, villageName, spirit, online) {
    if (online) {
      this.ctx.storage.sql.exec(
        "INSERT INTO presence (device, village_id, village_name, spirit, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(device) DO UPDATE SET village_id=excluded.village_id, village_name=excluded.village_name, spirit=excluded.spirit, updated_at=excluded.updated_at",
        device, villageId, villageName, spirit, Date.now()
      );
    } else {
      this.ctx.storage.sql.exec("DELETE FROM presence WHERE device = ? AND village_id = ?", device, villageId);
    }
  }

  queryPresence(devices) {
    const out = {};
    const cutoff = Date.now() - 6 * 60 * 60 * 1000; // 6時間以上前の残留データは無視
    for (const d of devices.slice(0, 50)) {
      const rows = this.ctx.storage.sql
        .exec("SELECT village_id, village_name, updated_at FROM presence WHERE device = ? AND updated_at > ?", d, cutoff)
        .toArray();
      if (rows[0]) out[d] = { villageId: rows[0].village_id, villageName: rows[0].village_name };
    }
    return out;
  }

  submit({ name, theme, description, founder }) {
    // 1端末につき審査待ちは2件まで
    const pendingByDevice = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS c FROM villages WHERE founder_device = ? AND status = 'pending'", founder.device)
      .one().c;
    if (pendingByDevice >= 2) return { error: "審査待ちの申請が既にあります。承認をお待ちください" };
    const dup = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS c FROM villages WHERE name = ? AND status IN ('pending','approved')", name)
      .one().c;
    if (dup > 0) return { error: "同じ名前の村がすでにあります" };
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "INSERT INTO villages (id, name, theme, description, founder_device, founder_name, founder_spirit, status, created_at, last_active) VALUES (?,?,?,?,?,?,?,'pending',?,?)",
      id, name, theme, description, founder.device, founder.name, founder.spirit, Date.now(), Date.now()
    );
    return { id, status: "pending" };
  }

  listApproved() {
    return this.ctx.storage.sql
      .exec("SELECT id, name, theme, description, founder_name, founder_spirit, message_count, last_active, created_at FROM villages WHERE status = 'approved' ORDER BY last_active DESC")
      .toArray();
  }

  listMine(device) {
    return this.ctx.storage.sql
      .exec("SELECT id, name, theme, status, created_at FROM villages WHERE founder_device = ? ORDER BY created_at DESC", device)
      .toArray();
  }

  getVillage(id) {
    const rows = this.ctx.storage.sql
      .exec("SELECT id, name, theme, status FROM villages WHERE id = ?", id)
      .toArray();
    return rows[0] || null;
  }

  pending() {
    return this.ctx.storage.sql
      .exec("SELECT id, name, theme, description, founder_name, founder_spirit, created_at FROM villages WHERE status = 'pending' ORDER BY created_at ASC")
      .toArray();
  }

  setStatus(id, status) {
    this.ctx.storage.sql.exec("UPDATE villages SET status = ? WHERE id = ?", status, id);
    return { ok: true };
  }

  touch(villageId, msgDelta) {
    this.ctx.storage.sql.exec(
      "UPDATE villages SET message_count = message_count + ?, last_active = ? WHERE id = ?",
      msgDelta, Date.now(), villageId
    );
  }

  logReport(r) {
    this.ctx.storage.sql.exec(
      "INSERT INTO reports (village_id, village_name, message_id, message_text, message_author, author_device, reason, reporter_device, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      r.villageId, r.villageName, r.messageId, r.messageText, r.messageAuthor, r.authorDevice, r.reason, r.reporterDevice, Date.now()
    );
    return { ok: true };
  }

  openReports() {
    return this.ctx.storage.sql
      .exec("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 50")
      .toArray();
  }

  resolveReport(id) {
    this.ctx.storage.sql.exec("UPDATE reports SET status = 'resolved' WHERE id = ?", id);
    return { ok: true };
  }
}

/* ============ 村のチャット部屋 (村IDごとに1つ) ============ */
export class VillageRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map(); // device -> [timestamps]
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          device TEXT NOT NULL,
          name TEXT NOT NULL,
          spirit TEXT NOT NULL,
          text TEXT NOT NULL,
          img TEXT,
          created_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS bans (
          device TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
      `);
      // 既存テーブル(img列なし)への後方互換
      try {
        this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN img TEXT");
      } catch (e) { /* 既に存在 */ }
    });
  }

  isBanned(device) {
    return this.ctx.storage.sql.exec("SELECT COUNT(*) AS c FROM bans WHERE device = ?", device).one().c > 0;
  }

  history() {
    return this.ctx.storage.sql
      .exec(`SELECT id, device, name, spirit, text, img, created_at FROM messages WHERE deleted = 0 ORDER BY created_at DESC LIMIT ${HISTORY_LIMIT}`)
      .toArray()
      .reverse();
  }

  online() {
    return this.ctx.getWebSockets().length;
  }

  broadcast(payload) {
    const msg = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch (e) { /* 切断済みは無視 */ }
    }
  }

  /* WebSocket受け入れ (Worker から fetch で転送される) */
  async fetch(request) {
    const url = new URL(request.url);
    const device = (url.searchParams.get("device") || "").slice(0, 64);
    const name = (url.searchParams.get("name") || "旅人").slice(0, MAX_NAME_LEN);
    const spirit = (url.searchParams.get("spirit") || "").slice(0, 40);
    const villageId = url.searchParams.get("village") || "";
    const villageName = url.searchParams.get("vname") || "";
    if (!device) return new Response("device required", { status: 400 });
    if (this.isBanned(device)) return new Response("banned", { status: 403 });

    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment({ device, name, spirit, villageId, villageName });
    this.ctx.acceptWebSocket(server);

    // 接続直後に履歴と現在人数を送る
    server.send(JSON.stringify({ type: "history", messages: this.history(), online: this.online() }));
    this.broadcast({ type: "presence", online: this.online() });
    // フレンド用のオンライン状態を台帳へ(待たない)
    if (villageId) {
      const registry = this.env.REGISTRY.getByName("main");
      this.ctx.waitUntil(registry.setPresence(device, villageId, villageName, spirit, true));
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  checkRate(device) {
    const now = Date.now();
    const arr = (this.rate.get(device) || []).filter((t) => now - t < 60_000);
    if (arr.length >= 15) return "1分間に送れる回数の上限です。少し休んでから送ってください";
    if (arr.length && now - arr[arr.length - 1] < 2000) return "送信が速すぎます。2秒ほど空けてください";
    arr.push(now);
    this.rate.set(device, arr);
    return null;
  }

  async webSocketMessage(ws, raw) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    const att = ws.deserializeAttachment();
    if (!att || data.type !== "msg") return;

    if (this.isBanned(att.device)) {
      ws.send(JSON.stringify({ type: "error", error: "この村への参加が制限されています" }));
      return;
    }
    const text = String(data.text || "").trim().slice(0, MAX_MSG_LEN);
    if (!text) return;
    const ng = findNgWord(text);
    if (ng) {
      ws.send(JSON.stringify({ type: "error", error: "村のおきてにより送信できない言葉やURLが含まれています" }));
      return;
    }
    const rateErr = this.checkRate(att.device);
    if (rateErr) {
      ws.send(JSON.stringify({ type: "error", error: rateErr }));
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      device: att.device,
      name: att.name,
      spirit: att.spirit,
      text,
      created_at: Date.now()
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id, device, name, spirit, text, created_at) VALUES (?,?,?,?,?,?)",
      message.id, message.device, message.name, message.spirit, message.text, message.created_at
    );
    this.broadcast({ type: "msg", message });

    // 台帳の統計を更新(応答は待たない)
    if (att.villageId) {
      const registry = this.env.REGISTRY.getByName("main");
      this.ctx.waitUntil(registry.touch(att.villageId, 1));
    }
  }

  clearPresence(ws) {
    try {
      const att = ws.deserializeAttachment();
      if (att && att.device && att.villageId) {
        const registry = this.env.REGISTRY.getByName("main");
        this.ctx.waitUntil(registry.setPresence(att.device, att.villageId, "", "", false));
      }
    } catch (e) { /* noop */ }
  }

  async webSocketClose(ws) {
    this.clearPresence(ws);
    this.broadcast({ type: "presence", online: this.online() });
  }

  async webSocketError(ws) {
    this.clearPresence(ws);
    this.broadcast({ type: "presence", online: this.online() });
  }

  /* 画像メッセージの投稿(Workerのアップロード処理から呼ばれる) */
  postImage(meta, imgKey) {
    if (this.isBanned(meta.device)) return { error: "この村への参加が制限されています" };
    const rateErr = this.checkRate(meta.device);
    if (rateErr) return { error: rateErr };
    const message = {
      id: crypto.randomUUID(),
      device: meta.device,
      name: meta.name,
      spirit: meta.spirit,
      text: "",
      img: imgKey,
      created_at: Date.now()
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id, device, name, spirit, text, img, created_at) VALUES (?,?,?,?,?,?,?)",
      message.id, message.device, message.name, message.spirit, message.text, message.img, message.created_at
    );
    this.broadcast({ type: "msg", message });
    if (meta.villageId) {
      const registry = this.env.REGISTRY.getByName("main");
      this.ctx.waitUntil(registry.touch(meta.villageId, 1));
    }
    return { ok: true, id: message.id };
  }

  getMessage(id) {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM messages WHERE id = ?", id).toArray();
    return rows[0] || null;
  }

  deleteMessage(id) {
    const rows = this.ctx.storage.sql.exec("SELECT img FROM messages WHERE id = ?", id).toArray();
    this.ctx.storage.sql.exec("UPDATE messages SET deleted = 1 WHERE id = ?", id);
    this.broadcast({ type: "deleted", id });
    return { ok: true, img: rows[0]?.img || null };
  }

  banDevice(device) {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO bans (device, created_at) VALUES (?, ?)", device, Date.now());
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.device === device) {
        try { ws.close(1008, "banned"); } catch (e) { /* noop */ }
      }
    }
    return { ok: true };
  }
}

/* ============ Worker (ルーティング) ============ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const registry = env.REGISTRY.getByName("main");
    const isAdmin = request.headers.get("x-admin-key") === env.ADMIN_KEY;

    try {
      /* --- 村の一覧・申請 --- */
      if (path === "/api/villages" && request.method === "GET") {
        return json({ villages: registry ? await registry.listApproved() : [] }, origin);
      }
      if (path === "/api/villages" && request.method === "POST") {
        const body = await request.json();
        const name = String(body.name || "").trim().slice(0, 20);
        const theme = String(body.theme || "").trim().slice(0, 12);
        const description = String(body.description || "").trim().slice(0, 100);
        const founder = {
          device: String(body.founder?.device || "").slice(0, 64),
          name: String(body.founder?.name || "").trim().slice(0, MAX_NAME_LEN) || "旅人",
          spirit: String(body.founder?.spirit || "").slice(0, 40)
        };
        if (!name || !theme || !description || !founder.device) {
          return json({ error: "入力が足りません" }, origin, 400);
        }
        if (findNgWord(name) || findNgWord(description)) {
          return json({ error: "使用できない言葉やURLが含まれています" }, origin, 400);
        }
        const result = await registry.submit({ name, theme, description, founder });
        return json(result, origin, result.error ? 400 : 200);
      }
      if (path === "/api/mine" && request.method === "GET") {
        const device = url.searchParams.get("device") || "";
        return json({ villages: await registry.listMine(device) }, origin);
      }
      const villageGet = path.match(/^\/api\/villages\/([0-9a-f-]{36})$/);
      if (villageGet && request.method === "GET") {
        const v = await registry.getVillage(villageGet[1]);
        if (!v || v.status !== "approved") return json({ error: "村が見つかりません" }, origin, 404);
        return json({ village: v }, origin);
      }

      /* --- フレンドのオンライン状態 --- */
      if (path === "/api/presence/query" && request.method === "POST") {
        const body = await request.json();
        const devices = Array.isArray(body.devices) ? body.devices.map((d) => String(d).slice(0, 64)) : [];
        return json({ presence: await registry.queryPresence(devices) }, origin);
      }

      /* --- 画像(配信) --- */
      if (path.startsWith("/api/images/") && request.method === "GET") {
        const key = decodeURIComponent(path.slice("/api/images/".length));
        const obj = await env.IMAGES.get(key);
        if (!obj) return new Response("not found", { status: 404 });
        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType || "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
            ...corsHeaders(origin)
          }
        });
      }

      /* --- 画像(投稿) --- */
      const roomImg = path.match(/^\/api\/rooms\/([0-9a-f-]{36})\/image$/);
      if (roomImg && request.method === "POST") {
        const village = await registry.getVillage(roomImg[1]);
        if (!village || village.status !== "approved") return json({ error: "村が見つかりません" }, origin, 404);
        const meta = {
          device: (url.searchParams.get("device") || "").slice(0, 64),
          name: (url.searchParams.get("name") || "旅人").slice(0, MAX_NAME_LEN),
          spirit: (url.searchParams.get("spirit") || "").slice(0, 40),
          villageId: roomImg[1]
        };
        if (!meta.device) return json({ error: "device required" }, origin, 400);
        const buf = await request.arrayBuffer();
        if (buf.byteLength > 2.5 * 1024 * 1024) return json({ error: "画像は2MBまでです" }, origin, 413);
        if (buf.byteLength < 100) return json({ error: "画像を読み込めませんでした" }, origin, 400);
        // マジックバイトで画像形式を確認(JPEG/PNG/WebP)
        const b = new Uint8Array(buf.slice(0, 12));
        let ext = null, ctype = null;
        if (b[0] === 0xff && b[1] === 0xd8) { ext = "jpg"; ctype = "image/jpeg"; }
        else if (b[0] === 0x89 && b[1] === 0x50) { ext = "png"; ctype = "image/png"; }
        else if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) { ext = "webp"; ctype = "image/webp"; }
        if (!ext) return json({ error: "JPEG・PNG・WebPの画像のみ送れます" }, origin, 415);
        const key = `${roomImg[1]}/${crypto.randomUUID()}.${ext}`;
        await env.IMAGES.put(key, buf, { httpMetadata: { contentType: ctype } });
        const room = env.ROOM.getByName(roomImg[1]);
        const result = await room.postImage(meta, key);
        if (result.error) {
          await env.IMAGES.delete(key);
          return json(result, origin, 429);
        }
        return json(result, origin);
      }

      /* --- チャット部屋 --- */
      const roomWs = path.match(/^\/api\/rooms\/([0-9a-f-]{36})\/ws$/);
      if (roomWs) {
        const village = await registry.getVillage(roomWs[1]);
        if (!village || village.status !== "approved") return new Response("not found", { status: 404 });
        const room = env.ROOM.getByName(roomWs[1]);
        url.searchParams.set("village", roomWs[1]);
        url.searchParams.set("vname", village.name);
        return room.fetch(new Request(url.toString(), request));
      }
      const roomReport = path.match(/^\/api\/rooms\/([0-9a-f-]{36})\/report$/);
      if (roomReport && request.method === "POST") {
        const body = await request.json();
        const village = await registry.getVillage(roomReport[1]);
        if (!village) return json({ error: "村が見つかりません" }, origin, 404);
        const room = env.ROOM.getByName(roomReport[1]);
        const msg = await room.getMessage(String(body.messageId || ""));
        if (!msg) return json({ error: "対象の発言が見つかりません" }, origin, 404);
        await registry.logReport({
          villageId: village.id,
          villageName: village.name,
          messageId: msg.id,
          messageText: msg.text || (msg.img ? "(画像の投稿)" : ""),
          messageAuthor: msg.name,
          authorDevice: msg.device,
          reason: String(body.reason || "").slice(0, 100) || "未記入",
          reporterDevice: String(body.device || "").slice(0, 64)
        });
        return json({ ok: true }, origin);
      }

      /* --- 村長(管理) --- */
      if (path.startsWith("/api/admin/")) {
        if (!isAdmin) return json({ error: "unauthorized" }, origin, 401);
        if (path === "/api/admin/overview") {
          return json({ pending: await registry.pending(), reports: await registry.openReports() }, origin);
        }
        const approve = path.match(/^\/api\/admin\/villages\/([0-9a-f-]{36})\/(approve|reject|close)$/);
        if (approve && request.method === "POST") {
          const status = approve[2] === "approve" ? "approved" : approve[2] === "reject" ? "rejected" : "closed";
          await registry.setStatus(approve[1], status);
          return json({ ok: true, status }, origin);
        }
        const del = path.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/delete$/);
        if (del && request.method === "POST") {
          const body = await request.json();
          const room = env.ROOM.getByName(del[1]);
          const r = await room.deleteMessage(String(body.messageId || ""));
          if (r.img) await env.IMAGES.delete(r.img); // 削除メッセージの画像も消す
          return json({ ok: true }, origin);
        }
        const ban = path.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/ban$/);
        if (ban && request.method === "POST") {
          const body = await request.json();
          const room = env.ROOM.getByName(ban[1]);
          await room.banDevice(String(body.device || ""));
          return json({ ok: true }, origin);
        }
        const resolve = path.match(/^\/api\/admin\/reports\/(\d+)\/resolve$/);
        if (resolve && request.method === "POST") {
          await registry.resolveReport(Number(resolve[1]));
          return json({ ok: true }, origin);
        }
      }

      return json({ error: "not found" }, origin, 404);
    } catch (e) {
      console.error("worker error:", e);
      return json({ error: "サーバーエラーが発生しました" }, origin, 500);
    }
  }
};

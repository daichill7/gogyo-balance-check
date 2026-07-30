/* 楽天市場APIから、各証(パターン)の食養生に合う商品を取得して data/products.json を生成する。
   ※このファイルは公開ディレクトリに含めない(デプロイ対象は index.html/css/js/data/assets のみ)。
   実行: node tools/fetch-rakuten.mjs
   認証情報は環境変数から読む: RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY / RAKUTEN_AFFILIATE_ID */
import { readFileSync, writeFileSync } from "node:fs";

const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const ORIGIN = "https://gogyo-balance-check.netlify.app";
const EP = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

if (!APP_ID || !ACCESS_KEY || !AFFILIATE_ID) {
  console.error("環境変数 RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY / RAKUTEN_AFFILIATE_ID を設定してください");
  process.exit(1);
}

/* 証ごとの検索キーワード(食養生と整合するものを厳選。薬機法配慮で効能語は使わない) */
const QUERIES = {
  P01: ["クコの実", "なつめ 乾燥", "黒ごま"],
  P02: ["ジャスミン茶", "陳皮 茶", "しそ 乾燥"],
  P03: ["菊花茶", "ミント ティー", "緑茶 茶葉"],
  P04: ["蓮の実", "百合根", "カモミール ティー"],
  P05: ["山芋 とろろ", "なつめ 乾燥", "味噌 無添加"],
  P06: ["はと麦茶", "小豆 国産", "とうもろこしのひげ茶"],
  P07: ["切り干し大根", "緑豆 乾燥 500g", "梨 ジュース"],
  P08: ["生姜 粉末", "れんこん パウダー", "白きくらげ"],
  P09: ["白きくらげ", "はちみつ 国産", "百合根"],
  P10: ["黒豆茶", "くるみ 素焼き", "シナモン スティック"],
  P11: ["黒ごま ペースト", "山芋 パウダー", "桑の葉茶"],
  P12: ["黒豆 国産", "くるみ 無塩", "海藻 スープ"],
  P13: ["黒きくらげ", "よもぎ茶", "ローズ ティー"]
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(keyword) {
  const params = new URLSearchParams({
    applicationId: APP_ID,
    accessKey: ACCESS_KEY,
    affiliateId: AFFILIATE_ID,
    keyword,
    hits: "6",
    field: "1",                 // 商品名に一致するもののみ(説明文の巻き込みを防ぐ=精度の要)
    imageFlag: "1",             // 画像がある商品のみ
    minReviewCount: "5",
    maxPrice: "5000"            // 業務用の大容量品を除外。ソートは楽天の関連度順に任せる
  });
  const res = await fetch(`${EP}?${params}`, {
    headers: { Origin: ORIGIN, Referer: `${ORIGIN}/` }
  });
  const json = await res.json();
  if (!json.Items) {
    console.warn(`  ⚠ ${keyword}: ${JSON.stringify(json).slice(0, 90)}`);
    return [];
  }
  return json.Items.map(({ Item }) => ({
    name: Item.itemName.slice(0, 60),
    price: Item.itemPrice,
    url: Item.itemUrl,
    img: (Item.mediumImageUrls?.[0]?.imageUrl || "").replace(/\?_ex=\d+x\d+$/, "?_ex=200x200"),
    shop: Item.shopName,
    review: Item.reviewCount
  })).filter((i) => i.url.includes("hb.afl.rakuten.co.jp")); // アフィリエイトリンクのみ採用
}

const out = { version: "1", generatedAt: new Date().toISOString().slice(0, 10), byPattern: {} };
const mapping = JSON.parse(readFileSync(new URL("../data/mapping.json", import.meta.url)));

for (const [pid, keywords] of Object.entries(QUERIES)) {
  const name = mapping.patterns[pid]?.name || pid;
  const items = [];
  for (const kw of keywords) {
    const found = await search(kw);
    if (found[0]) items.push({ ...found[0], keyword: kw });
    await sleep(1400); // レート制限(1QPS)を厳守
  }
  out.byPattern[pid] = items;
  console.log(`${pid} ${name}: ${items.length}件 — ${items.map((i) => i.keyword).join(" / ")}`);
}

writeFileSync(new URL("../data/products.json", import.meta.url), JSON.stringify(out, null, 1));
const total = Object.values(out.byPattern).flat().length;
console.log(`\n✅ data/products.json を生成しました(全${total}件)`);

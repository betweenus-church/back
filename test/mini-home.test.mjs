import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { DatabaseService } = require("../dist/database/database.service.js");
const { MiniHomeService } = require("../dist/mini-home/mini-home.service.js");
const { CommunityService } = require("../dist/community/community.service.js");
const { seoulDate } = require("../dist/daily-word/date.js");

test("activity rewards, purchases and ownership persist without duplicate daily points", async () => {
  const root = mkdtempSync(
    join(process.env.DATABASE_PATH ? dirname(process.env.DATABASE_PATH) : resolve(".test-data"), "mini-home-"),
  );
  const oldDatabase = process.env.DATABASE_PATH,
    oldUploads = process.env.UPLOAD_DIR;
  let database;
  try {
    process.env.DATABASE_PATH = join(root, "test.sqlite");
    process.env.UPLOAD_DIR = join(root, "uploads");
    database = new DatabaseService();
    const db = database.db;
    const now = new Date().toISOString();
    for (const id of [1, 2])
      db.prepare("INSERT INTO members(id,name,phone,church,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(
        id,
        `테스트${id}`,
        `0100000000${id}`,
        "테스트교회",
        "approved",
        now,
        now,
      );
    const homes = new MiniHomeService(database);
    const community = new CommunityService(database, { get: () => ({}) }, { photoComment() {} }, homes);
    const untouched = homes.visit(2, "테스트교회");
    assert.equal(untouched.name, "테스트2");
    assert.equal(
      db.prepare("SELECT member_id FROM mini_homes WHERE member_id=2").get(),
      undefined,
      "visiting must not create or modify a home",
    );
    assert.deepEqual(
      Object.keys(untouched).sort(),
      ["id", "name", "church", "avatarUrl", "outfitId", "roomId", "message", "wardrobe"].sort(),
    );
    assert.throws(() => homes.visit(1, "다른교회"), /찾을 수/);
    assert.throws(() => homes.visit(9999, "테스트교회"), /찾을 수/);
    db.prepare("UPDATE members SET status='pending' WHERE id=2").run();
    assert.throws(() => homes.visit(2, "테스트교회"), /찾을 수/);
    db.prepare("UPDATE members SET status='approved' WHERE id=2").run();
    assert.equal(homes.snapshot(1).points, 0);
    assert.deepEqual(homes.snapshot(1).inventory, [
      "character-basic",
      "top-basic",
      "pants-basic",
      "socks-basic",
      "shoes-basic",
      "outfit-basic",
      "room-basic",
    ]);
    assert.throws(() => homes.equip(1, { itemId: "outfit-mint" }), /구매한/);
    assert.throws(() => homes.purchase(1, { itemId: "outfit-mint", price: 0 }), /포인트가 부족/);
    assert.throws(() => homes.purchase(1, { itemId: "unknown" }), /찾을 수/);

    const word = community.addWord(1, { text: "오늘의 말씀 나눔", date: "2026-10-02" });
    assert.equal(word.pointReward, 20);
    assert.equal(community.addWord(1, { text: "같은 날 두 번째 나눔" }).pointReward, 0);
    assert.equal(community.likeWord(1, word.id).pointReward, 10);
    assert.equal(community.likeWord(1, word.id).pointReward, 0);
    assert.equal(community.likeWord(1, word.id).pointReward, 0);
    const image = await sharp({ create: { width: 30, height: 50, channels: 3, background: "#91bea5" } })
      .png()
      .toBuffer();
    const file = { buffer: image, size: image.length, mimetype: "image/png", originalname: "test.png" };
    const photo = await community.addPhoto(
      1,
      { caption: "작은 순간", peopleConsent: "true", locationConsent: "true" },
      file,
    );
    assert.equal(photo.pointReward, 50);
    assert.equal(
      (await community.addPhoto(1, { caption: "두 번째 사진", peopleConsent: "true", locationConsent: "true" }, file))
        .pointReward,
      0,
    );
    assert.equal(community.likePhoto(1, photo.id).pointReward, 0, "photo and word likes share one daily reward");
    assert.equal(community.addComment(1, photo.id, { text: "반가워요" }).pointReward, 10);
    assert.equal(community.addComment(1, photo.id, { text: "다시 반가워요" }).pointReward, 0);
    assert.throws(() => community.addComment(2, photo.id, { text: "" }));
    assert.equal(homes.snapshot(2).points, 0, "failed action must not grant points");
    assert.throws(() => community.addPrayer(1, { text: "" }));
    const prayer = community.addPrayer(1, { text: "함께 기도해 주세요" });
    assert.equal(prayer.pointReward, 20);
    assert.equal(community.addPrayer(1, { text: "두 번째 기도" }).pointReward, 0);
    community.deletePrayer(1, prayer.id);
    assert.equal(community.addPrayer(1, { text: "삭제 후 다시 기도" }).pointReward, 0);
    assert.equal(homes.snapshot(1).points, 110);
    assert.equal(homes.snapshot(1).activities.filter((item) => item.completed).length, 5);
    community.deleteWord(1, word.id);
    assert.equal(community.addWord(1, { text: "삭제 후 다시 나눔" }).pointReward, 0);

    db.prepare("UPDATE point_ledger SET reward_date='2000-01-01' WHERE member_id=1 AND activity IS NOT NULL").run();
    assert.equal(community.addWord(1, { text: "다음 날 나눔" }).pointReward, 20);
    assert.equal(homes.snapshot(1).points, 130);
    const purchased = homes.purchase(1, { itemId: "outfit-mint", price: 1 });
    assert.equal(purchased.points, 30, "server catalog price is authoritative");
    assert.equal(purchased.outfitId, "outfit-basic", "purchase and equip are separate actions");
    assert.throws(() => homes.purchase(1, { itemId: "outfit-mint" }), /이미 보유/);
    assert.equal(homes.snapshot(1).points, 30);
    assert.equal(homes.equip(1, { itemId: "outfit-mint" }).outfitId, "outfit-mint");
    assert.throws(() => homes.equip(2, { itemId: "outfit-mint" }), /구매한/);
    assert.equal(homes.equip(1, { itemId: "outfit-basic" }).points, 30);
    db.prepare("UPDATE mini_homes SET points=1700 WHERE member_id=1").run();
    assert.equal(homes.purchase(1, { itemId: "room-garden" }).points, 1000);
    assert.equal(homes.equip(1, { itemId: "room-garden" }).roomId, "room-garden");
    assert.equal(homes.purchase(1, { itemId: "room-night" }).points, 0);
    assert.throws(() => homes.purchase(1, { itemId: "outfit-navy" }), /부족/);
    assert.equal(homes.snapshot(1).inventory.includes("outfit-navy"), false);
    homes.updateMessage(1, { message: "함께 걷는 하루" });
    assert.equal(homes.visit(1, "테스트교회").message, "함께 걷는 하루");
    assert.equal(homes.visit(1, "테스트교회").roomId, "room-garden");
    assert.throws(() => homes.updateMessage(1, { message: "a".repeat(81) }));
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM point_ledger WHERE member_id=1 AND activity='word' AND reward_date=?")
        .get(seoulDate()).n,
      1,
    );
    database.onModuleDestroy();
    database = new DatabaseService();
    const restored = new MiniHomeService(database).snapshot(1);
    assert.equal(restored.roomId, "room-garden");
    assert.equal(restored.message, "함께 걷는 하루");
    assert.equal(restored.inventory.includes("outfit-mint"), true);
    assert.equal(restored.points, 0);
  } finally {
    database?.onModuleDestroy();
    if (oldDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldDatabase;
    if (oldUploads === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = oldUploads;
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(dirname(root)) + "/") || target.startsWith(resolve(dirname(root)) + "\\"));
    rmSync(target, { recursive: true, force: true });
  }
});

test("120 male/female items equip independently, retain ownership and migrate existing homes", () => {
  const root = mkdtempSync(join(resolve(".test-data"), "wardrobe-"));
  const oldDatabase = process.env.DATABASE_PATH;
  let database;
  try {
    process.env.DATABASE_PATH = join(root, "test.sqlite");
    database = new DatabaseService();
    const db = database.db,
      now = new Date().toISOString();
    db.prepare(
      "INSERT INTO members(id,name,phone,church,status,created_at,updated_at) VALUES(1,'코디','01011112222','테스트교회','approved',?,?)",
    ).run(now, now);
    let homes = new MiniHomeService(database);
    homes.snapshot(1);
    db.prepare(
      "UPDATE mini_homes SET points=12100,outfit_id='outfit-peach',message='기존 소개' WHERE member_id=1",
    ).run();
    db.prepare("INSERT INTO mini_home_inventory VALUES(1,'outfit-peach',?)").run(now);
    // Recreate the previous schema to exercise an upgrade with existing data.
    db.exec("ALTER TABLE mini_homes DROP COLUMN wardrobe; PRAGMA user_version=12;");
    database.onModuleDestroy();
    database = new DatabaseService();
    homes = new MiniHomeService(database);
    assert.equal(homes.snapshot(1).points, 12100);
    assert.equal(homes.snapshot(1).wardrobe.top, "outfit-peach");
    assert.equal(homes.snapshot(1).message, "기존 소개");
    assert.ok(homes.snapshot(1).inventory.includes("outfit-peach"));
    const kinds = ["character", "top", "pants", "skirt", "socks", "shoes"];
    for (const kind of kinds) {
      const items = homes.snapshot(1).catalog.filter((item) => item.kind === kind && item.price > 0);
      assert.equal(items.length, 20, kind);
      for (const gender of ["male", "female"])
        assert.equal(items.filter((item) => item.gender === gender).length, 10, kind + gender);
      for (const item of items) {
        assert.equal(item.price, 100);
        assert.throws(() => homes.equip(1, { itemId: item.id }), /구매한/);
        homes.purchase(1, { itemId: item.id, price: 0 });
        const before = homes.snapshot(1).wardrobe;
        const after = homes.equip(1, { itemId: item.id }).wardrobe;
        assert.equal(after[kind], item.id);
        for (const other of kinds.filter(
          (key) => key !== kind && !(kind === "pants" && key === "skirt") && !(kind === "skirt" && key === "pants"),
        ))
          assert.equal(after[other], before[other]);
        if (kind === "pants") assert.equal(after.skirt, "");
        if (kind === "skirt") assert.equal(after.pants, "");
        assert.throws(() => homes.purchase(1, { itemId: item.id }), /이미 보유/);
      }
    }
    assert.equal(homes.snapshot(1).points, 100);
    assert.equal(homes.snapshot(1).history[0].amount, -100);
    homes.equip(1, { itemId: "pants-basic" });
    assert.equal(homes.snapshot(1).wardrobe.skirt, "");
    homes.equip(1, { itemId: "skirt-2" });
    const dressed = homes.snapshot(1).wardrobe;
    database.onModuleDestroy();
    database = new DatabaseService();
    homes = new MiniHomeService(database);
    assert.deepEqual(homes.snapshot(1).wardrobe, dressed);
    assert.equal(homes.snapshot(1).points, 100);
    assert.equal(homes.snapshot(1).inventory.filter((id) => /^(top|pants|skirt|socks|shoes)-\d+$/.test(id)).length, 50);
    homes.equip(1, { itemId: "outfit-peach" });
    assert.equal(homes.snapshot(1).wardrobe.top, "outfit-peach");
    assert.equal(homes.snapshot(1).wardrobe.skirt, "");
    assert.equal(homes.snapshot(1).wardrobe.character, "character-10", "legacy outfits preserve purchased character");
  } finally {
    database?.onModuleDestroy();
    if (oldDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldDatabase;
    assert.ok(resolve(root).startsWith(resolve(".test-data") + "\\"));
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { DatabaseService } = require("../dist/database/database.service.js");
const { InboxService } = require("../dist/inbox/inbox.service.js");
const { CommunityService } = require("../dist/community/community.service.js");
const { NewsService } = require("../dist/news/news.service.js");
const { PushService } = require("../dist/push/push.service.js");
const { AuthService } = require("../dist/auth/auth.service.js");

test("inbox records member events, preserves privacy, enforces ownership and hides removed sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "sai-inbox-"));
  const keys = ["DATABASE_PATH", "UPLOAD_DIR", "ADMIN_PASSWORD", "CHURCH_NAME", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let db;
  try {
    process.env.DATABASE_PATH = join(root, "test.sqlite");
    process.env.UPLOAD_DIR = join(root, "uploads");
    process.env.ADMIN_PASSWORD = "TestPass12!x";
    process.env.CHURCH_NAME = "테스트교회";
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    db = new DatabaseService();
    assert.equal(db.db.prepare("PRAGMA user_version").get().user_version, 10);
    const now = new Date().toISOString();
    const member = (name, phone, status) => Number(db.db.prepare("INSERT INTO members(name,phone,church,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(name, phone, "테스트교회", status, now, now).lastInsertRowid);
    const owner = member("주인", "01011111111", "approved");
    const actor = member("참여자", "01022222222", "approved");
    const pending = member("대기자", "01033333333", "pending");
    const inbox = new InboxService(db);
    const community = new CommunityService(db, {}, inbox);
    const news = new NewsService(db, inbox);
    const push = new PushService(db, {}, inbox);
    const photoId = Number(db.db.prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(?,?,?,?)")
      .run(owner, "사진", "file.jpg", now).lastInsertRowid);
    const commentId = community.addComment(actor, photoId, { text: "반가워요" }).id;
    community.addComment(owner, photoId, { text: "내 댓글" });
    const prayerId = community.addPrayer(owner, { text: "기도해 주세요" }).id;
    community.pray(actor, prayerId);
    community.pray(owner, prayerId);
    const story = await news.create({ title: "모임 안내", body: "오늘 모여요", category: "notice", status: "published" });
    assert.deepEqual(await push.sendAnnouncement({ title: "긴급 안내", message: "장소를 확인하세요" }), { delivered: 0, failed: 0 });
    assert.equal(inbox.list(owner).unreadCount, 4);
    assert.deepEqual(inbox.list(owner).items.map((item) => item.kind), ["announcement", "news", "prayer_support", "photo_comment"]);
    assert.equal(inbox.list(actor).unreadCount, 2);
    assert.equal(inbox.list(pending).items.length, 0);
    assert.equal(inbox.list(owner).items.find((item) => item.kind === "prayer_support").body.includes("참여자"), false);
    const auth = new AuthService(db);
    const token = "inbox-auth-token";
    db.db.prepare("INSERT INTO sessions(token_hash,member_id,role,expires_at) VALUES(?,?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), pending, "member", Date.now() + 60_000);
    assert.throws(() => auth.member({ headers: { cookie: `sai_member=${token}` } }), { status: 403 });
    assert.throws(() => inbox.read(actor, inbox.list(owner).items.find((item) => item.kind === "photo_comment").id), { status: 404 });
    const first = inbox.list(owner).items[0];
    const readAt = inbox.read(owner, first.id).readAt;
    assert.equal(inbox.read(owner, first.id).readAt, readAt);
    assert.equal(inbox.list(owner).unreadCount, 3);
    community.deleteComment(actor, photoId, commentId);
    community.pray(actor, prayerId);
    assert.deepEqual(inbox.list(owner).items.map((item) => item.kind), ["announcement", "news"]);
    community.pray(actor, prayerId);
    assert.equal(inbox.list(owner).items.filter((item) => item.kind === "prayer_support").length, 1);
    community.pray(actor, prayerId);
    assert.equal(inbox.list(owner).items.filter((item) => item.kind === "prayer_support").length, 0);
    assert.deepEqual(inbox.readAll(owner), { unreadCount: 0 });
    assert.equal(inbox.list(owner).unreadCount, 0);
    news.delete(story.id);
    assert.deepEqual(inbox.list(owner).items.map((item) => item.kind), ["announcement"]);
    db.onModuleDestroy(); db = undefined;
    db = new DatabaseService();
    assert.equal(db.db.prepare("PRAGMA user_version").get().user_version, 10);
    assert.equal(new InboxService(db).list(owner).items.length, 1);
  } finally {
    db?.onModuleDestroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("version 9 migration adds inbox without changing existing members", () => {
  const root = mkdtempSync(join(tmpdir(), "sai-inbox-migration-"));
  const oldPath = process.env.DATABASE_PATH;
  let db;
  try {
    process.env.DATABASE_PATH = join(root, "legacy.sqlite");
    db = new DatabaseService();
    const now = new Date().toISOString();
    db.db.prepare("INSERT INTO members(name,phone,church,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run("기존 회원", "01099999999", "테스트교회", "approved", now, now);
    db.db.exec("DROP TABLE inbox_items; PRAGMA user_version = 9");
    db.onModuleDestroy(); db = undefined;
    db = new DatabaseService();
    assert.equal(db.db.prepare("PRAGMA user_version").get().user_version, 10);
    assert.equal(db.db.prepare("SELECT name FROM members WHERE phone='01099999999'").get().name, "기존 회원");
    assert.deepEqual(new InboxService(db).list(1), { items: [], unreadCount: 0 });
  } finally {
    db?.onModuleDestroy();
    if (oldPath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const webPush = require("web-push");
const { DatabaseService } = require("../dist/database/database.service.js");
const { DailyWordService } = require("../dist/daily-word/daily-word.service.js");
const { PushService } = require("../dist/push/push.service.js");
const { InboxService } = require("../dist/inbox/inbox.service.js");

test("daily push follows Seoul time, respects opt-in, and sends once per date", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sai-push-"));
  const previous = Object.fromEntries(["DATABASE_PATH", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]
    .map((key) => [key, process.env[key]]));
  const originalSend = webPush.sendNotification;
  let db;
  try {
    const keys = webPush.generateVAPIDKeys();
    process.env.DATABASE_PATH = join(directory, "push.sqlite");
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "https://example.org";
    db = new DatabaseService();
    const now = new Date().toISOString();
    db.db.prepare("INSERT INTO members(name,phone,church,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run("테스트", "01012345678", "테스트교회", "approved", now, now);
    const memberId = Number(db.db.prepare("SELECT id FROM members").get().id);
    const push = new PushService(db, new DailyWordService(db), new InboxService(db));
    const endpoint = "https://fcm.googleapis.com/fcm/send/test-subscription";
    assert.equal(push.subscribe(memberId, { endpoint, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } }).subscribed, true);
    assert.equal(push.status(memberId, { endpoint }).subscribed, true);
    assert.equal(push.adminSettings().subscribers, 1);
    assert.throws(() => push.updateSettings({ enabled: true, time: "25:00" }));
    push.updateSettings({ enabled: true, time: "08:00" });
    const sent = [];
    webPush.sendNotification = async (_subscription, payload) => { sent.push(JSON.parse(payload)); return { statusCode: 201 }; };
    assert.equal(await push.sendDue(new Date("2026-10-06T07:59:00+09:00")), 0);
    assert.equal(await push.sendDue(new Date("2026-10-06T08:00:00+09:00")), 1);
    assert.equal(await push.sendDue(new Date("2026-10-06T08:01:00+09:00")), 0);
    assert.equal(await push.sendDue(new Date("2026-10-07T08:00:00+09:00")), 1);
    assert.deepEqual(sent.map((item) => item.date), ["2026-10-06", "2026-10-07"]);
    push.updateSettings({ enabled: false, time: "08:00" });
    assert.equal(await push.sendDue(new Date("2026-10-08T08:00:00+09:00")), 0);
    await push.sendToMember(memberId, "글이 삭제되었어요", "삭제 사유: 비방", "/community/inbox");
    assert.equal(sent.at(-1).url, "/community/inbox");
    assert.equal(sent.at(-1).body, "삭제 사유: 비방");
    await assert.rejects(push.sendAnnouncement({ title: "", message: "내용" }));
    await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용" }), { status: 400 });
    const notice = db.db.prepare("INSERT INTO notices(title,body,status,created_at,updated_at) VALUES(?,?,?,?,?)");
    const draftNoticeId = Number(notice.run("공지 초안", "본문", "draft", now, now).lastInsertRowid);
    const publishedNoticeId = Number(notice.run("게시 공지", "본문", "published", now, now).lastInsertRowid);
    for (const noticeId of [null, 0, -1, 1.5, "1"]) {
      await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", noticeId }), { status: 400 });
    }
    for (const noticeId of [draftNoticeId, 999999]) {
      await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", noticeId }), { status: 404 });
    }
    assert.deepEqual(await push.sendAnnouncement({ title: "청년부 안내", message: "오늘 모임 장소를 확인해 주세요.", noticeId: publishedNoticeId }),
      { delivered: 1, failed: 0 });
    assert.equal(sent.at(-1).kind, "announcement");
    assert.equal(sent.at(-1).url, `/community/notices/${publishedNoticeId}`);
    assert.equal(db.db.prepare("SELECT url FROM inbox_items WHERE kind='announcement' ORDER BY id DESC LIMIT 1").get().url,
      `/community/notices/${publishedNoticeId}`);
    const news = db.db.prepare("INSERT INTO news(title,body,category,status,created_at,updated_at) VALUES(?,?,?,?,?,?)");
    const draftId = Number(news.run("초안", "본문", "notice", "draft", now, now).lastInsertRowid);
    const publishedId = Number(news.run("게시글", "본문", "notice", "published", now, now).lastInsertRowid);
    await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", newsId: publishedId, noticeId: publishedNoticeId }), { status: 400 });
    for (const newsId of [null, 0, -1, 1.5, "1"]) {
      await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", newsId }), { status: 400 });
    }
    for (const newsId of [draftId, 999999]) {
      await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", newsId }), { status: 404 });
    }
    assert.deepEqual(await push.sendAnnouncement({ title: "게시글 안내", message: "확인해 주세요.", newsId: publishedId }),
      { delivered: 1, failed: 0 });
    assert.equal(sent.at(-1).url, `/community/news/${publishedId}`);
    const announcement = db.db.prepare("SELECT url,source_id FROM inbox_items WHERE kind='announcement' ORDER BY id DESC LIMIT 1").get();
    assert.equal(announcement.url, `/community/news/${publishedId}`);
    assert.equal(announcement.source_id, publishedId);
    db.db.prepare("UPDATE news SET deleted_at=? WHERE id=?").run(now, publishedId);
    await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", newsId: publishedId }), { status: 404 });
    db.db.prepare("UPDATE notices SET status='ended' WHERE id=?").run(publishedNoticeId);
    await assert.rejects(push.sendAnnouncement({ title: "안내", message: "내용", noticeId: publishedNoticeId }), { status: 404 });
    db.db.prepare("UPDATE members SET status='suspended' WHERE id=?").run(memberId);
    const anotherNoticeId = Number(notice.run("새 공지", "본문", "published", now, now).lastInsertRowid);
    assert.deepEqual(await push.sendAnnouncement({ title: "청년부 안내", message: "테스트", noticeId: anotherNoticeId }),
      { delivered: 0, failed: 0 });
    push.unsubscribe(memberId, { endpoint });
    assert.equal(push.status(memberId, { endpoint }).subscribed, false);
  } finally {
    webPush.sendNotification = originalSend;
    db?.onModuleDestroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

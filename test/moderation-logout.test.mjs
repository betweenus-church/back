import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { DatabaseService } = require("../dist/database/database.service.js");
const { CommunityService } = require("../dist/community/community.service.js");
const { AdminService } = require("../dist/admin/admin.service.js");
const { AuthService } = require("../dist/auth/auth.service.js");
const { InboxService } = require("../dist/inbox/inbox.service.js");

async function fixture(run) {
  const previous = Object.fromEntries(
    ["DATABASE_PATH", "UPLOAD_DIR", "ADMIN_PASSWORD", "CHURCH_NAME"].map((key) => [key, process.env[key]]),
  );
  const parent = previous.DATABASE_PATH ? dirname(previous.DATABASE_PATH) : resolve(".test-data");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "moderation-logout-"));
  let data;
  try {
    Object.assign(process.env, {
      DATABASE_PATH: join(root, "test.sqlite"),
      UPLOAD_DIR: join(root, "uploads"),
      ADMIN_PASSWORD: "TemporaryQa12!",
      CHURCH_NAME: "테스트교회",
    });
    data = new DatabaseService();
    const now = new Date().toISOString();
    for (const [name, phone] of [
      ["원작성자", "01011111111"],
      ["새작성자", "01022222222"],
    ]) {
      data.db
        .prepare("INSERT INTO members(name,phone,church,status,created_at,updated_at) VALUES(?,?,?,'approved',?,?)")
        .run(name, phone, "테스트교회", now, now);
    }
    const inbox = new InboxService(data);
    const community = new CommunityService(data, { get() {} }, inbox);
    const admin = new AdminService(data, inbox, { async sendToMember() {} });
    await run({ data, db: data.db, community, admin, now });
  } finally {
    data?.onModuleDestroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(dirname(resolve(root)), resolve(parent));
    rmSync(root, { recursive: true, force: true });
  }
}

test("deleted report targets never become new photos, words, prayers or comments", () =>
  fixture(async ({ db, community, admin, now }) => {
    const parentPhoto = Number(
      db
        .prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(1,'parent','parent.webp',?)")
        .run(now).lastInsertRowid,
    );
    for (const kind of ["photo", "word", "prayer", "comment"]) {
      const table = { photo: "photos", word: "word_posts", prayer: "prayers", comment: "photo_comments" }[kind];
      const create = (member) =>
        kind === "photo"
          ? Number(
              db
                .prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(?,'photo','photo.webp',?)")
                .run(member, now).lastInsertRowid,
            )
          : kind === "word"
            ? community.addWord(member, { text: "말씀 나눔" }).id
            : kind === "prayer"
              ? community.addPrayer(member, { text: "기도" }).id
              : community.addComment(member, parentPhoto, { text: "댓글" }).id;
      const original = create(1);
      const report = community.report(2, { kind, postId: original, reason: "신고 사유" });
      if (kind === "photo") community.deletePhoto(1, original);
      else if (kind === "word") community.deleteWord(1, original);
      else if (kind === "prayer") community.deletePrayer(1, original);
      else community.deleteComment(1, parentPhoto, original);
      const replacement = create(2);
      assert.ok(replacement > original, kind);
      const item = admin.reports().find((row) => row.id === report.id);
      assert.equal(item.targetAvailable, false);
      assert.equal(item.excerpt, null);
      assert.throws(
        () => admin.reportImage(report.id),
        (error) => error.getStatus() === 404,
      );
      for (const action of ["hide", "delete"])
        await assert.rejects(
          admin.resolveReport(report.id, { action, resolution: "검토" }),
          (error) => error.getStatus() === 409,
        );
      assert.equal(db.prepare(`SELECT hidden FROM ${table} WHERE id=?`).get(replacement).hidden, 0);
      assert.equal(db.prepare("SELECT status FROM reports WHERE id=?").get(report.id).status, "pending");
      await admin.resolveReport(report.id, { action: "dismiss", resolution: "원본 삭제로 검토 종료" });
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM inbox_items WHERE title LIKE '%삭제되었어요'").get().n, 0);
    const active = community.addPrayer(1, { text: "검토 대상" });
    const report = community.report(2, { kind: "prayer", postId: active.id, reason: "검토" });
    await admin.resolveReport(report.id, { action: "delete", resolution: "운영 정책" });
    assert.equal(db.prepare("SELECT hidden FROM prayers WHERE id=?").get(active.id).hidden, 1);
    assert.equal(db.prepare("SELECT member_id FROM inbox_items WHERE title LIKE '%삭제되었어요'").get().member_id, 1);
  }));

test("v13 migration preserves rows and relations but never trusts historical report identity", () =>
  fixture(async ({ data, db, now }) => {
    const photoId = Number(
      db
        .prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(1,'보존할 사진','keep.webp',?)")
        .run(now).lastInsertRowid,
    );
    db.prepare("INSERT INTO photo_comments(photo_id,member_id,text,created_at) VALUES(?,2,'댓글 보존',?)").run(
      photoId,
      now,
    );
    db.prepare("INSERT INTO photo_likes(photo_id,member_id) VALUES(?,2)").run(photoId);
    db.prepare("INSERT INTO reports(reporter_id,kind,post_id,reason,created_at) VALUES(2,'photo',?,'이전 신고',?)").run(
      photoId,
      now,
    );
    db.prepare(
      "INSERT INTO reports(reporter_id,kind,post_id,reason,created_at) VALUES(2,'word',83,'삭제된 말씀 신고',?)",
    ).run(now);
    db.prepare(
      "INSERT INTO inbox_items(member_id,kind,title,body,url,created_at,source_id) VALUES(1,'photo_comment','이전 댓글','내용','/community/photos/120',?,81)",
    ).run(now);
    db.prepare(
      "INSERT INTO inbox_items(member_id,kind,title,body,url,created_at,source_id,actor_id) VALUES(1,'prayer_support','이전 기도','내용','/community/prayer',?,82,2)",
    ).run(now);
    // Recreate the pre-fix ID schema and an unverified legacy report.
    db.exec("PRAGMA foreign_keys=OFF; BEGIN");
    for (const table of ["word_posts", "photos", "photo_comments", "prayers"]) {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
      const indexes = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL")
        .all(table);
      db.exec(
        sql.replace(/CREATE TABLE\s+(?:"[^"]+"|\w+)/i, `CREATE TABLE ${table}_old`).replace(" AUTOINCREMENT", ""),
      );
      db.exec(
        `INSERT INTO ${table}_old SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_old RENAME TO ${table};`,
      );
      for (const index of indexes) db.exec(index.sql);
    }
    db.exec(
      "ALTER TABLE reports DROP COLUMN target_created_at; PRAGMA user_version=13; COMMIT; PRAGMA foreign_keys=ON",
    );
    // A second connection exercises startup migration against preserved data.
    const migrated = new DatabaseService();
    try {
      assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 14);
      assert.equal(migrated.db.prepare("SELECT caption FROM photos WHERE id=?").get(photoId).caption, "보존할 사진");
      assert.equal(migrated.db.prepare("SELECT count(*) AS n FROM photo_likes").get().n, 1);
      assert.equal(migrated.db.prepare("SELECT count(*) AS n FROM photo_comments").get().n, 1);
      assert.deepEqual(migrated.db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(migrated.db.prepare("SELECT target_created_at FROM reports").get().target_created_at, null);
      const admin = new AdminService(migrated, new InboxService(migrated), { async sendToMember() {} });
      assert.equal(admin.reports()[0].targetAvailable, false);
      await assert.rejects(
        admin.resolveReport(admin.reports()[0].id, { action: "delete", resolution: "검토" }),
        (error) => error.getStatus() === 409,
      );
      for (const table of ["word_posts", "photos", "photo_comments", "prayers"])
        assert.match(migrated.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql, /AUTOINCREMENT/);
      assert.ok(
        Number(
          migrated.db
            .prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(1,'새 사진','new.webp',?)")
            .run(now).lastInsertRowid,
        ) > 120,
      );
      assert.ok(
        Number(
          migrated.db
            .prepare("INSERT INTO photo_comments(photo_id,member_id,text,created_at) VALUES(?,1,'새 댓글',?)")
            .run(photoId, now).lastInsertRowid,
        ) > 81,
      );
      assert.ok(
        Number(
          migrated.db.prepare("INSERT INTO prayers(member_id,text,created_at) VALUES(1,'새 기도',?)").run(now)
            .lastInsertRowid,
        ) > 82,
      );
      assert.ok(
        Number(
          migrated.db.prepare("INSERT INTO word_posts(member_id,text,created_at) VALUES(1,'새 말씀',?)").run(now)
            .lastInsertRowid,
        ) > 83,
      );
      assert.equal(
        new InboxService(migrated).list(1).items.length,
        0,
        "old deleted-source inbox items stay unavailable",
      );
    } finally {
      migrated.onModuleDestroy();
    }
    assert.ok(data);
  }));

test("logout removes only the current member's supplied device subscription", () =>
  fixture(async ({ data, db, now }) => {
    const auth = new AuthService(data);
    const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
    for (const [token, member] of [
      ["phone", 1],
      ["tablet", 1],
      ["other", 2],
      ["without-endpoint", 1],
    ]) {
      db.prepare("INSERT INTO sessions(token_hash,member_id,role,expires_at) VALUES(?,?,'member',?)").run(
        tokenHash(token),
        member,
        Date.now() + 60000,
      );
    }
    for (const [endpoint, member] of [
      ["phone", 1],
      ["tablet", 1],
      ["other", 2],
    ])
      db.prepare(
        "INSERT INTO push_subscriptions(member_id,endpoint,p256dh,auth,created_at) VALUES(?,?, 'key','auth',?)",
      ).run(member, endpoint, now);
    const response = { setHeader() {} };
    auth.logout({ headers: { cookie: "sai_member=without-endpoint" } }, response, "member");
    assert.equal(db.prepare("SELECT count(*) AS n FROM push_subscriptions").get().n, 3);
    auth.logout({ headers: { cookie: "sai_member=phone" } }, response, "member", { endpoint: "other" });
    assert.equal(db.prepare("SELECT count(*) AS n FROM push_subscriptions").get().n, 3);
    auth.logout({ headers: { cookie: "sai_member=tablet" } }, response, "member", { endpoint: "tablet" });
    assert.deepEqual(
      db
        .prepare("SELECT endpoint FROM push_subscriptions ORDER BY endpoint")
        .all()
        .map((row) => row.endpoint),
      ["other", "phone"],
    );
    assert.ok(db.prepare("SELECT 1 FROM sessions WHERE token_hash=?").get(tokenHash("other")));
  }));

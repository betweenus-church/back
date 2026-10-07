import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const require = createRequire(import.meta.url);
const { DatabaseService } = require("../dist/database/database.service.js");

test("v4 word posts keep their text and gain their Seoul calendar date", () => {
  const root = mkdtempSync(join(tmpdir(), "sai-migrate-test-"));
  const path = join(root, "legacy.sqlite");
  const oldPath = process.env.DATABASE_PATH;
  let migrated;
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT; CREATE TABLE word_posts (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0) STRICT; PRAGMA user_version = 4;");
    legacy.prepare("INSERT INTO word_posts(member_id,text,created_at) VALUES(?,?,?)").run(1, "기존 나눔", "2026-10-01T16:00:00.000Z");
    legacy.close();

    process.env.DATABASE_PATH = path;
    migrated = new DatabaseService();
    assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 8);
    const row = migrated.db.prepare("SELECT text,daily_word_date FROM word_posts").get();
    assert.equal(row.text, "기존 나눔");
    assert.equal(row.daily_word_date, "2026-10-02");
    assert.equal(migrated.db.prepare("SELECT count(*) AS n FROM daily_words").get().n, 0);
    const fields = migrated.db.prepare("PRAGMA table_info(daily_words)").all().map((field) => field.name);
    assert.ok(fields.includes("scripture_text"));
    assert.ok(fields.includes("scripture_version"));
    assert.ok(fields.includes("scripture_attribution"));
  } finally {
    migrated?.onModuleDestroy();
    if (oldPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("v6 daily word overrides gain nullable scripture fields without losing content", () => {
  const root = mkdtempSync(join(tmpdir(), "sai-scripture-migrate-test-"));
  const path = join(root, "legacy.sqlite");
  const oldPath = process.env.DATABASE_PATH;
  let migrated;
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT; CREATE TABLE daily_words (date TEXT PRIMARY KEY, reference TEXT NOT NULL, verse TEXT NOT NULL, question TEXT NOT NULL, reading_url TEXT) STRICT; PRAGMA user_version = 6;");
    legacy.prepare("INSERT INTO daily_words VALUES(?,?,?,?,?)").run("2026-10-02", "히브리서 13:1", "서로 사랑해요", "오늘의 질문", null);
    legacy.close();
    process.env.DATABASE_PATH = path;
    migrated = new DatabaseService();
    assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 8);
    const row = migrated.db.prepare("SELECT verse,scripture_text,scripture_version,scripture_attribution FROM daily_words WHERE date=?").get("2026-10-02");
    assert.equal(row.verse, "서로 사랑해요");
    assert.equal(row.scripture_text, null);
    assert.equal(row.scripture_version, null);
    assert.equal(row.scripture_attribution, null);
  } finally {
    migrated?.onModuleDestroy();
    if (oldPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

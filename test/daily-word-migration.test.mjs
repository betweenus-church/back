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
    legacy.exec("CREATE TABLE word_posts (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0) STRICT; PRAGMA user_version = 4;");
    legacy.prepare("INSERT INTO word_posts(member_id,text,created_at) VALUES(?,?,?)").run(1, "기존 나눔", "2026-10-01T16:00:00.000Z");
    legacy.close();

    process.env.DATABASE_PATH = path;
    migrated = new DatabaseService();
    assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 5);
    const row = migrated.db.prepare("SELECT text,daily_word_date FROM word_posts").get();
    assert.equal(row.text, "기존 나눔");
    assert.equal(row.daily_word_date, "2026-10-02");
    assert.equal(migrated.db.prepare("SELECT count(*) AS n FROM daily_words").get().n, 0);
  } finally {
    migrated?.onModuleDestroy();
    if (oldPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

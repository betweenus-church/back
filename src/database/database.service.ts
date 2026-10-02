import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor() {
    this.path = resolve(process.env.DATABASE_PATH || "./data/sai.sqlite");
    if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate() {
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 5) throw new Error(`Unsupported database version: ${version}`);
    if (version === 0) this.db.exec(`
      BEGIN;
      CREATE TABLE members (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
        church TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        role TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE word_posts (
        id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
        text TEXT NOT NULL, created_at TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE photos (
        id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
        caption TEXT NOT NULL, image_file TEXT NOT NULL, created_at TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE photo_likes (
        photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        PRIMARY KEY (photo_id, member_id)
      ) STRICT;
      CREATE TABLE photo_comments (
        id INTEGER PRIMARY KEY, photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id), text TEXT NOT NULL,
        created_at TEXT NOT NULL, edited_at TEXT, hidden INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE prayers (
        id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
        text TEXT NOT NULL, created_at TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE prayer_reactions (
        prayer_id INTEGER NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        PRIMARY KEY (prayer_id, member_id)
      ) STRICT;
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL REFERENCES members(id),
        kind TEXT NOT NULL, post_id INTEGER NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', action TEXT, resolution TEXT,
        created_at TEXT NOT NULL, handled_at TEXT
      ) STRICT;
      CREATE TABLE notices (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO settings(key,value) VALUES ('name','사이 청년부'),('intro','말씀과 일상을 나누는 청년부 공동체입니다.');
      PRAGMA user_version = 1;
      COMMIT;
    `);
    if (version <= 1) this.db.exec(`
      BEGIN;
      CREATE TABLE admin_accounts (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      ALTER TABLE sessions ADD COLUMN admin_id INTEGER REFERENCES admin_accounts(id);
      PRAGMA user_version = 2;
      COMMIT;
    `);
    if (version <= 2) this.db.exec(`
      BEGIN;
      ALTER TABLE members ADD COLUMN password_hash TEXT;
      PRAGMA user_version = 3;
      COMMIT;
    `);
    if (version <= 3) this.db.exec(`
      BEGIN;
      ALTER TABLE members ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
      PRAGMA user_version = 4;
      COMMIT;
    `);
    if (version <= 4) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
          CREATE TABLE daily_words (
            date TEXT PRIMARY KEY, reference TEXT NOT NULL, verse TEXT NOT NULL,
            question TEXT NOT NULL, reading_url TEXT
          ) STRICT;
          ALTER TABLE word_posts ADD COLUMN daily_word_date TEXT;
          UPDATE word_posts SET daily_word_date=strftime('%Y-%m-%d',created_at,'+9 hours');
          CREATE INDEX word_posts_daily_word_date_idx ON word_posts(daily_word_date,id);
        `);
        this.db.exec("PRAGMA user_version = 5; COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  onModuleDestroy() {
    this.db.close();
  }
}

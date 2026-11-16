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
    try {
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private migrate() {
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 14) throw new Error(`Unsupported database version: ${version}`);
    if (version === 0)
      this.db.exec(`
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
      ) STRzICT;
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
    if (version <= 1)
      this.db.exec(`
      BEGIN;
      CREATE TABLE admin_accounts (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      ALTER TABLE sessions ADD COLUMN admin_id INTEGER REFERENCES admin_accounts(id);
      PRAGMA user_version = 2;
      COMMIT;
    `);
    if (version <= 2)
      this.db.exec(`
      BEGIN;
      ALTER TABLE members ADD COLUMN password_hash TEXT;
      PRAGMA user_version = 3;
      COMMIT;
    `);
    if (version <= 3)
      this.db.exec(`
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
    if (version <= 5)
      this.db.exec(`
      BEGIN;
      CREATE TABLE news (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('notice','gathering','story')),
        status TEXT NOT NULL CHECK(status IN ('draft','published')),
        cover_file TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        published_at TEXT, deleted_at TEXT
      ) STRICT;
      CREATE INDEX news_member_idx ON news(status,deleted_at,published_at DESC,id DESC);
      CREATE INDEX news_admin_idx ON news(deleted_at,updated_at DESC,id DESC);
      PRAGMA user_version = 6;
      COMMIT;
    `);
    if (version <= 6)
      this.db.exec(`
      BEGIN;
      ALTER TABLE daily_words ADD COLUMN scripture_text TEXT;
      ALTER TABLE daily_words ADD COLUMN scripture_version TEXT;
      ALTER TABLE daily_words ADD COLUMN scripture_attribution TEXT;
      PRAGMA user_version = 7;
      COMMIT;
    `);
    if (version <= 7)
      this.db.exec(`
      BEGIN;
      ALTER TABLE members ADD COLUMN avatar_file TEXT;
      PRAGMA user_version = 8;
      COMMIT;
    `);
    if (version <= 8)
      this.db.exec(`
      BEGIN;
      CREATE TABLE push_subscriptions (
        id INTEGER PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX push_subscriptions_member_idx ON push_subscriptions(member_id);
      CREATE TABLE push_deliveries (
        date TEXT NOT NULL,
        subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
        PRIMARY KEY (date, subscription_id)
      ) STRICT;
      INSERT INTO settings(key,value) VALUES ('push_enabled','false'),('push_time','08:00');
      PRAGMA user_version = 9;
      COMMIT;
    `);
    if (version <= 9)
      this.db.exec(`
      BEGIN;
      CREATE TABLE inbox_items (
        id INTEGER PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('photo_comment','prayer_support','news','announcement')),
        title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL,
        created_at TEXT NOT NULL, read_at TEXT, source_id INTEGER, actor_id INTEGER
      ) STRICT;
      CREATE INDEX inbox_member_idx ON inbox_items(member_id,id DESC);
      CREATE INDEX inbox_unread_idx ON inbox_items(member_id,read_at);
      PRAGMA user_version = 10;
      COMMIT;
    `);
    if (version <= 10)
      this.db.exec(`
      BEGIN;
      CREATE TABLE word_likes (
        word_id INTEGER NOT NULL REFERENCES word_posts(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        PRIMARY KEY (word_id, member_id)
      ) STRICT;
      PRAGMA user_version = 11;
      COMMIT;
    `);
    if (version <= 11)
      this.db.exec(`
      BEGIN;
      CREATE TABLE mini_homes (
        member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
        points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
        outfit_id TEXT NOT NULL DEFAULT 'outfit-basic',
        room_id TEXT NOT NULL DEFAULT 'room-basic',
        message TEXT NOT NULL DEFAULT '작은 나눔으로 채워 가는 나의 하루'
      ) STRICT;
      CREATE TABLE mini_home_inventory (
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL, purchased_at TEXT NOT NULL,
        PRIMARY KEY(member_id,item_id)
      ) STRICT;
      CREATE TABLE point_ledger (
        id INTEGER PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL, activity TEXT, reward_date TEXT,
        description TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX point_daily_reward_idx ON point_ledger(member_id,activity,reward_date) WHERE activity IS NOT NULL;
      CREATE INDEX point_member_idx ON point_ledger(member_id,id DESC);
      PRAGMA user_version = 12;
      COMMIT;
    `);
    if (version <= 12)
      this.db.exec(`
      BEGIN;
      ALTER TABLE mini_homes ADD COLUMN wardrobe TEXT NOT NULL DEFAULT '{}';
      PRAGMA user_version = 13;
      COMMIT;
    `);
    if (version <= 13) {
      // Rebuild with monotonic IDs while preserving rows, foreign keys and indexes.
      this.db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
      try {
        for (const table of ["word_posts", "photos", "photo_comments", "prayers"]) {
          const definition = this.db
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
            .get(table) as { sql: string } | undefined;
          if (!definition) continue;
          const kind = { word_posts: "word", photos: "photo", photo_comments: "comment", prayers: "prayer" }[table];
          let highWater = Number(
            (this.db.prepare(`SELECT max(id) AS n FROM ${table}`).get() as { n: number | null }).n || 0,
          );
          if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
            highWater = Math.max(
              highWater,
              Number(
                (
                  this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table) as
                    | { seq: number }
                    | undefined
                )?.seq || 0,
              ),
            );
          }
          if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reports'").get()) {
            highWater = Math.max(
              highWater,
              Number(
                (
                  this.db.prepare("SELECT max(post_id) AS n FROM reports WHERE kind=?").get(kind!) as {
                    n: number | null;
                  }
                ).n || 0,
              ),
            );
          }
          if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbox_items'").get()) {
            const links = this.db.prepare("SELECT kind,source_id,url FROM inbox_items").all() as {
              kind: string;
              source_id: number | null;
              url: string;
            }[];
            for (const link of links) {
              if (
                (table === "photo_comments" && link.kind === "photo_comment") ||
                (table === "prayers" && link.kind === "prayer_support")
              )
                highWater = Math.max(highWater, link.source_id || 0);
              if (table === "photos") {
                const photoId = /^\/community\/photos\/(\d+)$/.exec(link.url)?.[1];
                if (photoId) highWater = Math.max(highWater, Number(photoId));
              }
            }
          }
          const indexes = this.db
            .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL")
            .all(table) as { sql: string }[];
          const temporary = `${table}_monotonic`;
          this.db.exec(
            definition.sql
              .replace(/CREATE TABLE\s+(?:"[^"]+"|\w+)/i, `CREATE TABLE ${temporary}`)
              .replace(/INTEGER PRIMARY KEY\b(?!\s+AUTOINCREMENT)/i, "INTEGER PRIMARY KEY AUTOINCREMENT"),
          );
          this.db.exec(
            `INSERT INTO ${temporary} SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${temporary} RENAME TO ${table};`,
          );
          if (!this.db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?").run(highWater, table).changes)
            this.db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)").run(table, highWater);
          for (const index of indexes) this.db.exec(index.sql);
        }
        const reportColumns = this.db.prepare("PRAGMA table_info(reports)").all() as { name: string }[];
        if (reportColumns.length && !reportColumns.some((column) => column.name === "target_created_at")) {
          this.db.exec("ALTER TABLE reports ADD COLUMN target_created_at TEXT");
        }
        // Legacy targets may already have reused an ID; never guess their identity.
        const invalid = this.db.prepare("PRAGMA foreign_key_check").all();
        if (invalid.length) throw new Error("Foreign key check failed during content ID migration");
        this.db.exec("PRAGMA user_version = 14; COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      } finally {
        this.db.exec("PRAGMA foreign_keys = ON");
      }
    }
  }

  onModuleDestroy() {
    this.db.close();
  }
}

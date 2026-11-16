import { BadRequestException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { DatabaseService } from "../database/database.service";
import { seoulDate, validDate } from "../daily-word/date";
import { DailyWordService } from "../daily-word/daily-word.service";
import { ImageUpload, optimizeImage } from "../images/optimized-upload";
import { InboxService } from "../inbox/inbox.service";

type Row = Record<string, string | number | null>;
export type Upload = ImageUpload;
function text(body: unknown, key: string, max: number) {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new BadRequestException(`${key} must be 1-${max} characters`);
  return value.trim();
}
function time(iso: string) {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "방금";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}시간 전`;
  return iso.slice(0, 10);
}
function authorAvatarUrl(row: Row) {
  return row.author_status === "approved" && typeof row.author_avatar_file === "string"
    ? `/api/auth/members/${row.member_id}/avatar?v=${encodeURIComponent(row.author_avatar_file)}`
    : null;
}
@Injectable()
export class CommunityService {
  private readonly uploadDir = resolve(process.env.UPLOAD_DIR || "./data/uploads");
  constructor(
    private readonly data: DatabaseService,
    private readonly dailyWord: DailyWordService,
    private readonly inbox: InboxService,
  ) {
    mkdirSync(this.uploadDir, { recursive: true });
  }

  private transaction<T>(action: () => T): T {
    this.data.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.data.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.data.db.exec("ROLLBACK");
      throw error;
    }
  }

  noticeById(id: number) {
    const notice = this.data.db
      .prepare("SELECT id,title,body,pinned,created_at AS createdAt FROM notices WHERE id=? AND status='published'")
      .get(id);
    if (!notice) throw new NotFoundException("Notice not found");
    return notice;
  }

  snapshot(memberId: number) {
    const db = this.data.db;
    db.prepare(
      "UPDATE notices SET status='published',scheduled_at=NULL,updated_at=? WHERE status='scheduled' AND scheduled_at<=?",
    ).run(new Date().toISOString(), new Date().toISOString());
    const notices = db
      .prepare(
        "SELECT id,title,body,pinned,created_at AS createdAt FROM notices WHERE status='published' ORDER BY pinned DESC,id DESC LIMIT 20",
      )
      .all();
    const words = db
      .prepare(
        `SELECT w.*,m.name AS author,m.avatar_file AS author_avatar_file,m.status AS author_status,
                (SELECT count(*) FROM word_likes l WHERE l.word_id=w.id) AS likes,
                EXISTS(SELECT 1 FROM word_likes l WHERE l.word_id=w.id AND l.member_id=?) AS liked
                FROM word_posts w JOIN members m ON m.id=w.member_id WHERE w.hidden=0 ORDER BY w.id DESC LIMIT 100`,
      )
      .all(memberId) as Row[];
    const photos = db
      .prepare(
        `SELECT p.*,m.name AS author,m.avatar_file AS author_avatar_file,m.status AS author_status,
      (SELECT count(*) FROM photo_likes l WHERE l.photo_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM photo_likes l WHERE l.photo_id=p.id AND l.member_id=?) AS liked
      FROM photos p JOIN members m ON m.id=p.member_id WHERE p.hidden=0 ORDER BY p.id DESC LIMIT 100`,
      )
      .all(memberId) as Row[];
    const prayers = db
      .prepare(
        `SELECT p.*,
      (SELECT count(*) FROM prayer_reactions r WHERE r.prayer_id=p.id) AS prayers,
      EXISTS(SELECT 1 FROM prayer_reactions r WHERE r.prayer_id=p.id AND r.member_id=?) AS prayed
      FROM prayers p WHERE p.hidden=0 ORDER BY p.id DESC LIMIT 100`,
      )
      .all(memberId) as Row[];
    return {
      notices,
      wordPosts: words.map((row) => ({
        id: row.id,
        author: row.author,
        authorId: row.author_status === "approved" ? row.member_id : null,
        authorAvatarUrl: authorAvatarUrl(row),
        text: row.text,
        time: time(String(row.created_at)),
        date: row.daily_word_date,
        mine: row.member_id === memberId,
        likes: row.likes,
        liked: Boolean(row.liked),
      })),
      photos: photos.map((row) => this.photo(row, memberId)),
      prayers: prayers.map((row) => ({
        id: row.id,
        text: row.text,
        time: time(String(row.created_at)),
        prayers: row.prayers,
        prayed: Boolean(row.prayed),
        mine: row.member_id === memberId,
      })),
    };
  }

  private photo(row: Row, memberId: number) {
    const comments = this.data.db
      .prepare(
        "SELECT c.*,m.name AS author,m.avatar_file AS author_avatar_file,m.status AS author_status FROM photo_comments c JOIN members m ON m.id=c.member_id WHERE c.photo_id=? AND c.hidden=0 ORDER BY c.id",
      )
      .all(row.id as number) as Row[];
    return {
      id: row.id,
      caption: row.caption,
      time: time(String(row.created_at)),
      tone: "leaf",
      mine: row.member_id === memberId,
      author: row.author,
      authorId: row.author_status === "approved" ? row.member_id : null,
      authorAvatarUrl: authorAvatarUrl(row),
      imageUrl: `/api/photos/${row.id}/image`,
      thumbnailUrl: `/api/photos/${row.id}/image?size=thumb`,
      likes: row.likes,
      liked: Boolean(row.liked),
      comments: comments.map((c) => ({
        id: c.id,
        author: c.author,
        authorId: c.author_status === "approved" ? c.member_id : null,
        authorAvatarUrl: authorAvatarUrl(c),
        text: c.text,
        time: time(String(c.created_at)),
        mine: c.member_id === memberId,
        edited: Boolean(c.edited_at),
      })),
    };
  }

  photoById(id: number, memberId: number) {
    const row = this.data.db
      .prepare(
        `SELECT p.*,m.name AS author,m.avatar_file AS author_avatar_file,m.status AS author_status,
      (SELECT count(*) FROM photo_likes l WHERE l.photo_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM photo_likes l WHERE l.photo_id=p.id AND l.member_id=?) AS liked
      FROM photos p JOIN members m ON m.id=p.member_id WHERE p.id=? AND p.hidden=0`,
      )
      .get(memberId, id) as Row | undefined;
    if (!row) throw new NotFoundException("Photo not found");
    return this.photo(row, memberId);
  }

  addWord(memberId: number, body: unknown) {
    const content = text(body, "text", 500);
    const suppliedDate = (body as Record<string, unknown> | null)?.date;
    const date = suppliedDate === undefined ? seoulDate() : validDate(suppliedDate);
    this.dailyWord.get(date);
    return this.transaction(() => {
      const id = Number(
        this.data.db
          .prepare("INSERT INTO word_posts(member_id,text,created_at,daily_word_date) VALUES(?,?,?,?)")
          .run(memberId, content, new Date().toISOString(), date).lastInsertRowid,
      );
      return { id, date };
    });
  }
  words(memberId: number, date?: string) {
    const target = date === undefined ? seoulDate() : validDate(date);
    const rows = this.data.db
      .prepare(
        `SELECT w.id,w.member_id,w.text,w.created_at,w.daily_word_date,m.name AS author,m.avatar_file AS author_avatar_file,m.status AS author_status,
            (SELECT count(*) FROM word_likes l WHERE l.word_id=w.id) AS likes,
            EXISTS(SELECT 1 FROM word_likes l WHERE l.word_id=w.id AND l.member_id=?) AS liked
            FROM word_posts w JOIN members m ON m.id=w.member_id WHERE w.hidden=0 AND w.daily_word_date=? ORDER BY w.id DESC LIMIT 100`,
      )
      .all(memberId, target) as Row[];
    return rows.map((row) => ({
      id: row.id,
      author: row.author,
      authorId: row.author_status === "approved" ? row.member_id : null,
      authorAvatarUrl: authorAvatarUrl(row),
      text: row.text,
      time: time(String(row.created_at)),
      date: row.daily_word_date,
      mine: row.member_id === memberId,
      likes: row.likes,
      liked: Boolean(row.liked),
    }));
  }
  likeWord(memberId: number, id: number) {
    return this.transaction(() => {
      const db = this.data.db;
      if (!db.prepare("SELECT id FROM word_posts WHERE id=? AND hidden=0").get(id))
        throw new NotFoundException("Word not found");
      const removed = db.prepare("DELETE FROM word_likes WHERE word_id=? AND member_id=?").run(id, memberId);
      if (!removed.changes) db.prepare("INSERT INTO word_likes(word_id,member_id) VALUES(?,?)").run(id, memberId);
      const row = db.prepare("SELECT count(*) AS likes FROM word_likes WHERE word_id=?").get(id) as { likes: number };
      return { liked: !removed.changes, likes: row.likes };
    });
  }
  deleteWord(memberId: number, id: number) {
    const result = this.data.db.prepare("DELETE FROM word_posts WHERE id=? AND member_id=?").run(id, memberId);
    if (!result.changes) throw new NotFoundException();
    return { ok: true };
  }
  async addPhoto(memberId: number, body: unknown, file?: Upload) {
    if (!file || file.size > 10 * 1024 * 1024) throw new BadRequestException("Image must be 10 MB or smaller");
    const caption = text(body, "caption", 120);
    const form = body as Record<string, unknown>;
    if (form.peopleConsent !== "true" || form.locationConsent !== "true")
      throw new BadRequestException("Photo sharing consent is required");
    const optimized = await optimizeImage(file);
    const filename = `${randomUUID()}.${optimized.ext}`;
    writeFileSync(resolve(this.uploadDir, filename), optimized.buffer, { flag: "wx" });
    try {
      return this.transaction(() => {
        const id = Number(
          this.data.db
            .prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(?,?,?,?)")
            .run(memberId, caption, filename, new Date().toISOString()).lastInsertRowid,
        );
        return this.photoById(id, memberId);
      });
    } catch (error) {
      unlinkSync(resolve(this.uploadDir, filename));
      throw error;
    }
  }
  async photoImage(id: number, thumbnail = false) {
    const row = this.data.db.prepare("SELECT image_file FROM photos WHERE id=? AND hidden=0").get(id) as
      { image_file: string } | undefined;
    if (!row) throw new NotFoundException();
    const extension = row.image_file.split(".").pop();
    const type = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    if (!thumbnail)
      return new StreamableFile(await readFile(resolve(this.uploadDir, row.image_file)), {
        type,
        disposition: "inline",
      });
    const directory = resolve(this.uploadDir, ".thumbnails");
    const path = resolve(directory, `${row.image_file}.webp`);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const original = await readFile(resolve(this.uploadDir, row.image_file));
      bytes = (await optimizeImage({ buffer: original, size: original.length, mimetype: type }, 480, false, 40 * 1024))
        .buffer;
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(path, bytes, { flag: "wx" });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      }
    }
    return new StreamableFile(bytes, { type: "image/webp", disposition: "inline" });
  }
  deletePhoto(memberId: number, id: number) {
    const row = this.data.db.prepare("SELECT image_file FROM photos WHERE id=? AND member_id=?").get(id, memberId) as
      { image_file: string } | undefined;
    if (!row) throw new NotFoundException();
    this.data.db.prepare("DELETE FROM photos WHERE id=? AND member_id=?").run(id, memberId);
    try {
      unlinkSync(resolve(this.uploadDir, row.image_file));
    } catch {
      /* A missing file cannot restore a deleted row. */
    }
    void unlink(resolve(this.uploadDir, ".thumbnails", `${row.image_file}.webp`)).catch(() => {});
    return { ok: true };
  }
  likePhoto(memberId: number, id: number) {
    return this.transaction(() => {
      this.photoById(id, memberId);
      const db = this.data.db;
      const removed = db.prepare("DELETE FROM photo_likes WHERE photo_id=? AND member_id=?").run(id, memberId);
      if (!removed.changes) db.prepare("INSERT INTO photo_likes(photo_id,member_id) VALUES(?,?)").run(id, memberId);
      return this.photoById(id, memberId);
    });
  }
  addComment(memberId: number, photoId: number, body: unknown) {
    return this.transaction(() => {
      this.photoById(photoId, memberId);
      const content = text(body, "text", 200);
      const id = Number(
        this.data.db
          .prepare("INSERT INTO photo_comments(photo_id,member_id,text,created_at) VALUES(?,?,?,?)")
          .run(photoId, memberId, content, new Date().toISOString()).lastInsertRowid,
      );
      this.inbox.photoComment(photoId, id, memberId, content);
      return { id };
    });
  }
  editComment(memberId: number, photoId: number, id: number, body: unknown) {
    const content = text(body, "text", 200);
    const result = this.data.db
      .prepare("UPDATE photo_comments SET text=?,edited_at=? WHERE id=? AND photo_id=? AND member_id=? AND hidden=0")
      .run(content, new Date().toISOString(), id, photoId, memberId);
    if (!result.changes) throw new NotFoundException();
    return { ok: true };
  }
  deleteComment(memberId: number, photoId: number, id: number) {
    const result = this.data.db
      .prepare("DELETE FROM photo_comments WHERE id=? AND photo_id=? AND member_id=?")
      .run(id, photoId, memberId);
    if (!result.changes) throw new NotFoundException();
    return { ok: true };
  }
  addPrayer(memberId: number, body: unknown) {
    const content = text(body, "text", 1000);
    return this.transaction(() => {
      const id = Number(
        this.data.db
          .prepare("INSERT INTO prayers(member_id,text,created_at) VALUES(?,?,?)")
          .run(memberId, content, new Date().toISOString()).lastInsertRowid,
      );
      return { id };
    });
  }
  deletePrayer(memberId: number, id: number) {
    const result = this.data.db.prepare("DELETE FROM prayers WHERE id=? AND member_id=?").run(id, memberId);
    if (!result.changes) throw new NotFoundException();
    return { ok: true };
  }
  pray(memberId: number, id: number) {
    const exists = this.data.db.prepare("SELECT id FROM prayers WHERE id=? AND hidden=0").get(id);
    if (!exists) throw new NotFoundException();
    const removed = this.data.db
      .prepare("DELETE FROM prayer_reactions WHERE prayer_id=? AND member_id=?")
      .run(id, memberId);
    if (removed.changes) this.inbox.prayerSupportCancelled(id, memberId);
    if (!removed.changes) {
      this.data.db.prepare("INSERT INTO prayer_reactions(prayer_id,member_id) VALUES(?,?)").run(id, memberId);
      this.inbox.prayerSupport(id, memberId);
    }
    return { prayed: !removed.changes };
  }
  report(memberId: number, body: unknown) {
    const kind = (body as Record<string, unknown>)?.kind;
    const postId = (body as Record<string, unknown>)?.postId;
    if (
      !(["photo", "word", "prayer", "comment"] as unknown[]).includes(kind) ||
      !Number.isSafeInteger(postId) ||
      Number(postId) <= 0
    )
      throw new BadRequestException("Invalid report target");
    const table = { photo: "photos", word: "word_posts", prayer: "prayers", comment: "photo_comments" }[
      String(kind) as "photo" | "word" | "prayer" | "comment"
    ];
    const target = this.data.db
      .prepare(`SELECT created_at FROM ${table} WHERE id=? AND hidden=0`)
      .get(postId as number) as { created_at: string } | undefined;
    if (!target) throw new NotFoundException();
    const reason = text(body, "reason", 500);
    if (/^기타\s*:?\s*$/.test(reason)) throw new BadRequestException("기타 신고 내용을 입력해 주세요");
    const id = Number(
      this.data.db
        .prepare(
          "INSERT INTO reports(reporter_id,kind,post_id,reason,created_at,target_created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(memberId, kind as string, postId as number, reason, new Date().toISOString(), target.created_at)
        .lastInsertRowid,
    );
    return { id, status: "pending" };
  }
}

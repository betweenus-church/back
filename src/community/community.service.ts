import { BadRequestException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseService } from "../database/database.service";
import { seoulDate, validDate } from "../daily-word/date";
import { DailyWordService } from "../daily-word/daily-word.service";

type Row = Record<string, string | number | null>;
export type Upload = { buffer: Buffer; size: number; mimetype: string };
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
function imageType(buffer: Buffer) {
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
        return { type: "image/jpeg", ext: "jpg" };
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return { type: "image/png", ext: "png" };
    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
        return { type: "image/webp", ext: "webp" };
    throw new BadRequestException("Only JPEG, PNG and WebP images are supported");
}

@Injectable()
export class CommunityService {
    private readonly uploadDir = resolve(process.env.UPLOAD_DIR || "./data/uploads");
    constructor(private readonly data: DatabaseService, private readonly dailyWord: DailyWordService) {
        mkdirSync(this.uploadDir, { recursive: true });
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
                "SELECT w.*,m.name AS author FROM word_posts w JOIN members m ON m.id=w.member_id WHERE w.hidden=0 ORDER BY w.id DESC LIMIT 100",
            )
            .all() as Row[];
        const photos = db
            .prepare(
                `SELECT p.*,m.name AS author,
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
                text: row.text,
                time: time(String(row.created_at)),
                date: row.daily_word_date,
                mine: row.member_id === memberId,
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
                "SELECT c.*,m.name AS author FROM photo_comments c JOIN members m ON m.id=c.member_id WHERE c.photo_id=? AND c.hidden=0 ORDER BY c.id",
            )
            .all(row.id as number) as Row[];
        return {
            id: row.id,
            caption: row.caption,
            time: time(String(row.created_at)),
            tone: "leaf",
            mine: row.member_id === memberId,
            author: row.author,
            imageUrl: `/api/photos/${row.id}/image`,
            likes: row.likes,
            liked: Boolean(row.liked),
            comments: comments.map((c) => ({
                id: c.id,
                author: c.author,
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
                `SELECT p.*,m.name AS author,
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
        const id = Number(
            this.data.db
                .prepare("INSERT INTO word_posts(member_id,text,created_at,daily_word_date) VALUES(?,?,?,?)")
                .run(memberId, content, new Date().toISOString(), date).lastInsertRowid,
        );
        return { id, date };
    }
    words(memberId: number, date?: string) {
        const target = date === undefined ? seoulDate() : validDate(date);
        const rows = this.data.db.prepare(
            "SELECT w.id,w.member_id,w.text,w.created_at,w.daily_word_date,m.name AS author FROM word_posts w JOIN members m ON m.id=w.member_id WHERE w.hidden=0 AND w.daily_word_date=? ORDER BY w.id DESC LIMIT 100",
        ).all(target) as Row[];
        return rows.map((row) => ({
            id: row.id, author: row.author, text: row.text,
            time: time(String(row.created_at)), date: row.daily_word_date,
            mine: row.member_id === memberId,
        }));
    }
    deleteWord(memberId: number, id: number) {
        const result = this.data.db.prepare("DELETE FROM word_posts WHERE id=? AND member_id=?").run(id, memberId);
        if (!result.changes) throw new NotFoundException();
        return { ok: true };
    }
    addPhoto(memberId: number, body: unknown, file?: Upload) {
        if (!file || file.size > 10 * 1024 * 1024) throw new BadRequestException("Image must be 10 MB or smaller");
        const caption = text(body, "caption", 120);
        const form = body as Record<string, unknown>;
        if (form.peopleConsent !== "true" || form.locationConsent !== "true")
            throw new BadRequestException("Photo sharing consent is required");
        const kind = imageType(file.buffer);
        const filename = `${randomUUID()}.${kind.ext}`;
        writeFileSync(resolve(this.uploadDir, filename), file.buffer, { flag: "wx" });
        try {
            const id = Number(
                this.data.db
                    .prepare("INSERT INTO photos(member_id,caption,image_file,created_at) VALUES(?,?,?,?)")
                    .run(memberId, caption, filename, new Date().toISOString()).lastInsertRowid,
            );
            return this.photoById(id, memberId);
        } catch (error) {
            unlinkSync(resolve(this.uploadDir, filename));
            throw error;
        }
    }
    photoImage(id: number) {
        const row = this.data.db.prepare("SELECT image_file FROM photos WHERE id=? AND hidden=0").get(id) as
            | { image_file: string }
            | undefined;
        if (!row) throw new NotFoundException();
        const extension = row.image_file.split(".").pop();
        const type = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        return new StreamableFile(readFileSync(resolve(this.uploadDir, row.image_file)), {
            type,
            disposition: "inline",
        });
    }
    deletePhoto(memberId: number, id: number) {
        const row = this.data.db
            .prepare("SELECT image_file FROM photos WHERE id=? AND member_id=?")
            .get(id, memberId) as { image_file: string } | undefined;
        if (!row) throw new NotFoundException();
        this.data.db.prepare("DELETE FROM photos WHERE id=? AND member_id=?").run(id, memberId);
        try {
            unlinkSync(resolve(this.uploadDir, row.image_file));
        } catch {
            /* A missing file cannot restore a deleted row. */
        }
        return { ok: true };
    }
    likePhoto(memberId: number, id: number) {
        this.photoById(id, memberId);
        const db = this.data.db;
        const removed = db.prepare("DELETE FROM photo_likes WHERE photo_id=? AND member_id=?").run(id, memberId);
        if (!removed.changes) db.prepare("INSERT INTO photo_likes(photo_id,member_id) VALUES(?,?)").run(id, memberId);
        return this.photoById(id, memberId);
    }
    addComment(memberId: number, photoId: number, body: unknown) {
        this.photoById(photoId, memberId);
        const content = text(body, "text", 200);
        const id = Number(
            this.data.db
                .prepare("INSERT INTO photo_comments(photo_id,member_id,text,created_at) VALUES(?,?,?,?)")
                .run(photoId, memberId, content, new Date().toISOString()).lastInsertRowid,
        );
        return { id };
    }
    editComment(memberId: number, photoId: number, id: number, body: unknown) {
        const content = text(body, "text", 200);
        const result = this.data.db
            .prepare(
                "UPDATE photo_comments SET text=?,edited_at=? WHERE id=? AND photo_id=? AND member_id=? AND hidden=0",
            )
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
        const id = Number(
            this.data.db
                .prepare("INSERT INTO prayers(member_id,text,created_at) VALUES(?,?,?)")
                .run(memberId, content, new Date().toISOString()).lastInsertRowid,
        );
        return { id };
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
        if (!removed.changes)
            this.data.db.prepare("INSERT INTO prayer_reactions(prayer_id,member_id) VALUES(?,?)").run(id, memberId);
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
        if (!this.data.db.prepare(`SELECT id FROM ${table} WHERE id=? AND hidden=0`).get(postId as number))
            throw new NotFoundException();
        const reason = text(body, "reason", 500);
        const id = Number(
            this.data.db
                .prepare("INSERT INTO reports(reporter_id,kind,post_id,reason,created_at) VALUES(?,?,?,?,?)")
                .run(memberId, kind as string, postId as number, reason, new Date().toISOString()).lastInsertRowid,
        );
        return { id, status: "pending" };
    }
}

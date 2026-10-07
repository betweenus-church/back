import { BadRequestException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseService } from "../database/database.service";
import { ImageUpload, optimizeImage } from "../images/optimized-upload";
import { InboxService } from "../inbox/inbox.service";

export type NewsUpload = ImageUpload;
type NewsRow = {
  id: number; title: string; body: string; category: "notice" | "gathering" | "story";
  status: "draft" | "published"; cover_file: string | null;
  created_at: string; updated_at: string; published_at: string | null; deleted_at: string | null;
};
type NewsInput = Pick<NewsRow, "title" | "body" | "category" | "status">;
const categories = ["notice", "gathering", "story"];
const statuses = ["draft", "published"];

function fields(body: unknown, previous?: NewsRow): NewsInput & { removeCover: boolean } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const checked = (name: "title" | "body", max: number) => {
    const value = input[name] ?? previous?.[name];
    if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max)
      throw new BadRequestException(`${name} must be 1-${max} characters`);
    return value.trim();
  };
  const category = input.category ?? previous?.category;
  const status = input.status ?? previous?.status;
  if (typeof category !== "string" || !categories.includes(category)) throw new BadRequestException("Invalid news category");
  if (typeof status !== "string" || !statuses.includes(status)) throw new BadRequestException("Invalid news status");
  const remove = input.removeCover;
  if (remove !== undefined && remove !== "true" && remove !== "false" && remove !== true && remove !== false)
    throw new BadRequestException("Invalid removeCover value");
  return { title: checked("title", 80), body: checked("body", 5000), category: category as NewsInput["category"], status: status as NewsInput["status"], removeCover: remove === "true" || remove === true };
}

@Injectable()
export class NewsService {
  private readonly coverDir = resolve(process.env.UPLOAD_DIR || "./data/uploads", "news");
  constructor(private readonly data: DatabaseService, private readonly inbox: InboxService) { mkdirSync(this.coverDir, { recursive: true }); }

  private row(id: number, published: boolean) {
    const row = this.data.db.prepare(`SELECT * FROM news WHERE id=? AND deleted_at IS NULL${published ? " AND status='published'" : ""}`).get(id) as NewsRow | undefined;
    if (!row) throw new NotFoundException("News not found");
    return row;
  }
  private result(row: NewsRow, admin: boolean) {
    return {
      id: row.id, title: row.title, body: row.body, category: row.category, status: row.status,
      coverUrl: row.cover_file ? `/api/${admin ? "admin/" : ""}news/${row.id}/cover` : null,
      createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at,
    };
  }
  private list(admin: boolean, category?: string) {
    if (category !== undefined && !categories.includes(category)) throw new BadRequestException("Invalid news category");
    const where = admin ? "deleted_at IS NULL" : "deleted_at IS NULL AND status='published'";
    const rows = this.data.db.prepare(`SELECT * FROM news WHERE ${where}${category ? " AND category=?" : ""} ORDER BY ${admin ? "updated_at" : "published_at"} DESC,id DESC`).all(...(category ? [category] : [])) as NewsRow[];
    return rows.map((row) => ({ ...this.result(row, admin), excerpt: row.body.slice(0, 140) }));
  }
  memberList(category?: string) { return this.list(false, category); }
  memberDetail(id: number) { return this.result(this.row(id, true), false); }
  adminList() { return this.list(true); }
  adminDetail(id: number) { return this.result(this.row(id, false), true); }

  private async store(file?: NewsUpload) {
    if (!file) return null;
    const optimized = await optimizeImage(file);
    const filename = `${randomUUID()}.${optimized.ext}`;
    writeFileSync(resolve(this.coverDir, filename), optimized.buffer, { flag: "wx" });
    return filename;
  }
  private remove(filename: string | null) {
    if (!filename) return;
    try { unlinkSync(resolve(this.coverDir, filename)); } catch { /* Database state takes precedence over stale files. */ }
  }
  async create(body: unknown, cover?: NewsUpload) {
    const input = fields(body);
    if (input.removeCover && cover) throw new BadRequestException("Cannot upload and remove a cover together");
    const filename = await this.store(cover);
    const now = new Date().toISOString();
    try {
      const id = Number(this.data.db.prepare("INSERT INTO news(title,body,category,status,cover_file,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(input.title, input.body, input.category, input.status, filename, now, now, input.status === "published" ? now : null).lastInsertRowid);
      if (input.status === "published") this.inbox.broadcast("news", "새 교회 소식", input.title, `/community/news/${id}`, id);
      return this.adminDetail(id);
    } catch (error) { this.remove(filename); throw error; }
  }
  async update(id: number, body: unknown, cover?: NewsUpload) {
    const previous = this.row(id, false);
    const input = fields(body, previous);
    if (input.removeCover && cover) throw new BadRequestException("Cannot upload and remove a cover together");
    const filename = await this.store(cover);
    const nextCover = input.removeCover ? null : filename ?? previous.cover_file;
    const now = new Date().toISOString();
    const publishedAt = input.status === "draft" ? null : previous.status === "published" ? previous.published_at : now;
    try {
      this.data.db.prepare("UPDATE news SET title=?,body=?,category=?,status=?,cover_file=?,updated_at=?,published_at=? WHERE id=? AND deleted_at IS NULL")
        .run(input.title, input.body, input.category, input.status, nextCover, now, publishedAt, id);
      if (previous.status !== "published" && input.status === "published") this.inbox.broadcast("news", "새 교회 소식", input.title, `/community/news/${id}`, id);
      if (previous.cover_file !== nextCover) this.remove(previous.cover_file);
      return this.adminDetail(id);
    } catch (error) { this.remove(filename); throw error; }
  }
  delete(id: number) {
    const result = this.data.db.prepare("UPDATE news SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL")
      .run(new Date().toISOString(), new Date().toISOString(), id);
    if (!result.changes) throw new NotFoundException("News not found");
    return { ok: true };
  }
  cover(id: number, admin: boolean) {
    const row = this.row(id, !admin);
    if (!row.cover_file) throw new NotFoundException("Cover not found");
    const path = resolve(this.coverDir, row.cover_file);
    if (!existsSync(path)) throw new NotFoundException("Cover not found");
    const type = row.cover_file.endsWith(".png") ? "image/png" : row.cover_file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return new StreamableFile(readFileSync(path), { type, disposition: "inline" });
  }
}

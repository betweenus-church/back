import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, StreamableFile } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { passwordHash } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { InboxService } from "../inbox/inbox.service";
import { PushService } from "../push/push.service";

type Row = Record<string, string | number | null>;
function stringField(body: unknown, key: string, max: number) {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new BadRequestException(`${key} must be 1-${max} characters`);
  return value.trim();
}
function formatPhone(phone: string) { return phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3"); }

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(private readonly data: DatabaseService, private readonly inbox: InboxService, private readonly push: PushService) {}
  dashboard() {
    const db = this.data.db;
    return {
      pendingApprovals: (db.prepare("SELECT count(*) AS n FROM members WHERE status='pending'").get() as { n: number }).n,
      pendingReports: (db.prepare("SELECT count(*) AS n FROM reports WHERE status='pending'").get() as { n: number }).n,
      members: (db.prepare("SELECT count(*) AS n FROM members WHERE status='approved'").get() as { n: number }).n,
      recentRequests: this.approvals().slice(0, 5),
    };
  }
  approvals() {
    const rows = this.data.db.prepare("SELECT * FROM members ORDER BY id DESC").all() as Row[];
    return rows.map((row) => ({ id: row.id, name: row.name, church: row.church, phone: formatPhone(String(row.phone)), requestedAt: row.created_at, status: row.status, reason: row.reason }));
  }
  decision(id: number, status: "approved" | "rejected", body: unknown) {
    const reason = status === "rejected" ? stringField(body, "reason", 500) : null;
    const result = this.data.db.prepare("UPDATE members SET status=?,reason=?,updated_at=? WHERE id=? AND status='pending'").run(status, reason, new Date().toISOString(), id);
    if (!result.changes) throw new NotFoundException("Pending request not found");
    return { id, status };
  }
  members() {
    const rows = this.data.db.prepare("SELECT * FROM members WHERE status IN ('approved','suspended') ORDER BY id DESC").all() as Row[];
    return rows.map((row) => ({ id: row.id, name: row.name, phone: formatPhone(String(row.phone)), church: row.church, status: row.status, joined: row.created_at, restrictionReason: row.reason }));
  }
  updateMember(id: number, body: unknown) {
    const name = stringField(body, "name", 30);
    const church = stringField(body, "church", 60);
    const phone = stringField(body, "phone", 13).replace(/\D/g, "");
    if (!/^01[016789]\d{7,8}$/.test(phone)) throw new BadRequestException("Invalid phone number");
    if (church.replace(/\s/g, "") !== process.env.CHURCH_NAME!.replace(/\s/g, "")) throw new BadRequestException("Unknown church");
    try {
      const result = this.data.db.prepare("UPDATE members SET name=?,phone=?,church=?,updated_at=? WHERE id=? AND status IN ('approved','suspended')").run(name, phone, church, new Date().toISOString(), id);
      if (!result.changes) throw new NotFoundException();
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ConflictException("Phone number already used");
      throw error;
    }
    return { id, name, phone: formatPhone(phone), church };
  }
  memberStatus(id: number, body: unknown) {
    const status = (body as Record<string, unknown>)?.status;
    if (status !== "approved" && status !== "suspended") throw new BadRequestException("status must be approved or suspended");
    const reason = status === "suspended" ? stringField(body, "reason", 500) : null;
    const result = this.data.db.prepare("UPDATE members SET status=?,reason=?,updated_at=? WHERE id=? AND status IN ('approved','suspended')").run(status, reason, new Date().toISOString(), id);
    if (!result.changes) throw new NotFoundException();
    return { id, status };
  }
  resetMemberPassword(id: number) {
    const db = this.data.db;
    const member = db.prepare("SELECT id FROM members WHERE id=? AND status IN ('approved','suspended')").get(id);
    if (!member) throw new NotFoundException();
    const password = randomBytes(18).toString("base64url");
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE members SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?").run(passwordHash(password), new Date().toISOString(), id);
      db.prepare("DELETE FROM sessions WHERE member_id=?").run(id);
      db.prepare("DELETE FROM push_subscriptions WHERE member_id=?").run(id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { password };
  }
  reports() {
    return this.data.db.prepare(`SELECT r.id,r.kind,r.post_id AS postId,r.reason,r.status,r.action,r.resolution,r.created_at AS createdAt,r.handled_at AS handledAt,
      CASE r.kind WHEN 'photo' THEN (SELECT caption FROM photos WHERE id=r.post_id)
        WHEN 'word' THEN (SELECT text FROM word_posts WHERE id=r.post_id)
        WHEN 'prayer' THEN (SELECT text FROM prayers WHERE id=r.post_id)
        WHEN 'comment' THEN (SELECT text FROM photo_comments WHERE id=r.post_id) END AS excerpt,
      m.name AS reporter FROM reports r JOIN members m ON m.id=r.reporter_id ORDER BY r.id DESC`).all();
  }
  reportImage(id: number) {
    const row = this.data.db.prepare(`SELECT p.image_file AS imageFile FROM reports r
      LEFT JOIN photo_comments c ON r.kind='comment' AND c.id=r.post_id
      JOIN photos p ON p.id=CASE WHEN r.kind='photo' THEN r.post_id ELSE c.photo_id END
      WHERE r.id=? AND r.kind IN ('photo','comment')`).get(id) as { imageFile: string } | undefined;
    if (!row || basename(row.imageFile) !== row.imageFile) throw new NotFoundException("Reported photo not found");
    let bytes: Buffer;
    try { bytes = readFileSync(resolve(process.env.UPLOAD_DIR || "./data/uploads", row.imageFile)); }
    catch { throw new NotFoundException("Reported photo not found"); }
    const extension = row.imageFile.split(".").pop();
    return new StreamableFile(bytes, {
      type: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
      disposition: "inline",
    });
  }
  async resolveReport(id: number, body: unknown) {
    const action = (body as Record<string, unknown>)?.action;
    if (!["dismiss", "hide", "delete"].includes(String(action))) throw new BadRequestException("Invalid action");
    const resolution = stringField(body, "resolution", 500);
    const db = this.data.db;
    const row = db.prepare("SELECT kind,post_id,status FROM reports WHERE id=?").get(id) as { kind: string; post_id: number; status: string } | undefined;
    if (!row || row.status !== "pending") throw new NotFoundException("Pending report not found");
    const table = { photo: "photos", word: "word_posts", prayer: "prayers", comment: "photo_comments" }[row.kind];
    if (!table) throw new BadRequestException("Unknown report kind");
    const owner = db.prepare(`SELECT member_id,hidden FROM ${table} WHERE id=?`).get(row.post_id) as { member_id: number; hidden: number } | undefined;
    let notification: { title: string; body: string; url: string } | null = null;
    db.exec("BEGIN");
    try {
      if (action !== "dismiss") db.prepare(`UPDATE ${table} SET hidden=1 WHERE id=?`).run(row.post_id);
      db.prepare("UPDATE reports SET status='resolved',action=?,resolution=?,handled_at=? WHERE id=?").run(action as string, resolution, new Date().toISOString(), id);
      if (action === "delete" && owner && !owner.hidden) {
        notification = this.inbox.moderationRemoved(owner.member_id, row.kind as "photo" | "word" | "prayer" | "comment", resolution, id);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    if (notification && owner) {
      try { await this.push.sendToMember(owner.member_id, notification.title, notification.body, notification.url); }
      catch (error) { this.logger.warn(`Moderation push failed after report ${id}: ${String(error)}`); }
    }
    return { id, status: "resolved", action };
  }
  settings() {
    const rows = this.data.db.prepare("SELECT key,value FROM settings").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }
  updateSettings(body: unknown) {
    const name = stringField(body, "name", 60);
    const intro = stringField(body, "intro", 500);
    const db = this.data.db;
    db.prepare("UPDATE settings SET value=? WHERE key='name'").run(name);
    db.prepare("UPDATE settings SET value=? WHERE key='intro'").run(intro);
    return { name, intro };
  }
  accounts() {
    const rows = this.data.db.prepare("SELECT id,name,account FROM admin_accounts ORDER BY id").all();
    return [{ id: 0, name: "주 운영자", account: "root" }, ...rows];
  }
  createAccount(body: unknown) {
    const name = stringField(body, "name", 30);
    const account = stringField(body, "account", 20);
    const password = stringField(body, "password", 128);
    if (!/^[a-zA-Z0-9_]{4,20}$/.test(account) || account === "root") throw new BadRequestException("Invalid account");
    if (password.length < 12) throw new BadRequestException("Password must have at least 12 characters");
    try {
      const result = this.data.db.prepare("INSERT INTO admin_accounts(name,account,password_hash,created_at) VALUES(?,?,?,?)").run(name, account, passwordHash(password), new Date().toISOString());
      return { id: Number(result.lastInsertRowid), name, account };
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ConflictException("Account already exists");
      throw error;
    }
  }
  deleteAccount(id: number) {
    if (!id) throw new BadRequestException("Owner account cannot be removed");
    const db = this.data.db;
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM sessions WHERE admin_id=?").run(id);
      const result = db.prepare("DELETE FROM admin_accounts WHERE id=?").run(id);
      if (!result.changes) throw new NotFoundException();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { ok: true };
  }
  notices() { return this.data.db.prepare("SELECT * FROM notices ORDER BY pinned DESC,id DESC").all(); }
  notice(id: number) {
    const row = this.data.db.prepare("SELECT * FROM notices WHERE id=?").get(id);
    if (!row) throw new NotFoundException();
    return row;
  }
  createNotice(body: unknown) {
    const title = stringField(body, "title", 100);
    const content = stringField(body, "body", 5000);
    const status = (body as Record<string, unknown>)?.status;
    if (status !== "draft" && status !== "published" && status !== "scheduled") throw new BadRequestException("Invalid notice status");
    const scheduledAt = status === "scheduled" ? stringField(body, "scheduledAt", 40) : null;
    if (scheduledAt && (Number.isNaN(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) throw new BadRequestException("Invalid schedule");
    const now = new Date().toISOString();
    const id = Number(this.data.db.prepare("INSERT INTO notices(title,body,status,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(title, content, status, scheduledAt, now, now).lastInsertRowid);
    return this.notice(id);
  }
  updateNotice(id: number, body: unknown) {
    this.notice(id);
    const title = stringField(body, "title", 100);
    const content = stringField(body, "body", 5000);
    const status = (body as Record<string, unknown>)?.status;
    if (!["draft", "published", "scheduled", "ended"].includes(String(status))) throw new BadRequestException("Invalid notice status");
    const pinned = (body as Record<string, unknown>)?.pinned === true ? 1 : 0;
    const scheduledAt = status === "scheduled" ? stringField(body, "scheduledAt", 40) : null;
    if (scheduledAt && (Number.isNaN(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) throw new BadRequestException("Invalid schedule");
    this.data.db.prepare("UPDATE notices SET title=?,body=?,status=?,pinned=?,scheduled_at=?,updated_at=? WHERE id=?").run(title, content, status as string, pinned, scheduledAt, new Date().toISOString(), id);
    return this.notice(id);
  }
  publishedNotices() { return this.data.db.prepare("SELECT id,title,body,pinned,created_at FROM notices WHERE status='published' ORDER BY pinned DESC,id DESC").all(); }
}

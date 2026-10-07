import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

type Kind = "photo_comment" | "prayer_support" | "news" | "announcement";
type InboxRow = { id: number; kind: Kind; title: string; body: string; url: string; created_at: string; read_at: string | null };

@Injectable()
export class InboxService {
  constructor(private readonly data: DatabaseService) {}

  private add(memberId: number, kind: Kind, title: string, body: string, url: string, sourceId?: number, actorId?: number) {
    this.data.db.prepare("INSERT INTO inbox_items(member_id,kind,title,body,url,created_at,source_id,actor_id) VALUES(?,?,?,?,?,?,?,?)")
      .run(memberId, kind, title, body, url, new Date().toISOString(), sourceId ?? null, actorId ?? null);
  }

  photoComment(photoId: number, commentId: number, commenterId: number, comment: string) {
    const photo = this.data.db.prepare("SELECT member_id FROM photos WHERE id=? AND hidden=0").get(photoId) as { member_id: number } | undefined;
    if (photo && photo.member_id !== commenterId) this.add(photo.member_id, "photo_comment", "내 사진에 댓글이 달렸어요", comment, `/community/photos/${photoId}`, commentId);
  }

  prayerSupport(prayerId: number, supporterId: number) {
    const prayer = this.data.db.prepare("SELECT member_id FROM prayers WHERE id=? AND hidden=0").get(prayerId) as { member_id: number } | undefined;
    if (prayer && prayer.member_id !== supporterId) this.add(prayer.member_id, "prayer_support", "함께 기도해요", "작성한 기도 제목에 누군가 함께 기도했어요.", "/community/prayer", prayerId, supporterId);
  }

  prayerSupportCancelled(prayerId: number, supporterId: number) {
    this.data.db.prepare("DELETE FROM inbox_items WHERE kind='prayer_support' AND source_id=? AND actor_id=?")
      .run(prayerId, supporterId);
  }

  broadcast(kind: "news" | "announcement", title: string, body: string, url: string, sourceId?: number) {
    this.data.db.prepare(`INSERT INTO inbox_items(member_id,kind,title,body,url,created_at,source_id)
      SELECT id,?,?,?,?,?,? FROM members WHERE status='approved'`)
      .run(kind, title, body, url, new Date().toISOString(), sourceId ?? null);
  }

  moderationRemoved(memberId: number, kind: "photo" | "word" | "prayer" | "comment", reason: string, reportId: number) {
    const label = kind === "comment" ? "댓글" : kind === "photo" ? "사진" : kind === "word" ? "말씀 나눔" : "기도 나눔";
    const title = `${label}이 삭제되었어요`;
    const body = `삭제 사유: ${reason}`;
    this.add(memberId, "announcement", title, body, "/community/inbox", reportId);
    return { title, body, url: "/community/inbox" };
  }

  list(memberId: number) {
    const visible = `member_id=? AND (
      kind='announcement' OR
      (kind='news' AND EXISTS(SELECT 1 FROM news n WHERE n.id=source_id AND n.status='published' AND n.deleted_at IS NULL)) OR
      (kind='photo_comment' AND EXISTS(SELECT 1 FROM photo_comments c JOIN photos p ON p.id=c.photo_id WHERE c.id=source_id AND c.hidden=0 AND p.hidden=0)) OR
      (kind='prayer_support' AND EXISTS(SELECT 1 FROM prayer_reactions r JOIN prayers p ON p.id=r.prayer_id WHERE r.prayer_id=source_id AND r.member_id=actor_id AND p.hidden=0))
    )`;
    const rows = this.data.db.prepare(`SELECT id,kind,title,body,url,created_at,read_at FROM inbox_items WHERE ${visible} ORDER BY id DESC`).all(memberId) as InboxRow[];
    const unreadCount = (this.data.db.prepare(`SELECT count(*) AS n FROM inbox_items WHERE ${visible} AND read_at IS NULL`).get(memberId) as { n: number }).n;
    return { items: rows.map(({ created_at, read_at, ...row }) => ({ ...row, createdAt: created_at, readAt: read_at })), unreadCount };
  }

  read(memberId: number, id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundException("Inbox item not found");
    const now = new Date().toISOString();
    const visible = this.list(memberId).items.some((item) => item.id === id);
    if (!visible) throw new NotFoundException("Inbox item not found");
    this.data.db.prepare("UPDATE inbox_items SET read_at=? WHERE id=? AND member_id=? AND read_at IS NULL").run(now, id, memberId);
    const row = this.data.db.prepare("SELECT read_at FROM inbox_items WHERE id=? AND member_id=?").get(id, memberId) as { read_at: string | null } | undefined;
    if (!row) throw new NotFoundException("Inbox item not found");
    return { readAt: row.read_at };
  }

  readAll(memberId: number) {
    for (const item of this.list(memberId).items) {
      if (!item.readAt) this.data.db.prepare("UPDATE inbox_items SET read_at=? WHERE id=? AND member_id=?").run(new Date().toISOString(), item.id, memberId);
    }
    return { unreadCount: 0 };
  }
}

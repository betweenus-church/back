import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import webPush from "web-push";
import { DailyWordService } from "../daily-word/daily-word.service";
import { seoulDate } from "../daily-word/date";
import { DatabaseService } from "../database/database.service";
import { InboxService } from "../inbox/inbox.service";

type SubscriptionRow = { id: number; endpoint: string; p256dh: string; auth: string };
type PushBody = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
const pushHost = (host: string) =>
  host === "fcm.googleapis.com" ||
  host === "web.push.apple.com" ||
  host === "updates.push.services.mozilla.com" ||
  host.endsWith(".notify.windows.com");

function endpointOf(body: unknown) {
  const endpoint = (body as PushBody | null)?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 2048) throw new BadRequestException("Invalid push endpoint");
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || !pushHost(url.hostname)) throw new Error("Unsupported push service");
    return endpoint;
  } catch { throw new BadRequestException("Invalid push endpoint"); }
}

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey = process.env.VAPID_PUBLIC_KEY || "";
  private readonly privateKey = process.env.VAPID_PRIVATE_KEY || "";
  private readonly subject = process.env.VAPID_SUBJECT || "";
  private timer?: NodeJS.Timeout;
  private sending = false;

  constructor(private readonly data: DatabaseService, private readonly dailyWord: DailyWordService, private readonly inbox: InboxService) {
    if (this.publicKey && this.privateKey && this.subject) {
      webPush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    }
  }

  onModuleInit() {
    this.timer = setInterval(() => { void this.sendDue().catch((error: unknown) => this.logger.error("Daily push failed", error)); }, 30_000);
    this.timer.unref();
    void this.sendDue().catch((error: unknown) => this.logger.error("Daily push failed", error));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private available() { return Boolean(this.publicKey && this.privateKey && this.subject); }
  private setting(key: "push_enabled" | "push_time") {
    return (this.data.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
  }

  memberConfig() {
    return { available: this.available(), enabled: this.setting("push_enabled") === "true",
      time: this.setting("push_time") || "08:00", timezone: "Asia/Seoul", publicKey: this.publicKey };
  }

  adminSettings() {
    const subscribers = (this.data.db.prepare(`SELECT count(*) AS n FROM push_subscriptions p
      JOIN members m ON m.id=p.member_id WHERE m.status='approved'`).get() as { n: number }).n;
    return { available: this.available(), enabled: this.setting("push_enabled") === "true",
      time: this.setting("push_time") || "08:00", timezone: "Asia/Seoul", subscribers };
  }

  updateSettings(body: unknown) {
    const data = body as { enabled?: unknown; time?: unknown } | null;
    if (typeof data?.enabled !== "boolean" || typeof data.time !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.time)) {
      throw new BadRequestException("enabled and HH:mm time are required");
    }
    if (data.enabled && !this.available()) throw new ServiceUnavailableException("Push keys are not configured");
    this.data.db.prepare("UPDATE settings SET value=? WHERE key='push_enabled'").run(String(data.enabled));
    this.data.db.prepare("UPDATE settings SET value=? WHERE key='push_time'").run(data.time);
    return this.adminSettings();
  }

  subscribe(memberId: number, body: unknown) {
    if (!this.available()) throw new ServiceUnavailableException("Push is not configured");
    const endpoint = endpointOf(body);
    const keys = (body as PushBody).keys;
    if (typeof keys?.p256dh !== "string" || typeof keys.auth !== "string" ||
        !/^[A-Za-z0-9_-]{40,256}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{8,128}$/.test(keys.auth)) {
      throw new BadRequestException("Invalid push keys");
    }
    this.data.db.prepare(`INSERT INTO push_subscriptions(member_id,endpoint,p256dh,auth,created_at)
      VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET
      member_id=excluded.member_id,p256dh=excluded.p256dh,auth=excluded.auth`)
      .run(memberId, endpoint, keys.p256dh, keys.auth, new Date().toISOString());
    return { subscribed: true };
  }

  status(memberId: number, body: unknown) {
    const endpoint = endpointOf(body);
    const row = this.data.db.prepare("SELECT 1 FROM push_subscriptions WHERE member_id=? AND endpoint=?").get(memberId, endpoint);
    return { subscribed: Boolean(row) };
  }

  unsubscribe(memberId: number, body: unknown) {
    const endpoint = endpointOf(body);
    this.data.db.prepare("DELETE FROM push_subscriptions WHERE member_id=? AND endpoint=?").run(memberId, endpoint);
    return { subscribed: false };
  }

  async sendToMember(memberId: number, title: string, body: string, url: string) {
    if (!this.available()) return;
    const rows = this.data.db.prepare(`SELECT p.id,p.endpoint,p.p256dh,p.auth FROM push_subscriptions p
      JOIN members m ON m.id=p.member_id WHERE p.member_id=? AND m.status='approved'`).all(memberId) as SubscriptionRow[];
    const payload = JSON.stringify({ kind: "announcement", id: randomUUID(), title, body, url });
    for (const row of rows) {
      try {
        await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload, { TTL: 3600, timeout: 10_000 });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) this.data.db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(row.id);
        else this.logger.warn(`Member push failed (status ${status ?? "network"})`);
      }
    }
  }

  async sendAnnouncement(body: unknown) {
    const data = body as { title?: unknown; message?: unknown; newsId?: unknown; noticeId?: unknown } | null;
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    const message = typeof data?.message === "string" ? data.message.trim() : "";
    if (!title || title.length > 60 || !message || message.length > 200) {
      throw new BadRequestException("title (1-60) and message (1-200) are required");
    }
    const newsId = data?.newsId;
    const noticeId = data?.noticeId;
    if ((newsId === undefined) === (noticeId === undefined)) {
      throw new BadRequestException("Select one published notice or news post");
    }
    const targetId = newsId === undefined ? noticeId : newsId;
    if (typeof targetId !== "number" || !Number.isSafeInteger(targetId) || targetId <= 0) {
      throw new BadRequestException("Target ID must be a positive integer");
    }
    if (newsId !== undefined) {
      if (!this.data.db.prepare("SELECT 1 FROM news WHERE id=? AND status='published' AND deleted_at IS NULL").get(targetId)) {
        throw new NotFoundException("Published news not found");
      }
    } else if (!this.data.db.prepare("SELECT 1 FROM notices WHERE id=? AND status='published'").get(targetId)) {
      throw new NotFoundException("Published notice not found");
    }
    const url = newsId === undefined ? `/community/notices/${targetId}` : `/community/news/${targetId}`;
    this.inbox.broadcast("announcement", title, message, url, targetId);
    if (!this.available()) return { delivered: 0, failed: 0 };
    const rows = this.data.db.prepare(`SELECT p.id,p.endpoint,p.p256dh,p.auth FROM push_subscriptions p
      JOIN members m ON m.id=p.member_id WHERE m.status='approved'`).all() as SubscriptionRow[];
    const payload = JSON.stringify({ kind: "announcement", id: randomUUID(), title, body: message, url });
    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload, { TTL: 3600, timeout: 10_000 });
        delivered++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) this.data.db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(row.id);
        else this.logger.warn(`Announcement push failed (status ${status ?? "network"})`);
        failed++;
      }
    }
    return { delivered, failed };
  }

  async sendDue(now = new Date()) {
    if (this.sending || !this.available() || this.setting("push_enabled") !== "true") return 0;
    const time = this.setting("push_time") || "08:00";
    const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const delay = minutes(localTime) - minutes(time);
    if (delay < 0 || delay >= 10) return 0;
    this.sending = true;
    try {
      const date = seoulDate(now);
      const word = this.dailyWord.get(date);
      const payload = JSON.stringify({
        title: "오늘의 말씀을 묵상해요",
        body: `${word.reference} · ${word.verse}`,
        url: "/community/word",
        date,
      });
      const rows = this.data.db.prepare(`SELECT p.id,p.endpoint,p.p256dh,p.auth FROM push_subscriptions p
        JOIN members m ON m.id=p.member_id WHERE m.status='approved'`).all() as SubscriptionRow[];
      let delivered = 0;
      for (const row of rows) {
        const claimed = this.data.db.prepare("INSERT OR IGNORE INTO push_deliveries(date,subscription_id) VALUES(?,?)").run(date, row.id);
        if (!claimed.changes) continue;
        try {
          await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload, { TTL: 3600, timeout: 10_000 });
          delivered++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            this.data.db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(row.id);
          } else {
            this.data.db.prepare("DELETE FROM push_deliveries WHERE date=? AND subscription_id=?").run(date, row.id);
            this.logger.warn(`Push delivery failed (status ${status ?? "network"})`);
          }
        }
      }
      return delivered;
    } finally {
      this.sending = false;
    }
  }
}

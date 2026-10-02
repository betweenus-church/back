import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { seoulDate, validDate } from "./date";
import { officialReadingUrl, plannedWord } from "./plan";

type DailyWordRow = { date: string; reference: string; verse: string; question: string; reading_url: string | null };

function content(body: unknown, key: string, max: number) {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new BadRequestException(`${key} must be 1-${max} characters`);
  }
  return value.trim();
}

@Injectable()
export class DailyWordService {
  constructor(private readonly data: DatabaseService) {}

  private format(row: DailyWordRow) {
    return { date: row.date, reference: row.reference, verse: row.verse, question: row.question,
      readingUrl: row.reading_url ?? officialReadingUrl(row.reference), source: "custom" as const };
  }

  get(date?: string) {
    const target = date === undefined ? seoulDate() : validDate(date);
    const row = this.data.db.prepare("SELECT date,reference,verse,question,reading_url FROM daily_words WHERE date=?")
      .get(target) as DailyWordRow | undefined;
    return row ? this.format(row) : plannedWord(target);
  }

  list() {
    const rows = this.data.db.prepare("SELECT date,reference,verse,question,reading_url FROM daily_words ORDER BY date DESC")
      .all() as DailyWordRow[];
    return rows.map((row) => this.format(row));
  }

  save(date: string, body: unknown) {
    validDate(date);
    const reference = content(body, "reference", 100);
    const verse = content(body, "verse", 500);
    const question = content(body, "question", 300);
    const rawUrl = (body as Record<string, unknown> | null)?.readingUrl;
    let readingUrl: string | null = null;
    if (rawUrl !== undefined && rawUrl !== null && rawUrl !== "") {
      if (typeof rawUrl !== "string" || rawUrl.length > 500) throw new BadRequestException("Invalid readingUrl");
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== "bible.bskorea.or.kr") throw new Error("Invalid URL");
        readingUrl = url.toString();
      } catch { throw new BadRequestException("readingUrl must use the official Bible reader"); }
    }
    this.data.db.prepare(`INSERT INTO daily_words(date,reference,verse,question,reading_url) VALUES(?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET reference=excluded.reference,verse=excluded.verse,
      question=excluded.question,reading_url=excluded.reading_url`).run(date, reference, verse, question, readingUrl);
    return this.get(date);
  }
}

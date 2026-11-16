import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { seoulDate } from "../daily-word/date";
import { MINI_HOME_ITEMS, POINT_ACTIVITIES, PointActivity } from "./catalog";

type Wardrobe = { character: string; top: string; pants: string; skirt: string; socks: string; shoes: string };
type Home = { points: number; outfitId: string; roomId: string; message: string; wardrobe: string };

@Injectable()
export class MiniHomeService {
  constructor(private readonly data: DatabaseService) {}

  private ensure(memberId: number) {
    this.data.db.prepare("INSERT OR IGNORE INTO mini_homes(member_id) VALUES(?)").run(memberId);
  }

  snapshot(memberId: number) {
    this.ensure(memberId);
    const home = this.data.db.prepare("SELECT points,outfit_id AS outfitId,room_id AS roomId,message,wardrobe FROM mini_homes WHERE member_id=?").get(memberId) as Home;
    const owned = this.data.db.prepare("SELECT item_id FROM mini_home_inventory WHERE member_id=?").all(memberId) as { item_id: string }[];
    const today = seoulDate();
    const earned = this.data.db.prepare("SELECT activity FROM point_ledger WHERE member_id=? AND reward_date=? AND activity IS NOT NULL").all(memberId, today) as { activity: string }[];
    return {
      ...home, wardrobe: this.wardrobe(home), date: today,
      inventory: [...MINI_HOME_ITEMS.filter(item => item.price === 0).map(item => item.id), ...owned.map(row => row.item_id)],
      catalog: MINI_HOME_ITEMS,
      activities: POINT_ACTIVITIES.map(activity => ({ ...activity, completed: earned.some(row => row.activity === activity.id) })),
      history: this.data.db.prepare("SELECT id,amount,description,created_at AS createdAt FROM point_ledger WHERE member_id=? ORDER BY id DESC LIMIT 20").all(memberId),
    };
  }

  private transaction<T>(action: () => T): T {
    this.data.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.data.db.exec("COMMIT"); return result; }
    catch (error) { this.data.db.exec("ROLLBACK"); throw error; }
  }

  visit(memberId: number, church: string) {
    const member = this.data.db.prepare("SELECT id,name,church,avatar_file FROM members WHERE id=? AND status='approved' AND church=?").get(memberId, church) as { id: number; name: string; church: string; avatar_file: string | null } | undefined;
    if (!member) throw new NotFoundException("방문할 미니홈피를 찾을 수 없어요.");
    const home = this.data.db.prepare("SELECT outfit_id AS outfitId,room_id AS roomId,message,wardrobe FROM mini_homes WHERE member_id=?").get(memberId) as Home | undefined;
    const view = home ?? { points: 0, outfitId: "outfit-basic", roomId: "room-basic", message: "작은 나눔으로 채워 가는 나의 하루", wardrobe: "{}" };
    return { id: member.id, name: member.name, church: member.church, avatarUrl: member.avatar_file ? `/api/auth/members/${member.id}/avatar?v=${encodeURIComponent(member.avatar_file)}` : null,
      outfitId: view.outfitId, roomId: view.roomId, message: view.message, wardrobe: this.wardrobe(view) };
  }

  withActivity<T extends object>(memberId: number, kind: PointActivity, action: () => T, eligible: (result: T) => boolean = () => true) {
    return this.transaction(() => {
      const result = action();
      this.ensure(memberId);
      const activity = POINT_ACTIVITIES.find(item => item.id === kind)!;
      const inserted = eligible(result) ? this.data.db.prepare("INSERT OR IGNORE INTO point_ledger(member_id,amount,activity,reward_date,description,created_at) VALUES(?,?,?,?,?,?)")
        .run(memberId, activity.points, kind, seoulDate(), activity.name, new Date().toISOString()).changes : 0;
      if (inserted) this.data.db.prepare("UPDATE mini_homes SET points=points+? WHERE member_id=?").run(activity.points, memberId);
      return { ...result, pointReward: inserted ? activity.points : 0 };
    });
  }

  purchase(memberId: number, body: unknown) {
    const item = this.item(body);
    this.transaction(() => {
      this.ensure(memberId);
      if (item.price === 0 || this.data.db.prepare("SELECT item_id FROM mini_home_inventory WHERE member_id=? AND item_id=?").get(memberId, item.id))
        throw new ConflictException("이미 보유한 아이템이에요.");
      const changed = this.data.db.prepare("UPDATE mini_homes SET points=points-? WHERE member_id=? AND points>=?").run(item.price, memberId, item.price);
      if (!changed.changes) throw new BadRequestException("포인트가 부족해요. 공동체 활동으로 포인트를 모아 주세요.");
      this.data.db.prepare("INSERT INTO mini_home_inventory(member_id,item_id,purchased_at) VALUES(?,?,?)").run(memberId, item.id, new Date().toISOString());
      this.data.db.prepare("INSERT INTO point_ledger(member_id,amount,description,created_at) VALUES(?,?,?,?)").run(memberId, -item.price, `${item.name} 구매`, new Date().toISOString());
    });
    return this.snapshot(memberId);
  }

  equip(memberId: number, body: unknown) {
    const item = this.item(body);
    this.transaction(() => {
      this.ensure(memberId);
      if (item.price !== 0 && !this.data.db.prepare("SELECT item_id FROM mini_home_inventory WHERE member_id=? AND item_id=?").get(memberId, item.id))
        throw new BadRequestException("구매한 아이템만 사용할 수 있어요.");
      if (item.kind === "room") this.data.db.prepare("UPDATE mini_homes SET room_id=? WHERE member_id=?").run(item.id, memberId);
      else if (item.kind === "outfit") {
        const current = this.data.db.prepare("SELECT outfit_id AS outfitId,wardrobe FROM mini_homes WHERE member_id=?").get(memberId) as Home;
        this.data.db.prepare("UPDATE mini_homes SET outfit_id=?,wardrobe=? WHERE member_id=?").run(item.id, JSON.stringify({ character: this.wardrobe(current).character }), memberId);
      }
      else {
        const home = this.data.db.prepare("SELECT outfit_id AS outfitId,wardrobe FROM mini_homes WHERE member_id=?").get(memberId) as Home;
        const wardrobe = this.wardrobe(home);
        wardrobe[item.kind] = item.id;
        if (item.kind === "skirt") wardrobe.pants = "";
        if (item.kind === "pants") wardrobe.skirt = "";
        this.data.db.prepare("UPDATE mini_homes SET wardrobe=? WHERE member_id=?").run(JSON.stringify(wardrobe), memberId);
      }
    });
    return this.snapshot(memberId);
  }

  private wardrobe(home: Home): Wardrobe {
    return { character: "character-basic", top: home.outfitId === "outfit-basic" ? "top-basic" : home.outfitId, pants: "pants-basic", skirt: "", socks: "socks-basic", shoes: "shoes-basic", ...JSON.parse(home.wardrobe) };
  }

  updateMessage(memberId: number, body: unknown) {
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string" || !message.trim() || message.trim().length > 80) throw new BadRequestException("소개는 1~80자로 작성해 주세요.");
    this.ensure(memberId);
    this.data.db.prepare("UPDATE mini_homes SET message=? WHERE member_id=?").run(message.trim(), memberId);
    return this.snapshot(memberId);
  }

  private item(body: unknown) {
    const id = (body as { itemId?: unknown } | null)?.itemId;
    const item = MINI_HOME_ITEMS.find(item => item.id === id);
    if (!item) throw new NotFoundException("아이템을 찾을 수 없어요.");
    return item;
  }
}

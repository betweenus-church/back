import { BadRequestException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseService } from "../database/database.service";
import { ImageUpload, optimizeImage } from "../images/optimized-upload";
import { MemberRow } from "./auth.types";

@Injectable()
export class AvatarService {
  private readonly directory = resolve(process.env.UPLOAD_DIR || "./data/uploads", "avatars");
  constructor(private readonly data: DatabaseService) { mkdirSync(this.directory, { recursive: true }); }

  private member(id: number) {
    return this.data.db.prepare("SELECT * FROM members WHERE id=?").get(id) as MemberRow;
  }

  private removeFile(filename: string | null) {
    if (!filename) return;
    try { unlinkSync(resolve(this.directory, filename)); }
    catch { /* Keep the committed profile state if an old file was already removed. */ }
  }

  image(member: MemberRow) {
    if (!member.avatar_file) throw new NotFoundException("프로필 사진이 없어요.");
    const filename = resolve(this.directory, member.avatar_file);
    if (!existsSync(filename)) throw new NotFoundException("프로필 사진을 찾지 못했어요.");
    return new StreamableFile(readFileSync(filename), { type: "image/webp", disposition: "inline" });
  }

  memberImage(id: number) {
    const member = this.member(id);
    if (!member || member.status !== "approved") throw new NotFoundException("프로필 사진이 없어요.");
    return this.image(member);
  }

  async replace(member: MemberRow, file?: ImageUpload) {
    if (!file) throw new BadRequestException("사진을 선택해 주세요.");
    const image = await optimizeImage(file, 512, true);
    const filename = `${randomUUID()}.webp`;
    writeFileSync(resolve(this.directory, filename), image.buffer, { flag: "wx" });
    try {
      this.data.db.prepare("UPDATE members SET avatar_file=?,updated_at=? WHERE id=?")
        .run(filename, new Date().toISOString(), member.id);
    } catch (error) { this.removeFile(filename); throw error; }
    this.removeFile(member.avatar_file);
    return this.member(member.id);
  }

  remove(member: MemberRow) {
    if (member.avatar_file) {
      this.data.db.prepare("UPDATE members SET avatar_file=NULL,updated_at=? WHERE id=?")
        .run(new Date().toISOString(), member.id);
      this.removeFile(member.avatar_file);
    }
    return this.member(member.id);
  }
}

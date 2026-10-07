import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import sharp from "sharp";

const databasePath = resolve(process.env.DATABASE_PATH || "");
const uploadRoot = resolve(process.env.UPLOAD_DIR || "");
const testRoot = resolve("E:\\테스트 서버");
if (!databasePath.startsWith(`${testRoot}\\`) || !uploadRoot.startsWith(`${testRoot}\\`)) {
  throw new Error("This migration can only run against E:\\테스트 서버");
}

const db = new DatabaseSync(databasePath);
const avatarDir = join(uploadRoot, "avatars");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(dirname(databasePath), `avatar-square-backup-${stamp}`);
mkdirSync(backupDir);
try {
  const rows = db.prepare("SELECT id,avatar_file FROM members WHERE avatar_file IS NOT NULL").all();
  const targets = [];
  for (const row of rows) {
    const filename = String(row.avatar_file);
    if (basename(filename) !== filename) throw new Error("Unsafe avatar filename");
    const source = join(avatarDir, filename);
    const metadata = await sharp(source).metadata();
    if (metadata.width === metadata.height) continue;
    targets.push({ id: row.id, filename, source });
  }
  if (!targets.length) {
    console.log("All existing avatars are already square");
  } else {
    await backup(db, join(backupDir, "sai-before-square.sqlite"));
    for (const target of targets) copyFileSync(target.source, join(backupDir, target.filename));
    for (const target of targets) {
      const newName = `${randomUUID()}.webp`;
      const destination = join(avatarDir, newName);
      const buffer = await sharp(target.source).rotate().resize(512, 512, { fit: "cover", position: "centre" })
        .webp({ quality: 78, effort: 4 }).toBuffer();
      writeFileSync(destination, buffer, { flag: "wx" });
      try {
        const result = db.prepare("UPDATE members SET avatar_file=?,updated_at=? WHERE id=? AND avatar_file=?")
          .run(newName, new Date().toISOString(), target.id, target.filename);
        if (result.changes !== 1) throw new Error("Avatar changed during migration");
      } catch (error) { unlinkSync(destination); throw error; }
      unlinkSync(target.source);
    }
    console.log(`Converted ${targets.length} avatar(s) to 512x512; backup: ${backupDir}`);
  }
} finally { db.close(); }

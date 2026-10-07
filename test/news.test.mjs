import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("church news enforces approval, admin edits, image access and soft deletion", async () => {
  const root = mkdtempSync(join(dirname(process.env.DATABASE_PATH), "sai-news-test-"));
  const port = await freePort();
  const origin = "http://127.0.0.1:3001";
  const dbPath = join(root, "test.sqlite");
  const base = `http://127.0.0.1:${port}/api`;
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath,
      UPLOAD_DIR: join(root, "uploads"), FRONTEND_ORIGIN: origin, CHURCH_NAME: "테스트교회", ADMIN_PASSWORD: "TestPass12!x" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  async function call(path, method = "GET", body, cookie = "") {
    const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(method === "GET" ? {} : { Origin: origin }) };
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(stderr);
      try { await fetch(base + "/auth/me"); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.equal(ready, true, stderr);
    assert.equal((await call("/news")).response.status, 401);
    assert.equal((await call("/admin/news")).response.status, 401);
    const signup = await call("/auth/signup", "POST", { name: "청년", phone: "010-5555-1234", church: "테스트교회", consent: true, password: "MemberPass12" });
    assert.equal(signup.response.status, 201);
    const member = signup.cookie;
    assert.equal((await call("/news", "GET", undefined, member)).response.status, 403);
    const login = await call("/auth/admin/login", "POST", { password: "TestPass12!x" });
    assert.equal(login.response.status, 201);
    const admin = login.cookie;
    const form = new FormData();
    form.set("title", "교회 새 소식"); form.set("body", "이번 주 모임을 확인해 주세요.");
    form.set("category", "gathering"); form.set("status", "draft");
    const originalCover = await sharp(randomBytes(1800 * 1200 * 3), { raw: { width: 1800, height: 1200, channels: 3 } }).png().toBuffer();
    assert.ok(originalCover.length < 10 * 1024 * 1024);
    form.set("cover", new Blob([originalCover], { type: "image/png" }), "cover.png");
    const created = await call("/admin/news", "POST", form, admin);
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    const id = created.data.id;
    assert.equal(created.data.status, "draft");
    assert.equal(created.data.coverUrl, `/api/admin/news/${id}/cover`);
    const adminCover = (await call(`/admin/news/${id}/cover`, "GET", undefined, admin)).response;
    assert.equal(adminCover.status, 200);
    assert.match(adminCover.headers.get("content-type"), /image\/webp/);
    const optimizedCover = Buffer.from(await adminCover.arrayBuffer());
    assert.ok(optimizedCover.length < originalCover.length);
    const coverInfo = await sharp(optimizedCover).metadata();
    assert.equal(coverInfo.format, "webp");
    assert.equal(coverInfo.width, 1600);
    assert.equal(coverInfo.height, 1067);
    const [storedCover] = readdirSync(join(root, "uploads", "news"));
    assert.ok(storedCover.endsWith(".webp"));
    assert.equal(readdirSync(join(root, "uploads", "news")).length, 1);
    assert.equal((await call(`/news/${id}/cover`, "GET", undefined, member)).response.status, 403);
    assert.equal((await call("/admin/news", "GET", undefined, admin)).data.length, 1);
    assert.equal((await call("/admin/approvals", "GET", undefined, admin)).data.length, 1);
    assert.equal((await call(`/admin/approvals/${signup.data.id}/approve`, "POST", undefined, admin)).response.status, 201);
    assert.deepEqual((await call("/news", "GET", undefined, member)).data, []);
    assert.equal((await call(`/news/${id}`, "GET", undefined, member)).response.status, 404);
    assert.equal((await call(`/news/${id}/cover`, "GET", undefined, member)).response.status, 404);
    assert.equal((await call("/admin/news", "POST", { title: "", body: "body", category: "story", status: "draft" }, admin)).response.status, 400);
    const badImage = new FormData();
    badImage.set("title", "사진 검증"); badImage.set("body", "본문"); badImage.set("category", "story"); badImage.set("status", "draft");
    badImage.set("cover", new Blob(["not a jpeg"], { type: "image/jpeg" }), "fake.jpg");
    assert.equal((await call("/admin/news", "POST", badImage, admin)).response.status, 400);
    const published = await call(`/admin/news/${id}`, "PATCH", { status: "published" }, admin);
    assert.equal(published.response.status, 200);
    assert.ok(published.data.publishedAt);
    const list = await call("/news?category=gathering", "GET", undefined, member);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].excerpt, "이번 주 모임을 확인해 주세요.");
    assert.equal(list.data[0].coverUrl, `/api/news/${id}/cover`);
    const memberCover = (await call(`/news/${id}/cover`, "GET", undefined, member)).response;
    assert.equal(memberCover.status, 200);
    assert.deepEqual(Buffer.from(await memberCover.arrayBuffer()), optimizedCover);
    assert.equal((await call("/news?category=invalid", "GET", undefined, member)).response.status, 400);
    const edited = await call(`/admin/news/${id}`, "PATCH", { title: "수정된 소식", removeCover: true }, admin);
    assert.equal(edited.data.title, "수정된 소식");
    assert.equal(edited.data.coverUrl, null);
    assert.equal((await call(`/news/${id}/cover`, "GET", undefined, member)).response.status, 404);
    assert.equal(existsSync(join(root, "uploads", "news", storedCover)), false);
    assert.equal((await call(`/admin/news/${id}`, "DELETE", undefined, member)).response.status, 401);
    assert.deepEqual((await call(`/admin/news/${id}`, "DELETE", undefined, admin)).data, { ok: true });
    assert.equal((await call(`/admin/news/${id}`, "DELETE", undefined, admin)).response.status, 404);
    assert.equal((await call(`/news/${id}`, "GET", undefined, member)).response.status, 404);
    assert.deepEqual((await call("/news", "GET", undefined, member)).data, []);
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 8);
    assert.ok(db.prepare("SELECT deleted_at FROM news WHERE id=?").get(id).deleted_at);
    db.close();
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

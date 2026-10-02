import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function main() {
    const app = await NestFactory.create(AppModule, { bodyParser: true });
    const origin = process.env.FRONTEND_ORIGIN || "http://127.0.0.1:3000";
    const allowedOrigins = new Set([origin]);
    const localUrl = new URL(origin);
    if (localUrl.hostname === "127.0.0.1" || localUrl.hostname === "localhost") {
        localUrl.hostname = localUrl.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
        allowedOrigins.add(localUrl.origin);
    }
    app.use(
        (
            req: { method: string; headers: Record<string, string | undefined> },
            res: {
                setHeader: (key: string, value: string) => void;
                status: (code: number) => { json: (body: unknown) => void };
            },
            next: () => void,
        ) => {
            res.setHeader("Cache-Control", "no-store");
            if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowedOrigins.has(req.headers.origin ?? "")) {
                res.status(403).json({ statusCode: 403, message: "Invalid request origin" });
                return;
            }
            next();
        },
    );
    app.setGlobalPrefix("api");
    app.enableShutdownHooks();
    await app.listen(Number(process.env.PORT || 4000), "127.0.0.1");
}

void main();

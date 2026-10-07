import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DailyWordModule } from "../daily-word/daily-word.module";
import { InboxModule } from "../inbox/inbox.module";
import { PushModule } from "../push/push.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({ imports: [AuthModule, DatabaseModule, DailyWordModule, InboxModule, PushModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}

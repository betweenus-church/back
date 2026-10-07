import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DailyWordModule } from "../daily-word/daily-word.module";
import { DatabaseModule } from "../database/database.module";
import { InboxModule } from "../inbox/inbox.module";
import { AdminPushController, MemberPushController } from "./push.controller";
import { PushService } from "./push.service";

@Module({
  imports: [AuthModule, DailyWordModule, DatabaseModule, InboxModule],
  controllers: [MemberPushController, AdminPushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}

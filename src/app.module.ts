import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CommunityModule } from "./community/community.module";
import { DailyWordModule } from "./daily-word/daily-word.module";
import { NewsModule } from "./news/news.module";
import { PushModule } from "./push/push.module";
import { InboxModule } from "./inbox/inbox.module";

@Module({
  imports: [AuthModule, CommunityModule, AdminModule, DailyWordModule, NewsModule, PushModule, InboxModule],
})
export class AppModule {}

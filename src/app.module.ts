import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CommunityModule } from "./community/community.module";
import { DailyWordModule } from "./daily-word/daily-word.module";

@Module({
  imports: [AuthModule, CommunityModule, AdminModule, DailyWordModule],
})
export class AppModule {}

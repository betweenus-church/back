import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InboxModule } from "../inbox/inbox.module";
import { AdminNewsController, MemberNewsController } from "./news.controller";
import { NewsService } from "./news.service";

@Module({
  imports: [AuthModule, DatabaseModule, InboxModule],
  controllers: [MemberNewsController, AdminNewsController],
  providers: [NewsService],
})
export class NewsModule {}

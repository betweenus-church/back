import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DailyWordModule } from "../daily-word/daily-word.module";
import { CommunityController } from "./community.controller";
import { CommunityService } from "./community.service";

@Module({ imports: [AuthModule, DatabaseModule, DailyWordModule], controllers: [CommunityController], providers: [CommunityService] })
export class CommunityModule {}

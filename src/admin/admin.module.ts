import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DailyWordModule } from "../daily-word/daily-word.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({ imports: [AuthModule, DatabaseModule, DailyWordModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}

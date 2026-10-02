import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { DailyWordController } from "./daily-word.controller";
import { DailyWordService } from "./daily-word.service";

@Module({ imports: [DatabaseModule], controllers: [DailyWordController], providers: [DailyWordService], exports: [DailyWordService] })
export class DailyWordModule {}

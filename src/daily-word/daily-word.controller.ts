import { Controller, Get, Query } from "@nestjs/common";
import { DailyWordService } from "./daily-word.service";

@Controller("daily-word")
export class DailyWordController {
  constructor(private readonly dailyWord: DailyWordService) {}
  @Get() get(@Query("date") date?: string) { return this.dailyWord.get(date); }
}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SpotifyLyricsService } from './spotify-lyrics.service';

@Module({
  controllers: [AppController],
  providers: [SpotifyLyricsService],
})
export class AppModule {}

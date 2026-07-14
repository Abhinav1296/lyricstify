import { Controller, Get, Query } from '@nestjs/common';
import { SpotifyLyricsService } from './spotify-lyrics.service';

@Controller()
export class AppController {
  constructor(private readonly svc: SpotifyLyricsService) {}

  @Get('/health')
  health() {
    return { status: 'ok', service: 'lyricstify-http-api' };
  }

  /**
   * Primary endpoint:
   * GET /lyrics?artist=...&song=...&market=IN
   */
  @Get('/lyrics')
  async lyrics(
    @Query('artist') artist?: string,
    @Query('song') song?: string,
    @Query('market') market?: string,
  ) {
    if (!artist?.trim() || !song?.trim()) {
      return {
        status: 'error',
        error: { message: 'artist and song are required' },
      };
    }

    const res = await this.svc.resolveLyrics({
      artist: artist.trim(),
      song: song.trim(),
      market: (market || 'IN').trim().toUpperCase(),
    });

    return res;
  }

  /**
   * Debug endpoint (optional):
   * GET /track?artist=...&song=...
   */
  @Get('/track')
  async track(
    @Query('artist') artist?: string,
    @Query('song') song?: string,
    @Query('market') market?: string,
  ) {
    if (!artist?.trim() || !song?.trim()) {
      return {
        status: 'error',
        error: { message: 'artist and song are required' },
      };
    }

    const res = await this.svc.searchTrack({
      artist: artist.trim(),
      song: song.trim(),
      market: (market || 'IN').trim().toUpperCase(),
    });

    return res;
  }
}

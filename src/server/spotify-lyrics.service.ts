type ResolveInput = { artist: string; song: string; market: string };

type SpotifyToken = {
  accessToken: string;
  expiresAtMs: number;
};

export class SpotifyLyricsService {
  private token: SpotifyToken | null = null;

  private readonly lyricstifyBase = 'https://api.lyricstify.vercel.app/v1/lyrics';

  private getCookie(): string {
    const cookie = process.env.SPOTIFY_COOKIE || '';
    if (!cookie.trim()) {
      throw new Error('SPOTIFY_COOKIE not set');
    }
    return cookie;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAtMs - now > 60_000) {
      return this.token.accessToken;
    }

    // Spotify web token endpoint
    const url =
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player';

    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'application/json',
        Cookie: this.getCookie(),
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`spotify token failed: ${resp.status} ${text}`);
    }

    const data: any = await resp.json();
    const accessToken: string = data?.accessToken;
    const exp: number = data?.accessTokenExpirationTimestampMs;

    if (!accessToken || !exp) throw new Error('spotify token response missing fields');

    this.token = { accessToken, expiresAtMs: exp };
    return accessToken;
  }

  async searchTrack(input: ResolveInput) {
    const token = await this.getAccessToken();

    const q = `track:${input.song} artist:${input.artist}`;
    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', q);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', '1');
    url.searchParams.set('market', input.market);

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        status: 'error',
        error: { message: 'spotify search failed', details: `${resp.status} ${text}` },
      };
    }

    const data: any = await resp.json();
    const item = data?.tracks?.items?.[0];

    if (!item?.id) {
      return { status: 'not_found', error: { message: 'track not found on spotify' } };
    }

    return {
      status: 'success',
      track: {
        id: item.id,
        name: item.name,
        artists: (item.artists || []).map((a: any) => a?.name).filter(Boolean),
        album: item.album?.name || null,
        artwork: item.album?.images?.[0]?.url || null,
      },
    };
  }

  private normalizeLyricstifyResponse(raw: any) {
    // Lyricstify response typically: { lyrics: { lines: [{ startTimeMs, words }], syncType } }
    const lyrics = raw?.lyrics || raw?.data?.lyrics || raw?.data || raw;

    const syncType = lyrics?.syncType || 'UNSYNCED';
    const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];

    const timed = lines
      .map((l: any) => {
        const t = Number(l?.startTimeMs ?? l?.startTime ?? l?.timeMs ?? 0);
        const text = String(l?.words ?? l?.text ?? '').trim();
        return text ? { timeMs: t, text } : null;
      })
      .filter(Boolean);

    const plain = timed.map((x: any) => x.text).join('\n').trim();

    return {
      syncType,
      timedLyrics: timed,
      plainLyrics: plain || null,
      hasTimestamps: timed.length > 0 && syncType !== 'UNSYNCED',
    };
  }

  async resolveLyrics(input: ResolveInput) {
    // 1) spotify search -> trackId
    const search = await this.searchTrack(input);
    if (search.status !== 'success') {
      return search;
    }

    const trackId = search.track.id;

    // 2) lyricstify lyrics by trackId (time-synced)
    const resp = await fetch(`${this.lyricstifyBase}/${trackId}`, {
      headers: { Accept: 'application/json' },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // treat as not found, not 500
      return {
        status: 'not_found',
        error: { message: 'lyrics not found', details: `${resp.status} ${text}` },
        track: search.track,
      };
    }

    const raw = await resp.json();
    const normalized = this.normalizeLyricstifyResponse(raw);

    if (!normalized.plainLyrics && normalized.timedLyrics.length === 0) {
      return {
        status: 'not_found',
        error: { message: 'lyrics empty' },
        track: search.track,
      };
    }

    return {
      status: 'success',
      track: search.track,
      lyrics: {
        syncType: normalized.syncType,
        hasTimestamps: normalized.hasTimestamps,
        synced: normalized.timedLyrics,   // [{timeMs,text}]
        plain: normalized.plainLyrics
      }
    };
  }
}

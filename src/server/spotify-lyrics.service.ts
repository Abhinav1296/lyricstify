type ResolveInput = { artist: string; song: string; market: string };

type TrackInfo = {
  id: string;
  name: string;
  artists: string[];
  album: string | null;
  artwork: string | null;
};

type SearchSuccess = { status: 'success'; track: TrackInfo };
type SearchNotFound = { status: 'not_found'; error: { message: string; details?: string } };
type SearchError = { status: 'error'; error: { message: string; details?: string } };
type SearchResult = SearchSuccess | SearchNotFound | SearchError;

type LyricsSuccess = {
  status: 'success';
  track: TrackInfo;
  lyrics: {
    syncType: string;
    hasTimestamps: boolean;
    synced: { timeMs: number; text: string }[];
    plain: string | null;
  };
};

type LyricsNotFound = { status: 'not_found'; error: { message: string; details?: string }; track?: TrackInfo };
type LyricsError = { status: 'error'; error: { message: string; details?: string }; track?: TrackInfo };

export class SpotifyLyricsService {
  private token: { accessToken: string; expiresAtMs: number } | null = null;
  private readonly lyricstifyBase = 'https://api.lyricstify.vercel.app/v1/lyrics';

  private getCookie(): string {
    const cookie = process.env.SPOTIFY_COOKIE || '';
    if (!cookie.trim()) throw new Error('SPOTIFY_COOKIE not set');
    return cookie;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAtMs - now > 60_000) return this.token.accessToken;

    const url =
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player';

    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://open.spotify.com/',
        Origin: 'https://open.spotify.com',
        Cookie: this.getCookie(),
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`spotify token failed: ${resp.status} ${text.slice(0, 200)}`);
    }

    const data: any = await resp.json();
    const accessToken: string | undefined = data?.accessToken;
    const exp: number | undefined = data?.accessTokenExpirationTimestampMs;

    if (!accessToken || !exp) throw new Error('spotify token response missing fields');

    this.token = { accessToken, expiresAtMs: exp };
    return accessToken;
  }

  async searchTrack(input: ResolveInput): Promise<SearchResult> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e: any) {
      return { status: 'error', error: { message: 'spotify token error', details: String(e?.message || e) } };
    }

    const q = `track:${input.song} artist:${input.artist}`;
    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', q);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', '1');
    url.searchParams.set('market', input.market);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { status: 'error', error: { message: 'spotify search failed', details: `${resp.status} ${text.slice(0, 200)}` } };
    }

    const data: any = await resp.json();
    const item = data?.tracks?.items?.[0];
    if (!item?.id) return { status: 'not_found', error: { message: 'track not found on spotify' } };

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
    const lyrics = raw?.lyrics || raw?.data?.lyrics || raw?.data || raw;

    const syncType = lyrics?.syncType || 'UNSYNCED';
    const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];

    const synced = lines
      .map((l: any) => {
        const t = Number(l?.startTimeMs ?? l?.startTime ?? l?.timeMs ?? 0);
        const text = String(l?.words ?? l?.text ?? '').trim();
        return text ? { timeMs: t, text } : null;
      })
      .filter(Boolean) as { timeMs: number; text: string }[];

    const plain = synced.map((x) => x.text).join('\n').trim();

    return { syncType, synced, plain: plain || null, hasTimestamps: synced.length > 0 && syncType !== 'UNSYNCED' };
  }

  async resolveLyrics(input: ResolveInput): Promise<LyricsSuccess | LyricsNotFound | LyricsError> {
    const search = await this.searchTrack(input);
    if (search.status !== 'success') return search;

    const trackId = search.track.id;

    const resp = await fetch(`${this.lyricstifyBase}/${trackId}`, {
      headers: { Accept: 'application/json' },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { status: 'not_found', error: { message: 'lyrics not found', details: `${resp.status} ${text.slice(0, 200)}` }, track: search.track };
    }

    const raw = await resp.json();
    const normalized = this.normalizeLyricstifyResponse(raw);

    if (!normalized.plain && normalized.synced.length === 0) {
      return { status: 'not_found', error: { message: 'lyrics empty' }, track: search.track };
    }

    return {
      status: 'success',
      track: search.track,
      lyrics: {
        syncType: normalized.syncType,
        hasTimestamps: normalized.hasTimestamps,
        synced: normalized.synced,
        plain: normalized.plain,
      },
    };
  }
}

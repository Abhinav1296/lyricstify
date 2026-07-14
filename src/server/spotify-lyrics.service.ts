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
  private readonly lyricstifyBase = 'https://api.lyricstify.vercel.app/v1/lyrics';

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

    return {
      syncType,
      synced,
      plain: plain || null,
      hasTimestamps: synced.length > 0 && syncType !== 'UNSYNCED',
    };
  }

  private extractTrackIdFromHtml(html: string): string | null {
    // Try common patterns:
    // href="/track/<id>"
    const m1 = html.match(/href="\/track\/([A-Za-z0-9]{22})"/);
    if (m1?.[1]) return m1[1];

    // uri:"spotify:track:<id>"
    const m2 = html.match(/spotify:track:([A-Za-z0-9]{22})/);
    if (m2?.[1]) return m2[1];

    return null;
  }

  async searchTrack(input: ResolveInput): Promise<SearchResult> {
    // Public search page (may or may not include IDs in raw HTML)
    const q = encodeURIComponent(`${input.song} ${input.artist}`.trim());
    const url = `https://open.spotify.com/search/${q}/tracks`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        status: 'error',
        error: { message: 'spotify search page blocked', details: `${resp.status} ${text.slice(0, 120)}` },
      };
    }

    const html = await resp.text();
    const id = this.extractTrackIdFromHtml(html);

    if (!id) {
      return {
        status: 'not_found',
        error: {
          message: 'could not extract track id from spotify search html',
          details: 'Spotify search page likely SPA-rendered; use official Web API client credentials instead.',
        },
      };
    }

    return {
      status: 'success',
      track: {
        id,
        name: input.song,
        artists: [input.artist],
        album: null,
        artwork: null,
      },
    };
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
      return {
        status: 'not_found',
        error: { message: 'lyrics not found', details: `${resp.status} ${text.slice(0, 200)}` },
        track: search.track,
      };
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

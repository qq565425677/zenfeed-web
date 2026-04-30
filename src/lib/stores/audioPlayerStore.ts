import { get, writable } from "svelte/store";
import type { FeedVO } from "$lib/types/feed";
import { getFeedItemId } from "$lib/utils/feedUtils";
import { browser } from "$app/environment";
import { getTargetApiUrl } from "$lib/utils/apiUtils";
import {
  lastQueryRequestStore,
  queryFeedsStore,
  type QueryRequest,
} from "$lib/stores/feedStore";

export interface AudioTrack {
  id: string;
  url: string;
  title: string;
  link: string;
  feed: FeedVO;
  expiresAt: number | null;
}

export interface AudioPlayerState {
  currentTrack: AudioTrack | null;
  playlist: AudioTrack[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isPlayerVisible: boolean;
}

const initialState: AudioPlayerState = {
  currentTrack: null,
  playlist: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  isPlayerVisible: false,
};

const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 1000;

function getTrackTitle(feed: FeedVO): string {
  const source = feed.labels.source?.trim();
  const title = feed.labels.title?.trim() || "Untitled";

  return source ? `[${source}] ${title}` : title;
}

function parseUtcDateTime(value: string): number | null {
  const matched = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (!matched) return null;

  const [, year, month, day, hour, minute, second] = matched;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function getTrackExpiryTime(url: string): number | null {
  try {
    const parsedUrl = new URL(url);
    const awsExpires = parsedUrl.searchParams.get("X-Amz-Expires");
    const awsDate = parsedUrl.searchParams.get("X-Amz-Date");

    if (awsExpires && awsDate) {
      const signedAt = parseUtcDateTime(awsDate);
      const expiresInSeconds = Number(awsExpires);

      if (
        signedAt !== null &&
        Number.isFinite(expiresInSeconds) &&
        expiresInSeconds > 0
      ) {
        return signedAt + expiresInSeconds * 1000;
      }
    }

    const expiresAt = parsedUrl.searchParams.get("Expires");
    if (expiresAt) {
      const expiresAtSeconds = Number(expiresAt);
      if (Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0) {
        return expiresAtSeconds * 1000;
      }
    }
  } catch {
    // Ignore invalid or unsigned URLs.
  }

  return null;
}

function shouldRefreshTrack(track: AudioTrack | null): boolean {
  if (!track || track.expiresAt === null) return false;
  return track.expiresAt <= Date.now() + SIGNED_URL_REFRESH_BUFFER_MS;
}

function toTrack(feed: FeedVO): AudioTrack {
  return {
    id: getFeedItemId(feed),
    url: feed.labels.podcast_url!,
    title: getTrackTitle(feed),
    link: feed.labels.link,
    feed,
    expiresAt: getTrackExpiryTime(feed.labels.podcast_url!),
  };
}

function createAudioPlayerStore() {
  const store = writable<AudioPlayerState>(initialState);
  const { subscribe, update, set } = store;

  function findTrackIndex(trackId: string, playlist: AudioTrack[]): number {
    return playlist.findIndex((t) => t.id === trackId);
  }

  function buildPlaylist(feeds: FeedVO[]): AudioTrack[] {
    return feeds.filter((feed) => feed.labels?.podcast_url).map(toTrack);
  }

  function mergePlaylistWithFeeds(
    state: AudioPlayerState,
    latestFeeds: FeedVO[],
  ): AudioPlayerState {
    const latestTracks = new Map(
      buildPlaylist(latestFeeds).map((track) => [track.id, track]),
    );
    const playlist = state.playlist.map(
      (track) => latestTracks.get(track.id) ?? track,
    );

    if (!state.currentTrack) {
      return { ...state, playlist };
    }

    const currentTrack =
      latestTracks.get(state.currentTrack.id) ??
      playlist.find((track) => track.id === state.currentTrack?.id) ??
      state.currentTrack;

    return {
      ...state,
      playlist,
      currentTrack,
    };
  }

  function getLatestQueryRequest(): QueryRequest | null {
    return get(lastQueryRequestStore) ?? get(queryFeedsStore)?.request ?? null;
  }

  async function refreshPlaylistFromLastQuery(force = false): Promise<boolean> {
    if (!browser) return false;

    const snapshot = get(store);
    if (!snapshot.currentTrack) return false;

    const needsRefresh =
      force || snapshot.playlist.some((track) => shouldRefreshTrack(track));
    if (!needsRefresh) return false;

    const request = getLatestQueryRequest();
    if (!request) return false;

    try {
      const response = await fetch(getTargetApiUrl("/query"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh audio URLs: ${response.status}`);
      }

      const data = (await response.json()) as {
        summary: string;
        feeds: FeedVO[];
        count: number;
      };

      const queryData = { ...data, request };
      lastQueryRequestStore.set(request);
      queryFeedsStore.set(queryData);
      update((state) => mergePlaylistWithFeeds(state, data.feeds));

      return true;
    } catch (error) {
      console.error("Failed to refresh podcast URLs:", error);
      return false;
    }
  }

  return {
    subscribe,
    startPlaying: (feed: FeedVO, allFeeds: FeedVO[]) => {
      update((state) => {
        if (!browser) return state;

        const playlist = buildPlaylist(allFeeds);

        const currentTrack =
          playlist.find((track) => track.id === getFeedItemId(feed)) ??
          toTrack(feed);

        return {
          ...state,
          currentTrack,
          playlist,
          isPlaying: true,
          isPlayerVisible: true,
          currentTime: 0,
          duration: 0,
        };
      });
    },
    refreshPlaylistIfNeeded: async (force = false) =>
      refreshPlaylistFromLastQuery(force),
    togglePlayPause: () => {
      if (!browser) return;
      update((state) => ({
        ...state,
        isPlaying: !state.isPlaying,
      }));
    },
    play: () => {
      if (!browser) return;
      update((state) => ({
        ...state,
        isPlaying: true,
      }));
    },
    pause: () => {
      if (!browser) return;
      update((state) => ({
        ...state,
        isPlaying: false,
      }));
    },
    syncPlaybackState: (isPlaying: boolean) => {
      if (!browser) return;
      update((state) => {
        if (state.isPlaying === isPlaying) return state;
        return {
          ...state,
          isPlaying,
        };
      });
    },
    playNext: () => {
      if (!browser) return;
      update((state) => {
        if (!state.currentTrack) return state;

        const currentIndex = findTrackIndex(
          state.currentTrack.id,
          state.playlist,
        );
        if (currentIndex === -1 || currentIndex >= state.playlist.length - 1) {
          return { ...state, isPlaying: false };
        }

        const nextTrack = state.playlist[currentIndex + 1];
        return {
          ...state,
          currentTrack: nextTrack,
          isPlaying: true,
          currentTime: 0,
          duration: 0,
        };
      });
    },
    playPrevious: () => {
      update((state) => {
        if (!browser) return state;
        if (!state.currentTrack) return state;

        const currentIndex = findTrackIndex(
          state.currentTrack.id,
          state.playlist,
        );
        if (currentIndex <= 0) {
          return state;
        }

        const previousTrack = state.playlist[currentIndex - 1];
        return {
          ...state,
          currentTrack: previousTrack,
          isPlaying: true,
          currentTime: 0,
          duration: 0,
        };
      });
    },
    updateTime: (currentTime: number, duration: number) => {
      update((state) => ({
        ...state,
        currentTime:
          Number.isFinite(currentTime) && currentTime >= 0
            ? currentTime
            : state.currentTime,
        duration:
          Number.isFinite(duration) && duration > 0 ? duration : state.duration,
      }));
    },
    closePlayer: () => {
      if (!browser) return;
      set(initialState);
    },
    _handleTrackEnd: () => {
      update((state) => {
        if (!state.currentTrack) return state;

        const currentIndex = findTrackIndex(
          state.currentTrack.id,
          state.playlist,
        );
        if (currentIndex === -1 || currentIndex >= state.playlist.length - 1) {
          return { ...state, isPlaying: false, currentTime: state.duration };
        }

        const nextTrack = state.playlist[currentIndex + 1];
        return {
          ...state,
          currentTrack: nextTrack,
          isPlaying: true,
          currentTime: 0,
          duration: 0,
        };
      });
    },
  };
}

export const audioPlayerStore = createAudioPlayerStore();

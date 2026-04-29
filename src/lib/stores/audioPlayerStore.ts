import { writable } from "svelte/store";
import type { FeedVO } from "$lib/types/feed";
import { getFeedItemId } from "$lib/utils/feedUtils";
import { browser } from "$app/environment";

export interface AudioTrack {
  id: string;
  url: string;
  title: string;
  link: string;
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

function getTrackTitle(feed: FeedVO): string {
  const source = feed.labels.source?.trim();
  const title = feed.labels.title?.trim() || "Untitled";

  return source ? `[${source}] ${title}` : title;
}

function toTrack(feed: FeedVO): AudioTrack {
  return {
    id: getFeedItemId(feed),
    url: feed.labels.podcast_url!,
    title: getTrackTitle(feed),
    link: feed.labels.link,
  };
}

function createAudioPlayerStore() {
  const { subscribe, update, set } = writable<AudioPlayerState>(initialState);

  function findTrackIndex(trackId: string, playlist: AudioTrack[]): number {
    return playlist.findIndex((t) => t.id === trackId);
  }

  return {
    subscribe,
    startPlaying: (feed: FeedVO, allFeeds: FeedVO[]) => {
      update((state) => {
        if (!browser) return state;

        const playlist = allFeeds
          .filter((f) => f.labels?.podcast_url)
          .map(toTrack);

        const currentTrack = toTrack(feed);

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

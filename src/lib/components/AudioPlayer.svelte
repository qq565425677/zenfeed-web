<script lang="ts">
  import { browser } from "$app/environment";
  import { onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { audioPlayerStore } from "$lib/stores/audioPlayerStore";

  type PlayerHandle = HTMLElement & {
    currentTime: number;
    duration: number;
    playbackRate: number;
    play(): Promise<void>;
    pause(): Promise<void> | void;
  };

  type MediaRateChangeEvent = Event & { detail: number };
  type MediaDurationChangeEvent = Event & { detail: number };
  type MediaTimeUpdateEvent = Event & {
    detail: { currentTime: number; played: TimeRanges };
  };

  const playbackRates = [1, 1.25, 1.5, 1.75, 2];
  const state = audioPlayerStore;

  let player: PlayerHandle;
  let activePlaybackRate = 1;
  let lastAppliedTrackId = "";
  let lastAppliedPlaybackIntent: boolean | null = null;

  $: currentTrackIndex = $state.currentTrack
    ? $state.playlist.findIndex((track) => track.id === $state.currentTrack?.id)
    : -1;

  $: hasPreviousTrack = currentTrackIndex > 0;
  $: hasNextTrack =
    currentTrackIndex !== -1 && currentTrackIndex < $state.playlist.length - 1;

  $: if (player && $state.currentTrack) {
    const trackChanged = lastAppliedTrackId !== $state.currentTrack.id;
    const playbackIntentChanged =
      lastAppliedPlaybackIntent !== $state.isPlaying;

    if (trackChanged || playbackIntentChanged) {
      lastAppliedTrackId = $state.currentTrack.id;
      lastAppliedPlaybackIntent = $state.isPlaying;

      if ($state.isPlaying) {
        safelyRunPlayerAction(player.play(), "Audio play failed:");
      } else {
        safelyRunPlayerAction(player.pause(), "Audio pause failed:");
      }
    }
  }

  $: if (browser && "mediaSession" in navigator) {
    if ($state.currentTrack) {
      updateMediaSession();
      navigator.mediaSession.playbackState = $state.isPlaying
        ? "playing"
        : "paused";
    } else {
      clearMediaSession();
    }
  }

  const unsubscribe = state.subscribe(() => {});

  onDestroy(() => {
    unsubscribe();
    clearMediaSession();
  });

  function safelyRunPlayerAction(
    result: Promise<void> | void,
    message: string,
  ) {
    if (result && typeof result.catch === "function") {
      result.catch((error: unknown) => {
        console.error(message, error);
      });
    }
  }

  function clearMediaSession() {
    if (!browser || !("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";

    for (const action of [
      "play",
      "pause",
      "previoustrack",
      "nexttrack",
      "seekbackward",
      "seekforward",
      "seekto",
      "stop",
    ] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // Some browsers do not support clearing every action.
      }
    }
  }

  function updateMediaSession() {
    if (!browser || !("mediaSession" in navigator) || !$state.currentTrack) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: $state.currentTrack.title,
      artist: "",
      album: "",
      artwork: [],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      state.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      state.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      state.playPrevious();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      state.playNext();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      if (!player) return;
      player.currentTime = Math.max(player.currentTime - 10, 0);
      syncPositionState();
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      if (!player) return;
      const duration = Number.isFinite(player.duration)
        ? player.duration
        : $state.duration;
      player.currentTime = Math.min(
        player.currentTime + 10,
        duration || Infinity,
      );
      syncPositionState();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (!player || details.seekTime === undefined) return;
      player.currentTime = details.seekTime;
      syncPositionState();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      state.closePlayer();
    });

    syncPositionState();
  }

  function syncPositionState() {
    if (
      !browser ||
      !("mediaSession" in navigator) ||
      !("setPositionState" in navigator.mediaSession)
    ) {
      return;
    }

    const duration = Number.isFinite(player?.duration)
      ? player.duration
      : $state.duration;
    const position = player?.currentTime ?? $state.currentTime;
    const playbackRate = player?.playbackRate ?? activePlaybackRate;

    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(position)
    ) {
      return;
    }

    try {
      navigator.mediaSession.setPositionState({
        duration,
        position,
        playbackRate,
      });
    } catch {
      // Ignore browsers with partial Media Session support.
    }
  }

  function handleTimeUpdate(event: MediaTimeUpdateEvent) {
    state.updateTime(
      event.detail.currentTime,
      player?.duration || $state.duration,
    );
    syncPositionState();
  }

  function handleDurationChange(event: MediaDurationChangeEvent) {
    state.updateTime(player?.currentTime || 0, event.detail || 0);
    syncPositionState();
  }

  function handleRateChange(event: MediaRateChangeEvent) {
    activePlaybackRate = event.detail;
    syncPositionState();
  }

  function handleLoadedMetadata() {
    if (!player) return;
    state.updateTime(player.currentTime || 0, player.duration || 0);
    if (Number.isFinite(player.playbackRate)) {
      activePlaybackRate = player.playbackRate;
    }
    syncPositionState();
  }

  function setPlaybackRate(rate: number) {
    activePlaybackRate = rate;
    if (player) {
      player.playbackRate = rate;
    }
  }
</script>

{#if $state.isPlayerVisible && $state.currentTrack}
  <div
    class="fixed inset-x-0 bottom-0 z-50 border-t border-base-300/70 bg-base-100/92 text-base-content shadow-[0_-18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl"
    transition:slide={{ duration: 280 }}
  >
    <div
      class="mx-auto w-full max-w-5xl px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 sm:px-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p
            class="line-clamp-2 text-sm font-semibold leading-5 text-base-content sm:text-base"
            title={$state.currentTrack.title}
          >
            {$state.currentTrack.title}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            {#if $state.currentTrack.link}
              <a
                href={$state.currentTrack.link}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost btn-xs rounded-full border border-base-300/80 px-3 text-base-content/70 hover:border-primary/40 hover:text-primary"
                aria-label="Open original article"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="h-3.5 w-3.5"
                >
                  <path
                    fill-rule="evenodd"
                    d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z"
                    clip-rule="evenodd"
                  />
                  <path
                    fill-rule="evenodd"
                    d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.19a.75.75 0 0 0 .053 1.06Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>Source</span>
              </a>
            {/if}

            <div class="hidden items-center gap-1 sm:flex">
              {#each playbackRates as rate}
                <button
                  type="button"
                  class={`btn btn-xs rounded-full px-2.5 ${
                    activePlaybackRate === rate
                      ? "btn-primary"
                      : "btn-ghost border border-base-300/80 text-base-content/65 hover:border-primary/40 hover:text-primary"
                  }`}
                  on:click={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            aria-label="Previous track"
            on:click={state.playPrevious}
            disabled={!hasPreviousTrack}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            aria-label="Next track"
            on:click={state.playNext}
            disabled={!hasNextTrack}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
              />
            </svg>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            aria-label="Close player"
            on:click={state.closePlayer}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      <media-player
        bind:this={player}
        class="zenfeed-vidstack-player mt-3"
        src={$state.currentTrack.url}
        title={$state.currentTrack.title}
        viewType="audio"
        playsinline
        preload="auto"
        autoplay={$state.isPlaying}
        on:play={() => state.syncPlaybackState(true)}
        on:pause={() => state.syncPlaybackState(false)}
        on:time-update={handleTimeUpdate}
        on:duration-change={handleDurationChange}
        on:loaded-metadata={handleLoadedMetadata}
        on:rate-change={handleRateChange}
        on:ended={state._handleTrackEnd}
        on:error={() =>
          console.error("Audio playback error for:", $state.currentTrack?.url)}
      >
        <media-outlet></media-outlet>

        <div class="zenfeed-player-frame">
          <media-time-slider class="zenfeed-time-slider"></media-time-slider>

          <div class="mt-4 flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <media-seek-button class="zenfeed-control-button" seconds={-10}
              ></media-seek-button>
              <media-play-button
                class="zenfeed-primary-button"
                default-appearance
              ></media-play-button>
              <media-seek-button class="zenfeed-control-button" seconds={10}
              ></media-seek-button>
            </div>

            <div class="hidden min-w-0 items-center gap-3 md:flex">
              <media-mute-button
                class="zenfeed-control-button"
                default-appearance
              ></media-mute-button>
              <media-volume-slider class="zenfeed-volume-slider"
              ></media-volume-slider>
            </div>
          </div>

          <div
            class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/60"
          >
            <div class="flex items-center gap-1 tabular-nums">
              <media-time type="current"></media-time>
              <span>/</span>
              <media-time type="duration"></media-time>
            </div>

            <div class="flex items-center gap-1 sm:hidden">
              {#each playbackRates as rate}
                <button
                  type="button"
                  class={`btn btn-xs rounded-full px-2 ${
                    activePlaybackRate === rate
                      ? "btn-primary"
                      : "btn-ghost border border-base-300/80 text-base-content/65 hover:border-primary/40 hover:text-primary"
                  }`}
                  on:click={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              {/each}
            </div>
          </div>
        </div>
      </media-player>
    </div>
  </div>
{/if}

<style>
  :global(.zenfeed-vidstack-player) {
    --media-focus-ring: 0 0 0 3px
      color-mix(in oklab, var(--color-primary) 55%, white);
    --media-font-family:
      ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    --media-time-color: color-mix(
      in oklab,
      var(--color-base-content) 65%,
      transparent
    );
    --media-slider-value-color: var(--color-base-content);
    --media-slider-track-bg: color-mix(
      in oklab,
      var(--color-base-content) 14%,
      transparent
    );
    --media-slider-track-fill-bg: var(--color-primary);
    --media-slider-thumb-bg: var(--color-base-100);
    --media-slider-thumb-border: 2px solid var(--color-primary);
    --media-slider-thumb-box-shadow: 0 6px 16px rgb(15 23 42 / 0.18);
    --media-button-icon-size: 18px;
    display: block;
  }

  :global(.zenfeed-vidstack-player media-outlet) {
    display: none;
  }

  :global(.zenfeed-player-frame) {
    border-radius: 1.25rem;
    border: 1px solid
      color-mix(in oklab, var(--color-base-300) 80%, transparent);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-base-100) 96%, white) 0%,
      color-mix(in oklab, var(--color-base-200) 70%, white) 100%
    );
    padding: 1rem;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.7);
  }

  :global(.zenfeed-time-slider) {
    display: block;
    width: 100%;
  }

  :global(.zenfeed-vidstack-player media-time-slider > shadow-root) {
    display: contents;
  }

  :global(.zenfeed-control-button),
  :global(.zenfeed-primary-button) {
    border-radius: 9999px;
  }

  :global(.zenfeed-control-button > shadow-root [slot]),
  :global(.zenfeed-primary-button > shadow-root [slot]) {
    display: inline-flex;
    height: 2.75rem;
    width: 2.75rem;
    align-items: center;
    justify-content: center;
    border: 1px solid
      color-mix(in oklab, var(--color-base-300) 80%, transparent);
    background: color-mix(in oklab, var(--color-base-100) 88%, white);
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
    box-shadow: 0 10px 20px rgb(15 23 42 / 0.06);
  }

  :global(.zenfeed-primary-button > shadow-root [slot]) {
    height: 3.25rem;
    width: 3.25rem;
    border-color: color-mix(in oklab, var(--color-primary) 38%, transparent);
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-primary) 88%, white),
      color-mix(in oklab, var(--color-primary) 70%, var(--color-secondary))
    );
    color: white;
    box-shadow: 0 16px 30px rgb(37 99 235 / 0.28);
  }

  :global(.zenfeed-volume-slider) {
    width: 7rem;
  }

  @media (max-width: 639px) {
    :global(.zenfeed-player-frame) {
      padding: 0.875rem;
    }

    :global(.zenfeed-control-button > shadow-root [slot]) {
      height: 2.5rem;
      width: 2.5rem;
    }

    :global(.zenfeed-primary-button > shadow-root [slot]) {
      height: 3rem;
      width: 3rem;
    }
  }
</style>

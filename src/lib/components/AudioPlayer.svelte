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

  const playbackRates = [1, 1.5];
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
      skipBy(-10);
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      skipBy(10);
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      const seekTime = details.seekTime;

      if (!player || typeof seekTime !== "number") return;
      player.currentTime = seekTime;
      state.updateTime(seekTime, getResolvedDuration());
      syncPositionState();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      state.closePlayer();
    });

    syncPositionState();
  }

  function getResolvedDuration(preferred?: number): number {
    for (const value of [preferred, player?.duration, $state.duration]) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
      }
    }

    return 0;
  }

  function getResolvedCurrentTime(preferred?: number): number {
    for (const value of [preferred, player?.currentTime, $state.currentTime]) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return value;
      }
    }

    return 0;
  }

  function syncPositionState() {
    if (
      !browser ||
      !("mediaSession" in navigator) ||
      !("setPositionState" in navigator.mediaSession)
    ) {
      return;
    }

    const duration = getResolvedDuration();
    const position = getResolvedCurrentTime();
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
    state.updateTime(event.detail.currentTime, getResolvedDuration());
    syncPositionState();
  }

  function handleDurationChange(event: MediaDurationChangeEvent) {
    state.updateTime(
      getResolvedCurrentTime(),
      getResolvedDuration(event.detail),
    );
    syncPositionState();
  }

  function handleRateChange(event: MediaRateChangeEvent) {
    activePlaybackRate = event.detail;
    syncPositionState();
  }

  function handleLoadedMetadata() {
    if (!player) return;
    state.updateTime(
      getResolvedCurrentTime(player.currentTime),
      getResolvedDuration(player.duration),
    );
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

  function skipBy(seconds: number) {
    if (!player) return;

    const duration = getResolvedDuration();
    const unclampedTime = getResolvedCurrentTime(player.currentTime) + seconds;
    const nextTime =
      duration > 0
        ? Math.max(0, Math.min(unclampedTime, duration))
        : Math.max(0, unclampedTime);

    player.currentTime = nextTime;
    state.updateTime(nextTime, duration);
    syncPositionState();
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
</script>

{#if $state.isPlayerVisible && $state.currentTrack}
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 text-base-content"
    transition:slide={{ duration: 280 }}
  >
    <div
      class="mx-auto w-full max-w-5xl px-3 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1.5 sm:px-4"
    >
      <div
        class="zenfeed-player-surface pointer-events-auto rounded-[0.95rem] px-2.5 py-3 sm:px-3"
      >
        <div class="flex items-center gap-2">
          <p
            class="line-clamp-1 min-w-0 flex-1 text-[1rem] font-semibold leading-tight tracking-[-0.01em] text-slate-700"
            title={$state.currentTrack.title}
          >
            {$state.currentTrack.title}
          </p>

          <button
            type="button"
            class="zenfeed-close-button"
            aria-label="Close player"
            on:click={state.closePlayer}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-[0.9rem] w-[0.9rem]"
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

        <media-player
          bind:this={player}
          class="zenfeed-vidstack-player mt-0.5"
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
            console.error(
              "Audio playback error for:",
              $state.currentTrack?.url,
            )}
        >
          <media-outlet></media-outlet>

          <div class="zenfeed-player-frame">
            <div class="flex items-center gap-1.5">
              <div
                class="shrink-0 whitespace-nowrap text-[1rem] font-medium leading-none text-base-content/55 tabular-nums"
              >
                {formatTime($state.currentTime)} / {formatTime($state.duration)}
              </div>

              <media-time-slider class="zenfeed-time-slider flex-1"
              ></media-time-slider>
            </div>

            <div class="mt-0.5 flex items-center gap-1.25 overflow-x-auto">
              <button
                type="button"
                class="zenfeed-icon-button"
                aria-label="Previous track"
                on:click={state.playPrevious}
                disabled={!hasPreviousTrack}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-[15px] w-[15px]"
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
                class="zenfeed-pill-button zenfeed-pill-button-subtle"
                aria-label="Seek backward 10 seconds"
                on:click={() => skipBy(-10)}
              >
                <span>-10</span>
              </button>

              <button
                type="button"
                class={`zenfeed-play-button ${$state.isPlaying ? "is-active" : ""}`}
                aria-label={$state.isPlaying ? "Pause" : "Play"}
                on:click={state.togglePlayPause}
              >
                {#if $state.isPlaying}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-[16px] w-[16px]"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M8 6.75A.75.75 0 0 1 8.75 6h2.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1-.75-.75V6.75Zm7 0A.75.75 0 0 1 15.75 6h2.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1-.75-.75V6.75Z"
                    />
                  </svg>
                {:else}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-[16px] w-[16px] translate-x-[1px]"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M8.72 6.204A1.25 1.25 0 0 0 6.75 7.25v9.5c0 .99 1.08 1.593 1.97 1.046l8.084-4.75a1.25 1.25 0 0 0 0-2.092L8.72 6.204Z"
                    />
                  </svg>
                {/if}
              </button>

              <button
                type="button"
                class="zenfeed-pill-button zenfeed-pill-button-subtle"
                aria-label="Seek forward 10 seconds"
                on:click={() => skipBy(10)}
              >
                <span>+10</span>
              </button>

              <button
                type="button"
                class="zenfeed-icon-button"
                aria-label="Next track"
                on:click={state.playNext}
                disabled={!hasNextTrack}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-[15px] w-[15px]"
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

              <div
                class="ml-0.5 flex items-center gap-1.25 border-l border-base-300/50 pl-2"
              >
                {#each playbackRates as rate}
                  <button
                    type="button"
                    class={`zenfeed-pill-button ${
                      activePlaybackRate === rate
                        ? "zenfeed-pill-button-active"
                        : "zenfeed-pill-button-muted"
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
  </div>
{/if}

<style>
  :global(.zenfeed-player-surface) {
    position: relative;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--color-base-300) 55%, white);
    background: rgb(255 255 255 / 0.08);
    box-shadow:
      0 10px 24px rgb(15 23 42 / 0.06),
      inset 0 1px 0 rgb(255 255 255 / 0.24);
    backdrop-filter: blur(22px) saturate(1.12);
    -webkit-backdrop-filter: blur(22px) saturate(1.12);
    isolation: isolate;
  }

  :global(.zenfeed-player-surface::before) {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 0.14), transparent 42%),
      radial-gradient(
        72% 130% at 0% 50%,
        rgb(255 255 255 / 0.18),
        transparent 62%
      ),
      radial-gradient(
        72% 130% at 100% 50%,
        rgb(255 255 255 / 0.18),
        transparent 62%
      );
  }

  :global(.zenfeed-vidstack-player) {
    --media-focus-ring: 0 0 0 3px
      color-mix(in oklab, var(--color-primary) 55%, white);
    --media-slider-track-bg: color-mix(
      in oklab,
      var(--color-base-content) 10%,
      transparent
    );
    --media-slider-track-fill-bg: var(--color-primary);
    --media-slider-thumb-bg: white;
    --media-slider-thumb-border: 1.5px solid
      color-mix(in oklab, var(--color-primary) 84%, white);
    --media-slider-thumb-box-shadow: 0 3px 8px rgb(37 99 235 / 0.14);
    display: block;
  }

  :global(.zenfeed-vidstack-player media-outlet) {
    display: none;
  }

  :global(.zenfeed-player-frame) {
    position: relative;
    z-index: 1;
  }

  :global(.zenfeed-time-slider) {
    display: block;
    width: 100%;
  }

  :global(.zenfeed-vidstack-player media-time-slider > shadow-root) {
    display: contents;
  }

  :global(.zenfeed-close-button) {
    display: inline-flex;
    height: 1.7rem;
    width: 1.7rem;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 9999px;
    border: 1px solid color-mix(in oklab, var(--color-base-300) 55%, white);
    background: rgb(255 255 255 / 0.26);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
    box-shadow: 0 3px 10px rgb(15 23 42 / 0.025);
    transition:
      transform 140ms ease,
      box-shadow 140ms ease,
      color 140ms ease;
  }

  :global(.zenfeed-close-button:hover) {
    transform: translateY(-1px);
    color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
    box-shadow: 0 5px 12px rgb(15 23 42 / 0.04);
  }

  :global(.zenfeed-icon-button) {
    display: inline-flex;
    height: 3rem;
    width: 3rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1px solid color-mix(in oklab, var(--color-base-300) 55%, white);
    background: linear-gradient(
      180deg,
      rgb(255 255 255 / 0.34),
      rgb(246 248 252 / 0.2)
    );
    color: color-mix(in oklab, var(--color-base-content) 76%, transparent);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.38),
      0 4px 12px rgb(15 23 42 / 0.025);
    transition:
      transform 140ms ease,
      box-shadow 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  :global(.zenfeed-icon-button:hover:not(:disabled)) {
    transform: translateY(-1px);
    border-color: color-mix(in oklab, var(--color-primary) 25%, white);
    color: color-mix(in oklab, var(--color-primary) 78%, black);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.44),
      0 5px 12px rgb(15 23 42 / 0.04);
  }

  :global(.zenfeed-icon-button:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(.zenfeed-pill-button) {
    display: inline-flex;
    height: 2.8rem;
    min-width: 3.2rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1px solid color-mix(in oklab, var(--color-base-300) 55%, white);
    padding: 0 0.72rem;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    transition:
      transform 140ms ease,
      box-shadow 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      background-color 140ms ease;
  }

  :global(.zenfeed-pill-button:hover) {
    transform: translateY(-1px);
  }

  :global(.zenfeed-pill-button-subtle) {
    background: rgb(255 255 255 / 0.22);
    color: color-mix(in oklab, var(--color-base-content) 68%, transparent);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4);
  }

  :global(.zenfeed-pill-button-subtle:hover) {
    border-color: color-mix(in oklab, var(--color-primary) 25%, white);
    color: color-mix(in oklab, var(--color-primary) 78%, black);
  }

  :global(.zenfeed-pill-button-muted) {
    background: rgb(255 255 255 / 0.18);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.34);
  }

  :global(.zenfeed-pill-button-muted:hover) {
    border-color: color-mix(in oklab, var(--color-primary) 25%, white);
    color: color-mix(in oklab, var(--color-primary) 78%, black);
  }

  :global(.zenfeed-pill-button-active) {
    border-color: color-mix(in oklab, var(--color-primary) 22%, white);
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-primary) 94%, white),
      color-mix(in oklab, var(--color-primary) 72%, var(--color-secondary))
    );
    color: white;
    box-shadow: 0 6px 12px rgb(37 99 235 / 0.14);
  }

  :global(.zenfeed-play-button) {
    display: inline-flex;
    height: 3rem;
    width: 3rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1px solid color-mix(in oklab, var(--color-primary) 22%, white);
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-primary) 94%, white),
      color-mix(in oklab, var(--color-primary) 72%, var(--color-secondary))
    );
    color: white;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.16),
      0 7px 13px rgb(37 99 235 / 0.13);
    transition:
      transform 140ms ease,
      box-shadow 140ms ease,
      filter 140ms ease;
  }

  :global(.zenfeed-play-button:hover) {
    transform: translateY(-1px) scale(1.01);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.18),
      0 9px 15px rgb(37 99 235 / 0.15);
    filter: saturate(1.05);
  }

  :global(.zenfeed-play-button.is-active) {
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-primary) 88%, white),
      color-mix(in oklab, var(--color-primary) 68%, var(--color-secondary))
    );
  }

  :global(.zenfeed-vidstack-player media-time-slider [part~="track"]) {
    height: 0.32rem;
    border-radius: 9999px;
  }

  :global(.zenfeed-vidstack-player media-time-slider [part~="track-fill"]) {
    border-radius: 9999px;
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--color-primary) 94%, white),
      color-mix(in oklab, var(--color-primary) 74%, var(--color-secondary))
    );
  }

  :global(.zenfeed-vidstack-player media-time-slider [part="thumb"]) {
    width: 0.58rem;
    height: 0.58rem;
  }

  @media (max-width: 639px) {
    :global(.zenfeed-player-surface) {
      border-radius: 0.9rem;
    }

    :global(.zenfeed-icon-button) {
      height: 3rem;
      width: 3rem;
    }

    :global(.zenfeed-pill-button) {
      height: 2.8rem;
      min-width: 3.2rem;
      padding: 0 0.72rem;
      font-size: 1rem;
    }

    :global(.zenfeed-play-button) {
      height: 3rem;
      width: 3rem;
    }
  }
</style>

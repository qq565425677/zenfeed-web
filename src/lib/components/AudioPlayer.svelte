<script lang="ts">
    import { audioPlayerStore } from "$lib/stores/audioPlayerStore";
    import { onDestroy } from "svelte";
    import { slide } from "svelte/transition";
    import { browser } from "$app/environment";

    let audio: HTMLAudioElement;
    let progressTrack: HTMLButtonElement;
    let progressPercent = 0;

    const state = audioPlayerStore;

    $: if (
        audio &&
        $state.currentTrack?.url &&
        audio.src !== $state.currentTrack.url
    ) {
        audio.src = $state.currentTrack.url;
        if ($state.isPlaying) {
            audio.play().catch((e) => console.error("Audio play failed:", e));
        }
    }

    $: if (audio) {
        if ($state.isPlaying) {
            audio
                .play()
                .catch((e) => console.error("Audio play failed on toggle:", e));
        } else {
            audio.pause();
        }
    }

    $: if (browser && "mediaSession" in navigator && $state.currentTrack) {
        updateMediaSession();
    }

    function updateMediaSession() {
        if (!browser || !("mediaSession" in navigator) || !$state.currentTrack)
            return;

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

        navigator.mediaSession.setActionHandler("stop", () => {
            state.closePlayer();
        });

        navigator.mediaSession.setActionHandler("seekto", (details) => {
            if (audio && details.seekTime !== undefined) {
                audio.currentTime = details.seekTime;
                state.updateTime(details.seekTime, audio.duration || $state.duration);
            }
        });
    }

    $: if (browser && "mediaSession" in navigator) {
        navigator.mediaSession.playbackState = $state.isPlaying
            ? "playing"
            : "paused";
    }

    $: progressPercent =
        $state.duration > 0
            ? Math.min(
                  Math.max(($state.currentTime / $state.duration) * 100, 0),
                  100,
              )
            : 0;

    function formatTime(seconds: number): string {
        if (isNaN(seconds) || seconds < 0) return "0:00";
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    }

    function handleSeek(event: MouseEvent) {
        if (!progressTrack || !$state.duration) return;
        const { left, width } = progressTrack.getBoundingClientRect();
        const clickX = event.clientX - left;
        const seekRatio = Math.min(Math.max(clickX / width, 0), 1);
        const seekTime = seekRatio * $state.duration;
        audio.currentTime = seekTime;
        state.updateTime(seekTime, audio.duration || $state.duration);
    }

    const unsubscribe = state.subscribe(() => {});

    onDestroy(unsubscribe);
</script>

{#if $state.isPlayerVisible}
    <div
        class="fixed inset-x-0 bottom-0 z-50 border-t border-base-300/70 bg-base-100/90 text-base-content shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur-md"
        transition:slide={{ duration: 300 }}
    >
        <div class="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3">
            <div class="flex items-center gap-3">
                <button
                    type="button"
                    class="btn btn-ghost btn-sm btn-circle shrink-0"
                    aria-label="Close player"
                    on:click={state.closePlayer}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        /></svg
                    >
                </button>

                <button
                    bind:this={progressTrack}
                    type="button"
                    class="relative h-4 flex-1 cursor-pointer"
                    aria-label="Seek playback position"
                    on:click={handleSeek}
                >
                    <span
                        class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-base-300"
                    ></span>
                    <span
                        class="pointer-events-none absolute left-0 top-1/2 block h-1 -translate-y-1/2 rounded-full bg-primary transition-[width] duration-150"
                        style:width={`${progressPercent}%`}
                    ></span>
                    {#if $state.duration}
                        <span
                            class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base-100 bg-primary shadow-sm transition-[left] duration-150"
                            style:left={`${progressPercent}%`}
                        ></span>
                    {/if}
                </button>
            </div>

            <div class="flex items-end gap-4">
                <div class="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                    <div class="flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            class="btn btn-ghost btn-sm btn-circle"
                            aria-label="Previous track"
                            on:click={state.playPrevious}
                            disabled={!$state.currentTrack ||
                                $state.playlist.findIndex(
                                    (t) => t.id === $state.currentTrack?.id,
                                ) <= 0}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-6 w-6"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                                /></svg
                            >
                        </button>

                        <button
                            type="button"
                            class="btn btn-primary btn-sm btn-circle"
                            aria-label={$state.isPlaying ? "Pause" : "Play"}
                            on:click={state.togglePlayPause}
                            disabled={!$state.currentTrack}
                        >
                            {#if $state.isPlaying}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-6 w-6"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M10 9v6m4-6v6"
                                    /></svg
                                >
                            {:else}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-6 w-6"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                    /><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    /></svg
                                >
                            {/if}
                        </button>

                        <button
                            type="button"
                            class="btn btn-ghost btn-sm btn-circle"
                            aria-label="Next track"
                            on:click={state.playNext}
                            disabled={!$state.currentTrack ||
                                $state.playlist.findIndex(
                                    (t) => t.id === $state.currentTrack?.id,
                                ) >=
                                    $state.playlist.length - 1}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-6 w-6"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                                /></svg
                            >
                        </button>
                    </div>

                    <div class="min-w-0 flex-1">
                        {#if $state.currentTrack}
                            <p
                                class="truncate text-sm font-semibold md:text-base"
                                title={$state.currentTrack.title}
                            >
                                {$state.currentTrack.title}
                            </p>
                            <div class="mt-1 text-xs opacity-70">
                                <span>{formatTime($state.currentTime)}</span> /
                                <span>{formatTime($state.duration)}</span>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

<audio
    bind:this={audio}
    on:play={() => state.syncPlaybackState(true)}
    on:pause={() => state.syncPlaybackState(false)}
    on:timeupdate={() =>
        audio && state.updateTime(audio.currentTime, audio.duration)}
    on:seeked={() => audio && state.updateTime(audio.currentTime, audio.duration)}
    on:loadedmetadata={() =>
        audio && state.updateTime(audio.currentTime, audio.duration)}
    on:ended={state._handleTrackEnd}
    on:error={() => console.error("Audio playback error for:", audio?.src)}
    preload="auto"
></audio>

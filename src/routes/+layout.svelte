<script lang="ts">
  import "../app.css";
  import "$lib/i18n"; // Initialize svelte-i18n
  import { locale, waitLocale } from "svelte-i18n";
  import { browser } from "$app/environment";
  import AudioPlayer from "$lib/components/AudioPlayer.svelte";
  import { audioPlayerStore } from "$lib/stores/audioPlayerStore";
  let { children } = $props();
  let isLocaleLoading = $state(true); // State to track loading

  // If server-side rendering, set the locale from the server
  // This example assumes you might pass the initial locale via `load` function
  // Or you might simply rely on client-side detection via `initialLocale: getLocaleFromNavigator()` in i18n.ts
  if (browser) {
    locale.set(window.navigator.language || "en"); // Simple browser language detection
    void import("vidstack/elements").then(({ defineCustomElements }) =>
      defineCustomElements(),
    );
  } else {
    // Handle server-side locale if necessary (e.g., from request headers)
    // For simplicity, we'll stick to the default/fallback for SSR here
    locale.set("en");
  }

  // Use $effect to wait for the locale to load
  $effect(() => {
    isLocaleLoading = true; // Set loading true when effect runs (e.g., on locale change)
    waitLocale()
      .then(() => {
        isLocaleLoading = false; // Set loading false once locale is loaded
      })
      .catch((error) => {
        console.error("Error loading locale:", error);
        isLocaleLoading = false; // Also stop loading on error
      });
  });
</script>

{#if isLocaleLoading}
  <!-- Optional: Show a loading indicator while the locale loads -->
  <!-- <div>Loading language...</div> -->
{:else}
  <div
    class={`transition-[padding] duration-300 ease-out ${$audioPlayerStore.isPlayerVisible ? "pb-[calc(13.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(12rem+env(safe-area-inset-bottom))]" : ""}`}
  >
    {@render children()}
  </div>
  <AudioPlayer />
{/if}

<style>
  /* Add global styles if needed */
</style>

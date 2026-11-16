<script lang="ts">
  import type { View } from '../lib/views';
  import { MANUAL_TABS, TABS } from '../lib/views';
  let { view, onselect, manual = false, readonly = false }: { view: View; onselect: (v: View) => void; manual?: boolean; readonly?: boolean } = $props();
  // a read-only game has no input screen
  const tabs = $derived(manual ? MANUAL_TABS.filter(([k]) => !readonly || k !== 'score') : TABS);
</script>

<nav class="tabs">
  {#each tabs as [k, l]}<button data-v={k} class:on={view === k} onclick={() => onselect(k)}>{l}</button>{/each}
</nav>

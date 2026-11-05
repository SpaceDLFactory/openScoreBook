<script lang="ts">
  import type { View } from '../lib/views';
  import { MANUAL_TABS, TABS } from '../lib/views';
  let { view, onselect, manual = false }: { view: View; onselect: (v: View) => void; manual?: boolean } = $props();
  const tabs = $derived(manual ? MANUAL_TABS : TABS);
</script>

<nav class="tabs">
  {#each tabs as [k, l]}<button data-v={k} class:on={view === k} onclick={() => onselect(k)}>{l}</button>{/each}
</nav>

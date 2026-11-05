<script lang="ts">
  import type { View } from '../lib/views';
  import { TABS } from '../lib/views';
  let { view, onselect }: { view: View; onselect: (v: View) => void } = $props();
</script>

<nav class="tabs">
  {#each TABS as [k, l]}<button data-v={k} class:on={view === k} onclick={() => onselect(k)}>{l}</button>{/each}
</nav>

<script setup lang="ts">
// The page to review: type its address (/pricing/), or paste one, and press Enter.
import { ref, watch } from "vue";
import { normalizePath, openPage, state } from "../lib/state.ts";

const text = ref(state.path);
const invalid = ref(false);

watch(() => state.path, (path) => {
  text.value = path;
  invalid.value = false;
});

function go(event: Event): void {
  const path = normalizePath(text.value);
  invalid.value = path === null;
  if (path === null) return;
  (event.target as HTMLInputElement).blur();
  void openPage(state.lang, path);
}

// What was typed and not opened is not kept.
function leave(): void {
  text.value = state.path;
  invalid.value = false;
}
</script>

<template>
  <div class="picker">
    <input
      v-model="text"
      class="picker-input"
      :class="{ invalid }"
      aria-label="Page"
      :aria-invalid="invalid"
      autocomplete="off"
      spellcheck="false"
      :placeholder="state.lang ? 'Page, like /pricing/' : 'Pick a language first'"
      :disabled="!state.lang"
      @keydown.enter.prevent="go"
      @blur="leave"
    />
  </div>
</template>

<script setup lang="ts">
// A searchable list of every translated page.
import { computed, ref } from "vue";
import { notesOnPage, openPage, state } from "../lib/state.ts";

const open = ref(false);
const query = ref("");
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  return (state.manifest?.pages ?? []).filter((path) => !q || path.toLowerCase().includes(q)).slice(0, 300);
});

function show(): void {
  open.value = true;
  query.value = "";
  active.value = Math.max(0, results.value.indexOf(state.path));
}

function choose(path: string): void {
  open.value = false;
  query.value = "";
  input.value?.blur();
  if (path) void openPage(state.lang, path);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = Math.min(results.value.length - 1, active.value + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(0, active.value - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (results.value[active.value]) choose(results.value[active.value]);
  } else if (event.key === "Escape") {
    open.value = false;
    input.value?.blur();
  }
}

const noteCount = (path: string) => notesOnPage(state.lang, path).length;
</script>

<template>
  <div class="picker">
    <input
      ref="input"
      class="picker-input"
      role="combobox"
      aria-label="Page"
      aria-controls="page-list"
      :aria-expanded="open"
      autocomplete="off"
      spellcheck="false"
      :placeholder="state.lang ? 'Search pages…' : 'Pick a language first'"
      :disabled="!state.lang"
      :value="open ? query : state.path"
      @focus="show"
      @blur="open = false"
      @input="query = ($event.target as HTMLInputElement).value; active = 0; open = true"
      @keydown="onKeydown"
    />
    <ul v-if="open" id="page-list" class="picker-list" role="listbox">
      <li
        v-for="(path, i) in results"
        :key="path"
        role="option"
        :aria-selected="path === state.path"
        :class="{ active: i === active, current: path === state.path }"
        @mousedown.prevent="choose(path)"
        @mousemove="active = i"
      >
        <span>{{ path }}</span>
        <span v-if="noteCount(path)" class="badge" :title="`${noteCount(path)} notes`">{{ noteCount(path) }}</span>
      </li>
      <li v-if="!results.length" class="none">No page matches “{{ query }}”.</li>
    </ul>
  </div>
</template>

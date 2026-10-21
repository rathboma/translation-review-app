<script setup lang="ts">
// Text that can't be selected on the page: the title, the description search
// engines show, image descriptions, tooltips and structured data.
import { computed, ref } from "vue";
import type { AnnotatedPage, Segment } from "../../shared/types.ts";
import { currentOf, draftFor, noteFor, openEditor, state } from "../lib/state.ts";
import ChipText from "./ChipText.vue";

const props = defineProps<{ page: AnnotatedPage }>();
const query = ref("");

const hidden = computed(() => props.page.segments.filter((s) => s.kind === "attr" || s.kind === "head"));
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return hidden.value.filter((s) => !q || `${s.where} ${s.key} ${currentOf(s)}`.toLowerCase().includes(q));
});

function pick(segment: Segment): void {
  openEditor({ draft: draftFor(segment), origin: "drawer", anchor: null, preselect: null });
}

const kindLabel = (s: Segment) => (s.kind === "head" ? "Page head" : "Attribute");
</script>

<template>
  <aside class="drawer" aria-label="Hidden text">
    <header class="drawer-head">
      <h2>Hidden text</h2>
      <button class="icon" type="button" aria-label="Close" @click="state.drawer = false">×</button>
    </header>
    <p class="muted">
      Text that isn't in the page itself: its title, the description search engines show, image descriptions, tooltips and structured data.
    </p>
    <input v-model="query" class="drawer-filter" type="search" placeholder="Filter…" aria-label="Filter hidden text" />
    <ul class="hidden-list">
      <li v-for="segment in shown" :key="segment.id">
        <button type="button" :data-seg="segment.id" @click="pick(segment)">
          <span class="hidden-kind">{{ kindLabel(segment) }} · {{ segment.where }}</span>
          <span class="hidden-en"><ChipText :text="segment.key" /></span>
          <span class="hidden-now"><ChipText :text="currentOf(segment)" /></span>
          <span v-if="noteFor(state.lang, state.path, segment.scope, segment.key)" class="tag noted">has a note</span>
        </button>
      </li>
      <li v-if="!shown.length" class="empty">{{ hidden.length ? "Nothing matches." : "This page has no hidden text." }}</li>
    </ul>
  </aside>
</template>

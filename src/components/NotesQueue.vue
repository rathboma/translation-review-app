<script setup lang="ts">
// Every note the reviewer has written, across pages and languages. Each can be
// edited or deleted; what is wrong with one (the lint's verdict, or what the
// server refused it for) is shown next to it.
import { computed, ref } from "vue";
import { scopeLabel } from "../../shared/apply.ts";
import type { Note } from "../../shared/types.ts";
import { deleteNote, draftOfNote, openEditor, openPage, problemsFor, state } from "../lib/state.ts";
import ChipText from "./ChipText.vue";

const emit = defineEmits<{ submit: [] }>();

const count = computed(() => state.notes.length);
const broken = computed(() => state.notes.filter((n) => problemsFor(n).errors.length).length);
const confirming = ref<string | null>(null);

function edit(note: Note): void {
  openEditor({ draft: draftOfNote(note), origin: "queue", anchor: null, preselect: null });
}

function remove(note: Note): void {
  if (confirming.value !== note.id) {
    confirming.value = note.id;
    setTimeout(() => confirming.value === note.id && (confirming.value = null), 3000);
    return;
  }
  confirming.value = null;
  deleteNote(note.id);
}

const language = (code: string) => state.manifest?.languages[code]?.label ?? code;
</script>

<template>
  <section class="queue" :class="{ open: state.queueOpen }" aria-label="Notes">
    <header class="queue-head">
      <button class="toggle" type="button" :aria-expanded="state.queueOpen" @click="state.queueOpen = !state.queueOpen">
        <span class="caret" aria-hidden="true">{{ state.queueOpen ? "▾" : "▸" }}</span> Notes <span class="badge">{{ count }}</span>
      </button>
      <span v-if="broken" class="error-count">{{ broken }} to fix</span>
      <span class="spacer"></span>
      <button class="primary" type="button" :disabled="!count" @click="emit('submit')">Submit {{ count }} note{{ count === 1 ? "" : "s" }}</button>
    </header>
    <div v-if="state.queueOpen" class="queue-body">
      <p v-if="!count" class="empty">No notes yet. Select some text on either page, or click a paragraph, to write one.</p>
      <ol v-else class="notes">
        <li v-for="note in state.notes" :key="note.id" class="note" :class="{ bad: problemsFor(note).errors.length }" :data-note="note.id">
          <div class="note-where">
            <span class="lang">{{ language(note.lang) }}</span>
            <button class="link" type="button" :title="`Open ${note.path}`" @click="openPage(note.lang, note.path)">{{ note.path }}</button>
            <span class="muted">{{ note.where }}</span>
            <span v-if="note.scope" class="tag">{{ scopeLabel(note.scope) }}</span>
          </div>
          <dl class="note-text">
            <dt>English</dt>
            <dd><ChipText :text="note.key" :html="note.kind === 'html'" /></dd>
            <dt>Now</dt>
            <dd><ChipText :text="note.current" :html="note.kind === 'html'" /></dd>
            <dt>New</dt>
            <dd class="new"><ChipText :text="note.new" :html="note.kind === 'html'" /></dd>
            <template v-if="note.comment">
              <dt>Comment</dt>
              <dd>{{ note.comment }}</dd>
            </template>
          </dl>
          <ul v-if="problemsFor(note).errors.length || problemsFor(note).warnings.length" class="problems">
            <li v-for="e in problemsFor(note).errors" :key="e" class="error">{{ e }}</li>
            <li v-for="w in problemsFor(note).warnings" :key="w" class="warning">{{ w }}</li>
          </ul>
          <div class="note-actions">
            <button type="button" @click="edit(note)">Edit</button>
            <button class="danger" type="button" @click="remove(note)">{{ confirming === note.id ? "Really delete?" : "Delete" }}</button>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

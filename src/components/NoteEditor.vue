<script setup lang="ts">
// The note editor: the segment's English and current translation, where it is,
// a text box for the whole new translation and an optional comment. It opens
// next to the segment on a page, centered when it comes from a list.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { normalize } from "../../vendor/translate/text.ts";
import { scopeLabel } from "../../shared/apply.ts";
import { closeEditor, deleteNote, languageLabel, saveNote, state, verdict as check, type Draft, type Editing } from "../lib/state.ts";
import ChipEditor from "./ChipEditor.vue";
import ChipText from "./ChipText.vue";

const props = defineProps<{ editing: Editing }>();

const draft = reactive<Draft>({ ...props.editing.draft });
const html = draft.kind === "html";
const card = ref<HTMLElement | null>(null);
const editor = ref<InstanceType<typeof ChipEditor> | null>(null);
const confirmDelete = ref(false);

const language = computed(() => languageLabel(draft.lang));
// The copy has the English there.
const untranslated = computed(() => draft.current === draft.key);
const verdict = computed(() => check(draft));
// Keeping the English is an answer for a string the copy has not translated.
const changed = computed(() => normalize(draft.new) !== draft.current || untranslated.value);
const canSave = computed(() => changed.value && verdict.value.errors.length === 0);
const keepsEnglish = computed(() => untranslated.value && normalize(draft.new) === draft.current);

const WIDTH = 480;

// Beside the segment, over the other page; a list's note is in the middle.
const style = computed(() => {
  const anchor = props.editing.anchor;
  if (!anchor || props.editing.origin === "queue" || props.editing.origin === "drawer") return {};
  const w = window.innerWidth;
  const h = window.innerHeight;
  const left = anchor.side === "english" ? Math.min(w - WIDTH - 16, w / 2 + 16) : Math.max(16, w / 2 - WIDTH - 16);
  const top = Math.min(Math.max(60, anchor.top - 12), Math.max(60, h - 520));
  return { left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, maxHeight: `${h - top - 16}px` };
});
const centered = computed(() => props.editing.origin === "queue" || props.editing.origin === "drawer" || !props.editing.anchor);

const preselect = computed(() => {
  if (props.editing.origin === "translated" && props.editing.preselect) return props.editing.preselect;
  // From the English page, or a click, or a list: the whole translation.
  return "all" as const;
});

// Typed in, and not saved: a click on the backdrop must not throw it away (Escape and Cancel do, on purpose).
const dirty = computed(() => normalize(draft.new) !== normalize(props.editing.draft.new) || draft.comment !== props.editing.draft.comment);
const backdrop = () => !dirty.value && closeEditor();

function save(): void {
  if (!canSave.value) return;
  saveNote(draft);
  closeEditor();
}

// Back to the current translation, with the caret in the text box to carry on.
async function reset(): Promise<void> {
  draft.new = draft.current;
  await nextTick();
  editor.value?.focus();
}

function remove(): void {
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    setTimeout(() => (confirmDelete.value = false), 3000);
    return;
  }
  deleteNote(draft.id!);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeEditor();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    save();
  }
}

onMounted(() => card.value?.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => card.value?.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="editor-layer" :class="{ modal: centered }" @mousedown.self="backdrop">
    <section ref="card" class="editor" :class="{ centered }" :style="style" role="dialog" aria-label="Note" aria-modal="false">
      <header class="editor-head">
        <div>
          <strong>{{ language }}</strong>
          <span class="path">{{ draft.path }}</span>
        </div>
        <button class="icon" type="button" aria-label="Close" @click="closeEditor">×</button>
      </header>
      <p class="where">{{ draft.where }}</p>
      <p v-if="draft.scope" class="notice scope">This text is in {{ scopeLabel(draft.scope) }}: a change applies on every page.</p>
      <p v-if="untranslated" class="notice">The copy still has English here: there is no translation yet.</p>

      <div class="field">
        <span class="label">English</span>
        <div class="readonly" lang="en"><ChipText :text="draft.key" :html="html" /></div>
      </div>
      <div class="field">
        <span class="label">{{ untranslated ? "Now (English)" : "Current translation" }}</span>
        <div class="readonly"><ChipText :text="draft.current" :html="html" /></div>
      </div>
      <div class="field">
        <span class="label">New translation</span>
        <ChipEditor ref="editor" v-model="draft.new" :html="html" :preselect="preselect" label="New translation" />
        <p v-if="html && /</.test(draft.current + draft.key)" class="hint">Links and formatting are the grey tags: drag one to move it (or select it and press Alt+arrow). They can't be deleted.</p>
        <button class="link reset" type="button" @click="reset">Start again from the current translation</button>
      </div>

      <ul v-if="verdict.errors.length || verdict.warnings.length" class="verdict">
        <li v-for="e in verdict.errors" :key="e" class="error">{{ e }}</li>
        <li v-for="w in verdict.warnings" :key="w" class="warning">{{ w }}</li>
      </ul>

      <div class="field">
        <label class="label" for="note-comment">Comment (optional)</label>
        <textarea id="note-comment" v-model="draft.comment" rows="2" maxlength="5000" placeholder="Too formal, wrong term for…"></textarea>
      </div>

      <footer class="editor-foot">
        <button v-if="draft.id" class="danger" type="button" @click="remove">{{ confirmDelete ? "Really delete?" : "Delete note" }}</button>
        <span class="spacer"></span>
        <button type="button" @click="closeEditor">Cancel</button>
        <button class="primary" type="button" :disabled="!canSave" @click="save">{{ keepsEnglish ? "Keep the English" : draft.id ? "Update note" : "Save note" }}</button>
      </footer>
    </section>
  </div>
</template>

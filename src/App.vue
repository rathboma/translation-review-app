<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import HiddenDrawer from "./components/HiddenDrawer.vue";
import NoteEditor from "./components/NoteEditor.vue";
import NotesQueue from "./components/NotesQueue.vue";
import PagePicker from "./components/PagePicker.vue";
import SignIn from "./components/SignIn.vue";
import SplitView from "./components/SplitView.vue";
import SubmitDialog from "./components/SubmitDialog.vue";
import { closeEditor, draftFor, loadManifest, openEditor, openPage, openSubmit, signOut, startingPlace, state, type Anchor } from "./lib/state.ts";

const notice = ref("");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const languages = computed(() => Object.entries(state.manifest?.languages ?? {}));
const label = computed(() => state.manifest?.languages[state.lang]?.label ?? state.lang);
const hiddenCount = computed(() => state.page?.segments.filter((s) => s.kind === "attr" || s.kind === "head").length ?? 0);
const selectedId = computed(() => {
  const draft = state.editing?.draft;
  if (!draft || !state.page || draft.lang !== state.lang || draft.path !== state.path) return null;
  return state.page.segments.find((s) => s.scope === draft.scope && s.key === draft.key)?.id ?? null;
});

function say(message: string): void {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ""), 4000);
}

function onPick(pick: { id: string; side: "english" | "translated"; selection: { text: string; hint: number } | null; anchor: Anchor }): void {
  const segment = state.page?.segments.find((s) => s.id === pick.id);
  if (!segment) return;
  openEditor({ draft: draftFor(segment), origin: pick.side, anchor: pick.anchor, preselect: pick.selection });
}

function chooseLanguage(event: Event): void {
  const lang = (event.target as HTMLSelectElement).value;
  // The same page in the other language, if it is a page there.
  void openPage(lang, state.path);
}

async function start(): Promise<void> {
  await loadManifest();
  if (!state.manifest) return;
  const place = startingPlace(location.search);
  await openPage(place.lang, place.path);
}

const retry = start;
onMounted(start);

// A page left behind takes its editor with it.
watch(() => state.path, () => closeEditor());
</script>

<template>
  <SignIn v-if="!state.reviewer" />
  <div v-else class="app">
    <header class="bar">
      <span class="brand"><span class="hex" aria-hidden="true"></span> Translation review</span>
      <select class="lang-select" aria-label="Language" :value="state.lang" :disabled="!languages.length" @change="chooseLanguage">
        <option value="" disabled>Language…</option>
        <option v-for="[code, language] in languages" :key="code" :value="code">{{ language.label }}</option>
      </select>
      <PagePicker />
      <button class="bar-button" type="button" :disabled="!state.page" @click="state.drawer = !state.drawer">
        Hidden text <span v-if="hiddenCount" class="badge">{{ hiddenCount }}</span>
      </button>
      <span class="spacer"></span>
      <span class="who" :title="state.reviewer.email">{{ state.reviewer.name }}</span>
      <button class="link" type="button" @click="signOut">Not you?</button>
    </header>

    <main class="stage">
      <p v-if="state.manifestError" class="state error" role="alert">
        {{ state.manifestError }} <button type="button" @click="retry">Try again</button>
      </p>
      <div v-else-if="state.loading" class="state" role="status">Loading the pages…</div>
      <div v-else-if="state.pageError" class="state" :class="{ error: state.pageError.code !== 'not-translated' }" role="status">
        <template v-if="state.pageError.code === 'not-translated'">
          <strong>This page isn't translated yet.</strong>
          <span>The translation is made within minutes of the English page being published. Try another page, or come back later.</span>
        </template>
        <template v-else>{{ state.pageError.message }}</template>
      </div>
      <SplitView v-else-if="state.page" :page="state.page" :label="label" :selected-id="selectedId" @pick="onPick" @notice="say" />
      <div v-else class="state welcome">
        <h1>Pick a language and a page</h1>
        <p>
          Then select text on either page, or click a paragraph, to suggest a better translation. Your notes are listed at the bottom, and
          you send them all at once.
        </p>
      </div>
      <HiddenDrawer v-if="state.drawer && state.page" :page="state.page" />
      <NoteEditor v-if="state.editing" :key="state.editingSeq" :editing="state.editing" />
      <p v-if="notice" class="toast" role="status">{{ notice }}</p>
    </main>

    <NotesQueue @submit="openSubmit" />
    <SubmitDialog v-if="state.submit.open" />
  </div>
  <div class="too-narrow" role="note">
    <h1>Please use a wider screen</h1>
    <p>Translation review shows two pages side by side, which needs a screen at least 900 pixels wide. Open this link on a laptop or desktop.</p>
  </div>
</template>

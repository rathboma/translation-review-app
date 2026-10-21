<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import HiddenDrawer from "./components/HiddenDrawer.vue";
import NoteEditor from "./components/NoteEditor.vue";
import NotesQueue from "./components/NotesQueue.vue";
import PagePicker from "./components/PagePicker.vue";
import SignIn from "./components/SignIn.vue";
import SplitView from "./components/SplitView.vue";
import SubmitDialog from "./components/SubmitDialog.vue";
import { LANGUAGES } from "../shared/types.ts";
import { closeEditor, draftFor, languageLabel, loadConfig, openEditor, openPage, openSubmit, setSite, signOut, startingPlace, state, type Anchor } from "./lib/state.ts";

const notice = ref("");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const languages = Object.entries(LANGUAGES);
const label = computed(() => languageLabel(state.lang));
const siteShown = computed(() => state.site || state.config?.site || "");
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

// "Not you?" is for a browser someone else will use, and takes the unsent notes with it.
function leave(): void {
  const n = state.notes.length;
  if (n && !window.confirm(`Sign out? The ${n} note${n === 1 ? "" : "s"} you haven't sent will be deleted from this browser.`)) return;
  signOut();
}

function chooseLanguage(event: Event): void {
  const lang = (event.target as HTMLSelectElement).value;
  // The same page in the other language, if it is a page there.
  void openPage(lang, state.path);
}

// The site to read pages from, typed in the bar.
async function chooseSite(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const problem = await setSite(input.value);
  if (problem) say(problem);
  input.value = siteShown.value;
}

async function start(): Promise<void> {
  await loadConfig();
  if (!state.config) return;
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
      <select class="lang-select" aria-label="Language" :value="state.lang" @change="chooseLanguage">
        <option value="" disabled>Language…</option>
        <option v-for="[code, language] in languages" :key="code" :value="code">{{ language.label }}</option>
      </select>
      <PagePicker />
      <input
        class="site-input"
        aria-label="Site"
        title="The site the pages are read from"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://www.beekeeperstudio.io"
        :value="siteShown"
        @change="chooseSite"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <button class="bar-button" type="button" :disabled="!state.page" @click="state.drawer = !state.drawer">
        Hidden text <span v-if="hiddenCount" class="badge">{{ hiddenCount }}</span>
      </button>
      <span class="spacer"></span>
      <span class="who" :title="state.reviewer.email">{{ state.reviewer.name }}</span>
      <button class="link" type="button" @click="leave">Not you?</button>
    </header>

    <main class="stage">
      <p v-if="state.configError" class="state error" role="alert">
        {{ state.configError }} <button type="button" @click="retry">Try again</button>
      </p>
      <div v-else-if="state.loading" class="state" role="status">Loading the pages…</div>
      <div v-else-if="state.pageError" class="state error" role="status">{{ state.pageError.message }}</div>
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

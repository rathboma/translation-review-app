<script setup lang="ts">
// Files the notes: a human check (Cloudflare Turnstile), then the Function
// lints them and files one issue per language.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { batch } from "../../shared/validate.ts";
import { closeSubmit, state, submitNotes } from "../lib/state.ts";
import { loadTurnstile, type Turnstile } from "../lib/turnstile.ts";

const box = ref<HTMLElement | null>(null);
const token = ref("");
const checking = ref(true);
const checkError = ref("");
let turnstile: Turnstile | null = null;
let widget: string | undefined;

// One submission holds only so much: the rest of the queue is for the next.
const sending = computed(() => batch(state.notes));
const summary = computed(() => {
  const langs = new Map<string, number>();
  for (const n of sending.value) langs.set(n.lang, (langs.get(n.lang) ?? 0) + 1);
  const where = [...langs].map(([lang, n]) => `${state.manifest?.languages[lang]?.label ?? lang}: ${n}`).join(", ");
  const n = sending.value.length;
  const some = `${n} note${n === 1 ? "" : "s"} (${where})`;
  return n < state.notes.length ? `${some} of your ${state.notes.length}: that is as many as can be sent at once, and the rest stay in your queue` : some;
});
const done = computed(() => state.submit.done);

onMounted(async () => {
  const sitekey = state.manifest?.turnstileSiteKey;
  if (!sitekey) {
    checkError.value = "The human check is not set up on this server.";
    checking.value = false;
    return;
  }
  try {
    turnstile = await loadTurnstile();
    widget = turnstile.render(box.value!, {
      sitekey,
      theme: "dark",
      callback: (t) => (token.value = t),
      "expired-callback": () => (token.value = ""),
      "error-callback": () => (checkError.value = "The human check failed. Reload the page and try again."),
    });
  } catch (error) {
    checkError.value = error instanceof Error ? error.message : String(error);
  } finally {
    checking.value = false;
  }
});

onBeforeUnmount(() => turnstile?.remove(widget));

async function send(): Promise<void> {
  const used = token.value;
  token.value = "";
  const ok = await submitNotes(used);
  // A token can be used once.
  if (!ok) turnstile?.reset(widget);
}
</script>

<template>
  <div class="modal submit-modal" @mousedown.self="!state.submit.busy && closeSubmit()">
    <section class="dialog" role="dialog" aria-label="Submit notes" aria-modal="true">
      <template v-if="done">
        <h2>Thank you!</h2>
        <p>Your notes were sent as {{ state.submit.issues.length === 1 ? "an issue" : "issues" }} on GitHub:</p>
        <ul class="issues">
          <li v-for="issue in state.submit.issues" :key="issue.number">
            <a :href="issue.url" target="_blank" rel="noopener">{{ issue.title }}</a>
          </li>
        </ul>
        <p v-if="state.submit.stale" class="warning" role="status">
          {{ state.submit.stale }} of the notes {{ state.submit.stale === 1 ? "was" : "were" }} filed as stale: the English they are about is no longer on the page (it changed since you
          opened it), so they will be skipped.
        </p>
        <p v-if="state.notes.length" class="muted">{{ state.notes.length }} more note{{ state.notes.length === 1 ? " is" : "s are" }} still in your queue: submit again to send {{ state.notes.length === 1 ? "it" : "them" }}.</p>
        <p v-else class="muted">Your queue is empty again. Nothing changes on the site until someone applies your notes.</p>
        <footer class="dialog-foot"><span class="spacer"></span><button class="primary" type="button" @click="closeSubmit">Done</button></footer>
      </template>
      <template v-else>
        <h2>Submit your notes</h2>
        <p>{{ summary }}. They become one GitHub issue per language, with your name on it.</p>
        <div ref="box" class="turnstile" aria-label="Human check"></div>
        <p v-if="checking" class="muted">Loading the human check…</p>
        <p v-if="checkError" class="error" role="alert">{{ checkError }}</p>
        <p v-if="state.submit.error" class="error" role="alert">{{ state.submit.error }}</p>
        <ul v-if="state.submit.issues.length" class="issues">
          <li v-for="issue in state.submit.issues" :key="issue.number"><a :href="issue.url" target="_blank" rel="noopener">{{ issue.title }}</a> (already filed)</li>
        </ul>
        <footer class="dialog-foot">
          <span class="spacer"></span>
          <button type="button" :disabled="state.submit.busy" @click="closeSubmit">Close</button>
          <button class="primary" type="button" :disabled="state.submit.busy || !token || sending.length === 0" @click="send">
            {{ state.submit.busy ? "Sending…" : `Submit ${sending.length} note${sending.length === 1 ? "" : "s"}` }}
          </button>
        </footer>
      </template>
    </section>
  </div>
</template>

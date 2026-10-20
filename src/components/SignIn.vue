<script setup lang="ts">
import { ref } from "vue";
import { parseReviewer } from "../../shared/validate.ts";
import { setReviewer } from "../lib/state.ts";

const name = ref("");
const email = ref("");
const error = ref("");

function start(): void {
  const reviewer = parseReviewer({ name: name.value, email: email.value });
  if (!reviewer.ok) {
    error.value = reviewer.error;
    return;
  }
  setReviewer(reviewer.value);
}
</script>

<template>
  <main class="signin">
    <form class="card" novalidate @submit.prevent="start">
      <h1>Review the translations</h1>
      <p>
        Read the machine-translated pages of beekeeperstudio.io next to the English, mark what should change, write the
        better translation, and send us your notes. Take as long as you like: your notes are kept in this browser until you send them.
      </p>
      <label>
        Your name
        <input v-model="name" name="name" autocomplete="name" maxlength="100" autofocus />
      </label>
      <label>
        Your email
        <input v-model="email" name="email" type="email" autocomplete="email" />
      </label>
      <p class="privacy">
        <strong>Your name is shown</strong> on the public GitHub issue your notes become.
        <strong>Your email is not.</strong> We keep it only to get in touch about your notes, and you won't be asked again on this browser.
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary" type="submit">Start reviewing</button>
    </form>
  </main>
</template>

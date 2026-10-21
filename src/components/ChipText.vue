<script setup lang="ts">
import { computed } from "vue";
import { chipLabel, parseParts, type Part } from "../../shared/chips.ts";

// A string with its inline tags shown as chips (read only). Only html segments
// have tags; the rest is shown as it is.
const props = defineProps<{ text: string; html?: boolean }>();
const parts = computed<Part[]>(() => (props.html ? parseParts(props.text) : [{ type: "text", value: props.text }]));
</script>

<template>
  <span class="chip-text"><template v-for="(part, i) in parts" :key="i"><span v-if="part.type === 'tag'" class="chip" :class="`chip-${part.role}`" :title="part.html">{{ chipLabel(part) }}</span><template v-else>{{ part.value }}</template></template></span>
</template>

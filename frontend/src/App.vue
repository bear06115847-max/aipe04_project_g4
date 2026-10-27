<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import AppShell from './components/AppShell.vue'
import './assets/app-theme.css'

const route = useRoute()
</script>

<template>
  <RouterView v-if="route.name === 'home'" />
  <AppShell v-else><RouterView /></AppShell>
</template>

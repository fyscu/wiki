<script setup lang="ts">
import { Check, CircleAlert, LoaderCircle, ExternalLink, Eye, Upload } from '@lucide/vue'
import { dateLabel, jobLabels, safeUrl, terminal, type Job } from './types'
defineProps<{ jobs: Job[]; error: string }>()
const emit = defineEmits<{ preview: [job: Job] }>()
const progress = { queued: 8, building: 35, committing: 65, publishing: 85, succeeded: 100, failed: 100 }
</script>

<template>
  <section class="we-jobs" aria-label="构建任务">
    <div class="we-section-head"><h2>任务</h2><span class="we-muted">{{ jobs.length }}</span></div>
    <p v-if="error" class="we-alert" role="alert">{{ error }}，正在重试</p>
    <p v-if="!jobs.length" class="we-empty">暂无任务</p>
    <article v-for="job in jobs" :key="job.id" class="we-job">
      <div class="we-section-head"><component :is="job.kind === 'publish' ? Upload : Eye" :size="17" /><strong>{{ job.kind === 'publish' ? '发布' : '预览' }}</strong><span class="we-job-status" :class="{ 'is-failed': job.status === 'failed', 'is-success': job.status === 'succeeded' }"><component :is="job.status === 'failed' ? CircleAlert : job.status === 'succeeded' ? Check : LoaderCircle" :class="{ 'we-spin': !terminal(job) }" :size="15" />{{ jobLabels[job.status] }}</span><time>{{ dateLabel(job.createdAt) }}</time></div>
      <progress :value="progress[job.status]" max="100" :aria-label="`${job.kind === 'publish' ? '发布' : '预览'}进度`"></progress>
      <p v-if="job.error || job.message" :class="job.error ? 'we-error-text' : 'we-muted'">{{ job.error || job.message }}</p>
      <div class="we-job-meta"><code>{{ job.id }}</code><code v-if="job.commit">{{ job.commit.slice(0, 12) }}</code><time v-if="job.finishedAt">{{ dateLabel(job.finishedAt) }}</time><button v-if="job.kind === 'preview' && job.status === 'succeeded' && safeUrl(job.url)" class="we-button" @click="emit('preview', job)"><Eye :size="15" />查看预览</button><a v-if="job.kind === 'publish' && job.status === 'succeeded' && safeUrl(job.url)" class="we-button" :href="safeUrl(job.url)" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" />查看站点</a></div>
    </article>
  </section>
</template>

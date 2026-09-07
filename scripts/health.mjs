const checks = [
  ['Wiki', process.env.WIKI_URL || 'http://127.0.0.1:5173/'],
  ['Answer', process.env.QA_ORIGIN || 'http://127.0.0.1:9080/'],
  ['Public questions', (process.env.WIKI_URL || 'http://127.0.0.1:5173/').replace(/\/$/, '') + '/_qa/questions?tag=doc-01arz3ndektsv4rrffq69g5fav'],
  ['Integrated questions', (process.env.WIKI_URL || 'http://127.0.0.1:5173/').replace(/\/$/, '') + '/_community/questions?page=1&page_size=5&order=newest'],
]
for (const [name, url] of checks) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (name === 'Public questions' || name === 'Integrated questions') {
      const body = await response.json()
      if (body.code !== 200 || !Array.isArray(body.data?.list)) throw new Error('Invalid public API response')
    }
    console.log(`${name}: OK`)
  } catch (error) { console.error(`${name}: ${error.message}`); process.exitCode = 1 }
}

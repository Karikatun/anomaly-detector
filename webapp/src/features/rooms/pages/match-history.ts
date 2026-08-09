export function formatUuidV7Date(tenderId: string | null | undefined): { date: string; time: string } {
  if (!tenderId || tenderId[14] !== '7') return { date: '—', time: '' }

  const timestamp = Number.parseInt(tenderId.replaceAll('-', '').slice(0, 12), 16)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return { date: '—', time: '' }

  return {
    date: matchDateFormatter.format(date),
    time: matchTimeFormatter.format(date),
  }
}

const matchDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const matchTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

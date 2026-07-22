import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { RoomsApi } from '../api'

export function MyMatchesPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const api = new RoomsApi(auth.transport)

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) void navigate({ to: '/', replace: true })
  }, [auth.isBootstrapping, auth.user, navigate])

  const matches = useQuery({
    queryKey: ['rooms', 'mine'],
    queryFn: () => api.listMatches(),
    enabled: Boolean(auth.user),
  })

  if (auth.isBootstrapping || !auth.user) return null

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-12">
      <div className="grid gap-2">
        <Typography variant="h1">Мои матчи</Typography>
        <Typography tone="muted">Активные и завершённые Тендеры, в которых вы участвовали.</Typography>
      </div>

      {matches.isPending && (
        <div className="flex items-center gap-3"><Spinner /><Typography tone="muted">Загружаем матчи...</Typography></div>
      )}
      {matches.isError && <Typography role="alert" tone="destructive">Не удалось загрузить историю матчей.</Typography>}
      {matches.data?.length === 0 && (
        <Card><CardContent className="py-8"><Typography tone="muted">У вас пока нет начатых матчей.</Typography></CardContent></Card>
      )}
      {matches.data?.map((match) => (
        <Card key={match.roomId}>
          <CardHeader>
            <CardTitle>Тендер на {match.capacity} игрока</CardTitle>
            <CardDescription>
              {match.members.length} участника · {match.tenderPhase === 'complete' ? 'завершён' : 'активен'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {match.tenderId && (
              <Button type="button" className="w-full" onClick={() => void navigate({ to: '/tenders/$tenderId', params: { tenderId: match.tenderId! } })}>
                Открыть матч
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

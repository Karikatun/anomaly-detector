import { gameCapabilitiesSchema } from '@anomaly-detector/contracts'
import { useQuery } from '@tanstack/react-query'

import { HttpClient } from '@/platform/api'

export function useNewGameFormatWritesEnabled() {
  const query = useQuery({
    queryKey: ['api-capabilities'],
    // This public response can populate the shared cache after route navigation.
    queryFn: () => new HttpClient().request('/api/capabilities', gameCapabilitiesSchema, {
      credentials: 'omit',
    }),
  })
  return query.isSuccess && query.data.newGameFormatWritesEnabled
}

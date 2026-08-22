import { RouterProvider } from '@tanstack/react-router'
import { Agentation } from 'agentation'

import { router } from './routes'

export default function App() {
  const agentationEnabled = import.meta.env.DEV
    && import.meta.env.VITE_AGENTATION_ENABLED !== 'false'
    && window.location.pathname !== '/recover/password'

  return (
    <>
      <RouterProvider router={router} />
      {agentationEnabled && <Agentation />}
    </>
  )
}

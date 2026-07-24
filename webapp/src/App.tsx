import { RouterProvider } from '@tanstack/react-router'
import { Agentation } from 'agentation'

import { router } from './routes'

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <Agentation />}
    </>
  )
}

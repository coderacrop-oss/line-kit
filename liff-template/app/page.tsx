import { readTemplateConfigFromDisk } from '../lib/config'
import { AppClient } from './AppClient'

/**
 * Server component: reads config/quiz.config.json (or the sample, pre-export) off
 * disk once at request time, then hands the quiz config to the client-side screen
 * state machine. Kept this thin on purpose — all screen-flow logic lives in
 * AppClient.tsx, which is what app/AppClient.test.tsx exercises directly (a server
 * component that reads from `fs` isn't practically testable with
 * @testing-library/react the way a client component is).
 */
export default function Page() {
  const config = readTemplateConfigFromDisk()
  return <AppClient quiz={config.quiz} />
}

import { spawnSync } from 'node:child_process'
import { repositoryRoot } from './repo-env.mjs'

// Git hooks export repository-local variables (including GIT_INDEX_FILE).
// Synthetic repositories and worktrees must never inherit the caller's Git state.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
)
env.PYTHONDONTWRITEBYTECODE = '1'

const result = spawnSync('python3', [
  '-B', '-m', 'unittest', 'discover',
  '-s', '.agents/skills/skill-doctor/scripts', '-p', 'test_*.py',
], { cwd: repositoryRoot, env, stdio: 'inherit' })

if (result.error) process.stderr.write('Could not start Python skill tests\n')
process.exitCode = result.status ?? 1

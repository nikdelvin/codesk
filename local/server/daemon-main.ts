import { startDaemon } from './daemon'
import { readSettings, publicError, AppError } from './config'
process.umask(0o077)
startDaemon(readSettings(process.argv[3])).catch(error => {
  if (!(error instanceof AppError && error.code === 'RUNTIME_BUSY')) console.error(JSON.stringify(publicError(error)))
  process.exitCode = error instanceof AppError && error.code === 'RUNTIME_BUSY' ? 75 : 1
})

#!/usr/bin/env node
import { main } from '../src/cli.js'
import { formatFatal } from '../src/errors.js'

main(process.argv.slice(2)).catch((err) => {
  console.error(formatFatal(err))
  process.exit(1)
})

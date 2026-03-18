// Strip Steam env vars containing null bytes that crash Node.js 25+.
// Loaded via NODE_OPTIONS=--require before any agent CLI code runs.
// Keeps itself in NODE_OPTIONS so ALL Node.js child processes are protected
// (the OS re-injects the bad env var into every new process).
for (const key of Object.keys(process.env)) {
  if (key.toLowerCase().includes('steam') && process.env[key].includes('\x00')) {
    delete process.env[key];
  }
}

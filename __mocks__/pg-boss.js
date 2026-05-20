// Mock para testes Jest — pg-boss v12 é ESM puro e não roda no ambiente CJS do Jest
class PgBoss {
  on() { return this; }
  async start() {}
  async stop() {}
  async send() { return 'mock-job-id'; }
  async work() { return 'mock-worker-id'; }
}

module.exports = { PgBoss };

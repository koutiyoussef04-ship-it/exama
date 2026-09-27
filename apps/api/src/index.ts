import { serve } from '@hono/node-server';
import { app } from './app.js';
import { aiInfo, config, transcriptionInfo } from './config.js';
import { sql } from './db/client.js';
import { explainDbError } from './db/errors.js';
import { resumePendingDocuments } from './services/documents.js';
import { resumeMaterialJobs, startMaterialMaintenance } from './services/materials/index.js';

// Fail fast with a clear message if Postgres isn't reachable.
try {
  await sql`select 1`;
} catch (err) {
  console.error('✖ ' + explainDbError(err, config.DATABASE_URL));
  process.exit(1);
}

serve({ fetch: app.fetch, port: config.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`✓ API listening on http://localhost:${info.port}`);
  console.log(`  Lecture transcription: ${transcriptionInfo.provider}${transcriptionInfo.provider === 'mock' ? ' (fake transcripts — set TRANSCRIPTION_PROVIDER=assemblyai for real ones)' : ''}`);
  console.log(`  AI provider: ${aiInfo.provider}${aiInfo.provider === 'mock' ? ' (fake AI — set AI_PROVIDER=anthropic for real AI)' : ` · model: ${aiInfo.model}`}`);
});

resumePendingDocuments().catch((err) => console.error('Failed to resume pending documents', err));
resumeMaterialJobs().catch((err) => console.error('Failed to resume material processing', err));
startMaterialMaintenance();

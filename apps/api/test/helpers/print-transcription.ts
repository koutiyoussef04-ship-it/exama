import { config, transcriptionInfo } from '../../src/config.js';
console.log(JSON.stringify({ ...transcriptionInfo, maxMinutesPerFile: config.MEDIA_MAX_MINUTES_PER_FILE, maxUploadMb: config.MEDIA_MAX_UPLOAD_MB }));

// Used by config.test.ts: loads config in a child process and prints the safe AI info.
import { aiInfo } from '../../src/config.js';
console.log(JSON.stringify(aiInfo));

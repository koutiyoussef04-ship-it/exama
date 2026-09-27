/** Course materials: wiring of the background processor and the study-planner hook. */
import { setBeforeCourseDeletion } from '../documents.js';
import { onCourseTopicsChanged } from '../study-plans.js';
import { materialJobs } from './jobs.js';
import { processMaterial } from './pipeline.js';
import { prepareCourseDeletion, setTopicsChangedHook } from './service.js';

materialJobs.setProcessor(processMaterial);
setTopicsChangedHook(onCourseTopicsChanged);
setBeforeCourseDeletion(prepareCourseDeletion);

export { materialJobs, purgeExpiredMedia, resumeMaterialJobs, startMaterialMaintenance } from './jobs.js';
export {
  cancelUserMaterialJobs,
  createMaterial,
  deleteMaterial,
  getMaterial,
  listMaterials,
  prepareCourseDeletion,
  recomputeCourseTopics,
  retryMaterial,
  uploadLimiter,
} from './service.js';
export { segmentsToChunks } from './pipeline.js';

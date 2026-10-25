import {createSyncJob} from './_shared/sync-job.js';
// Netlify schedules use UTC: 09:00 UTC is 06:00 in America/Sao_Paulo.
// No database or vendor access occurs until a documented adapter is implemented.
export const config={schedule:'0 9 * * *'};
export default createSyncJob();

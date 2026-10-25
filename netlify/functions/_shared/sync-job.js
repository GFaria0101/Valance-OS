// No vendor endpoints are guessed. Until a documented adapter exists this job
// does not create a service client, read tenants, write sync rows or import data.
export function createSyncJob(){
  return async function run(){
    return new Response(JSON.stringify({status:'blocked',code:'PRESENCE_NOT_CONFIGURED'}),{
      status:503,
      headers:{'content-type':'application/json','cache-control':'no-store'}
    });
  };
}

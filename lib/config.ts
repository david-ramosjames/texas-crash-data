export function checkConfig(env: NodeJS.ProcessEnv, role:'web'|'worker'='web') {
  const required = ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
  if(role==='web') required.push('SUPABASE_PUBLISHABLE_KEY','STUDIO_ALLOWED_EMAILS','APP_URL');
  const errors = required.filter(k=>!env[k]?.trim()).map(k=>`${k} is required`);
  if (!!env.OPENAI_API_KEY !== !!env.OPENAI_MODEL) errors.push('Set OPENAI_API_KEY and OPENAI_MODEL together, or leave both empty');
  if(env.DB_POOL_MAX && (!Number.isInteger(Number(env.DB_POOL_MAX)) || Number(env.DB_POOL_MAX)<2 || Number(env.DB_POOL_MAX)>20)) errors.push('DB_POOL_MAX must be an integer from 2 to 20');
  for(const key of ['APP_URL','SUPABASE_URL','DATABASE_URL']) {
    if(!env[key])continue;
    try {
      const url=new URL(env[key]);
      if(key==='DATABASE_URL') {
        if(!['postgres:','postgresql:'].includes(url.protocol))errors.push('DATABASE_URL must be a PostgreSQL connection string');
        if(url.port==='6543')errors.push('Use the direct or session-pooler connection (5432), not transaction pooling (6543)');
      } else if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))errors.push(`${key} must use HTTPS except on localhost`);
      if(key==='APP_URL' && url.pathname!=='/')errors.push('APP_URL must be an origin with no path');
    }catch{errors.push(`${key} must be a valid URL`);}
  }
  if(role==='web' && env.STUDIO_ALLOWED_EMAILS?.split(',').some(x=>!/^\S+@\S+\.\S+$/.test(x.trim())))errors.push('STUDIO_ALLOWED_EMAILS must be a comma-separated list of email addresses');
  return errors;
}

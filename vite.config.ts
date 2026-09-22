import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import {validatePublicConfig} from './src/config-validation';
export default defineConfig(({command,mode})=>{
  const env=loadEnv(mode,process.cwd(),'VITE_');
  if(command==='build'){
    const error=validatePublicConfig({url:env.VITE_SUPABASE_URL,key:env.VITE_SUPABASE_ANON_KEY});
    if(error)throw new Error(error);
  }
  return {plugins:[react()]};
});

import { checkConfig } from '../lib/config';
const errors=checkConfig(process.env,process.argv.includes('--worker')?'worker':'web');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log('Configuration shape is valid. No secrets printed. Run the deployment smoke checks to verify connectivity.');

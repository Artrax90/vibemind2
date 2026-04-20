import { execSync } from 'child_process';
console.log(execSync('python3 /app/applet/backend/test_dist.py').toString());

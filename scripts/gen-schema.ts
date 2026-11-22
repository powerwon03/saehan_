// supabase/schema.sql 을 src/server/schema.ts 의 표 정의에서 만들어 낸다. 실행: npm run schema
import fs from 'node:fs';
import path from 'node:path';
import { postgresSchema } from '../src/server/schema';

const file = path.join(process.cwd(), 'supabase', 'schema.sql');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, postgresSchema(), 'utf8');
console.log(`쓴 파일: ${file}`);

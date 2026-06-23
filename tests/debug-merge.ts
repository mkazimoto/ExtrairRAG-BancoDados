import { validateSqlSyntax } from './src/tools/sql-validator.js';

const sql = `
MERGE INTO PFUNC AS TARGET
USING (SELECT 1 AS CODFUNC) AS SOURCE
ON TARGET.CODFUNC = SOURCE.CODFUNC
WHEN MATCHED THEN UPDATE SET NOME = 'TESTE'
WHEN NOT MATCHED THEN INSERT (CODFUNC, NOME) VALUES (1, 'TESTE');
`;

console.log(JSON.stringify(validateSqlSyntax(sql), null, 2));

const sql2 = `
DELETE FROM PFUNC
OUTPUT DELETED.CODFUNC
WHERE CODFUNC = 1
`;

console.log(JSON.stringify(validateSqlSyntax(sql2), null, 2));

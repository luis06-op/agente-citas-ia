// Carga la misma configuración que el agente y selecciona el motor local.
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
try {
    loadEnvFile(path.join(raiz, '.env'));
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}

const accion = process.argv[2] || 'auto';
const base = new URL(process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8088/v1');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
if (!local) {
    if (accion !== 'auto') console.error('La configuración actual usa un servidor remoto.');
    process.exit(accion === 'auto' ? 0 : 1);
}

const motor = process.env.MOTOR_LOCAL || (base.port === '11434' ? 'ollama' : 'llama');
if (!['llama', 'ollama'].includes(motor)) throw new Error('MOTOR_LOCAL debe ser llama u ollama.');
const resultado = spawnSync('bash', [path.join(raiz, 'scripts', `${motor}.sh`), accion], {
    stdio: 'inherit',
    env: { ...process.env, LOCAL_PORT: base.port || '80' }
});
if (resultado.error) console.error(resultado.error.message);
process.exit(resultado.status ?? 1);

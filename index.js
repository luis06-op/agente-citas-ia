// Agente de citas por terminal.
//
// Flujo de cada turno:
//   persona → programa → LLM → (JSON) → herramienta → resultado → LLM → respuesta
//
// El programa es el "controlador": mantiene el historial, ejecuta funciones y
// decide cuándo parar. El LLM solo razona y elige qué hacer.

import path from 'node:path';
import { loadEnvFile } from 'node:process';
import readline from 'node:readline';

import OpenAI from 'openai';

import { crearAgente } from './src/agente.js';
import { crearAgenda } from './src/citas.js';
import { crearHerramientas } from './src/herramientas.js';
import { crearPromptSistema } from './src/prompt.js';
import { describirAhora, validarZonaHoraria } from './src/tiempo.js';

const RAIZ = import.meta.dirname;

// Carga .env si existe, sin sobrescribir variables ya definidas en el entorno.
try {
    loadEnvFile(path.join(RAIZ, '.env'));
} catch (error) {
    if (error.code !== 'ENOENT') {
        throw error;
    }
}

const zonaHoraria = process.env.ZONA_HORARIA?.trim() || 'America/Bogota';
if (!validarZonaHoraria(zonaHoraria)) {
    console.error(
        `La zona horaria "${zonaHoraria}" no es válida. Usa un identificador IANA, por ejemplo America/Bogota.`
    );
    process.exit(1);
}

const modelo = process.env.OPENAI_MODEL?.trim() || 'qwen2.5-local';
const baseURL = process.env.OPENAI_BASE_URL?.trim() || 'http://127.0.0.1:8088/v1';
const esLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(baseURL);
const apiKey = process.env.OPENAI_API_KEY?.trim() || (esLocal ? 'local' : '');

if (!apiKey) {
    console.error(`
Falta la variable OPENAI_API_KEY.

El modo gratuito local no necesita clave, pero OPENAI_BASE_URL
apunta a otro proveedor: ${baseURL}

1. Copia el archivo de ejemplo: cp .env.example .env
2. Escribe tu clave en OPENAI_API_KEY.
3. Vuelve a ejecutar: npm start

Para volver al modo gratuito local, usa los valores de .env.example.
`);
    process.exit(1);
}

const temperatura = Number.parseFloat(process.env.OPENAI_TEMPERATURE ?? '0.2');
const archivoCitas = process.env.ARCHIVO_CITAS
    ? path.resolve(RAIZ, process.env.ARCHIVO_CITAS)
    : path.join(RAIZ, 'datos', 'citas.json');

const cliente = new OpenAI({
    apiKey,
    baseURL
});

const agenda = crearAgenda({ archivo: archivoCitas, zonaHoraria });
const herramientas = crearHerramientas(agenda);

async function comprobarServidorLocal() {
    if (!esLocal) {
        return;
    }

    let etiquetas;
    try {
        const respuesta = await fetch(`${baseURL.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(5000) });
        if (!respuesta.ok) {
            throw new Error(`HTTP ${respuesta.status}`);
        }
        etiquetas = await respuesta.json();
    } catch {
        console.error(`\nNo responde el servidor local en ${baseURL}.`);
        console.error('Inícialo con:   npm run local:iniciar');
        console.error('Primera vez:    npm run preparar');
        process.exit(1);
    }

    const nombres = new Set((etiquetas.data ?? []).map((modeloInstalado) => modeloInstalado.id));
    if (!nombres.has(modelo) && !nombres.has(`${modelo}:latest`)) {
        console.error(`\nEl servidor está en marcha, pero falta el modelo "${modelo}".`);
        console.error('Descárgalo con: npm run preparar');
        process.exit(1);
    }
}

await comprobarServidorLocal();

const agente = crearAgente({
    cliente,
    modelo,
    herramientas,
    temperature: Number.isFinite(temperatura) ? temperatura : 0.2,
    promptSistema: crearPromptSistema({ zonaHoraria, herramientas }),
    jsonMode: process.env.JSON_MODE !== '0',
    registrar: (mensaje) => console.log(mensaje)
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('Agente de citas — escribe "salir" para terminar.');
console.log(`Proveedor: ${esLocal ? 'IA local (gratis)' : baseURL}`);
console.log(`Modelo: ${modelo} | Zona horaria: ${zonaHoraria}`);
console.log(`Ahora: ${describirAhora(new Date(), zonaHoraria)}`);
console.log(`Citas guardadas en: ${archivoCitas}`);

rl.setPrompt('\nTú: ');

function mostrarPrompt() {
    if (!rl.closed) {
        rl.prompt();
    }
}

mostrarPrompt();

for await (const linea of rl) {
    const entrada = linea.trim();

    if (entrada === '') {
        mostrarPrompt();
        continue;
    }

    if (['salir', 'exit', 'quit'].includes(entrada.toLowerCase())) {
        break;
    }

    try {
        const respuesta = await agente.responder(entrada);
        console.log(`\nAgente: ${respuesta}`);
    } catch (error) {
        console.error(`\n[error] ${error.message}`);
    }

    mostrarPrompt();
}

rl.close();
console.log('\n¡Hasta luego!');

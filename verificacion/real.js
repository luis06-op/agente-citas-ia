// Conversaciones con el servidor real. Nunca usa datos/citas.json.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import OpenAI from 'openai';
import { crearAgente } from '../src/agente.js';
import { crearAgenda } from '../src/citas.js';
import { crearHerramientas } from '../src/herramientas.js';
import { crearPromptSistema } from '../src/prompt.js';

const raiz = path.resolve(import.meta.dirname, '..');
try { loadEnvFile(path.join(raiz, '.env')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
}
const ahora = new Date('2026-11-24T15:00:00Z');
const zonaHoraria = 'America/Bogota';
const modelo = process.env.OPENAI_MODEL || 'qwen2.5-local';
const baseURL = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8088/v1';
const cliente = new OpenAI({ baseURL, apiKey: process.env.OPENAI_API_KEY || 'local', timeout: 120000, maxRetries: 0 });
const citaBase = { fecha_hora: '2026-12-02T15:00:00.000Z', nombre: 'Ana Pérez', correo: 'ana@example.com' };
const cantidad = n => ({ citas }) => assert.equal(citas.length, n, `Se esperaban ${n} citas`);
const reservada = ({ citas }) => {
    cantidad(1)({ citas });
    for (const [campo, valor] of Object.entries(citaBase)) assert.equal(citas[0][campo], valor, campo);
};
const intacta = ({ citas, iniciales }) => assert.deepEqual(citas, iniciales, 'La agenda debía permanecer intacta');
const consultada = fecha => ({ llamadas }) => assert.ok(llamadas.some(l =>
    l.nombre === 'consultar_disponibilidad' && l.resultado.fecha_hora === fecha && l.resultado.disponible === true
), `Debía consultar disponibilidad real para ${fecha}`);

const casos = [
    {
        id: 'reserva-completa', titulo: 'Reserva en varios turnos',
        esperado: 'Consultar el hueco, pedir nombre/correo y guardar una sola cita tras la confirmación.',
        pasos: [
            ['¿Hay disponibilidad el 2 de diciembre de 2026 a las 10:00 de Bogotá?', cantidad(0), consultada(citaBase.fecha_hora)],
            ['Sí, quiero esa cita. Me llamo Ana Pérez.', cantidad(0)],
            ['Mi correo es ana@example.com. Confirmo la reserva del 2 de diciembre de 2026 a las 10:00 de Bogotá.', reservada]
        ]
    },
    {
        id: 'datos-incompletos', titulo: 'Faltan fecha, hora y contacto',
        esperado: 'Preguntar por el día y la hora, sin inventar datos ni reservar.',
        pasos: [['Hola, quiero agendar una cita.', cantidad(0)]]
    },
    {
        id: 'correo-invalido', titulo: 'Correo incorrecto y corrección',
        esperado: 'Pedir un correo válido; después usar el correo corregido y reservar.',
        pasos: [
            ['Confirmo una cita el 2 de diciembre de 2026 a las 10:00 de Bogotá. Soy Ana Pérez y mi correo es ana-arroba-ejemplo.', cantidad(0)],
            ['Corrijo mi correo: ana@example.com. Confirmo la reserva para el 2 de diciembre de 2026 a las 10:00 de Bogotá.', reservada]
        ]
    },
    {
        id: 'ocupado', titulo: 'Horario ocupado', semilla: true,
        esperado: 'Informar que ya está ocupado y pedir otra hora, sin duplicar la reserva.',
        pasos: [['Confirmo una cita el 2 de diciembre de 2026 a las 10:00 de Bogotá. Soy Bruno Díaz, bruno@example.com.', intacta]]
    },
    {
        id: 'solapamiento', titulo: 'Cruce parcial de 15 minutos', semilla: true,
        esperado: 'Rechazar las 10:15 porque la cita existente ocupa de 10:00 a 10:30.',
        pasos: [['Confirmo una cita el 2 de diciembre de 2026 a las 10:15 de Bogotá. Soy Bruno Díaz, bruno@example.com.', intacta]]
    },
    {
        id: 'pasado', titulo: 'Fecha pasada',
        esperado: 'Explicar que la fecha pasó y solicitar una futura, sin reservar.',
        pasos: [['Confirmo una cita el 23 de noviembre de 2026 a las 10:00 de Bogotá. Soy Ana Pérez, ana@example.com.', cantidad(0)]]
    },
    {
        id: 'fin-de-semana', titulo: 'Sábado',
        esperado: 'Explicar que se atiende de lunes a viernes y pedir un día laboral.',
        pasos: [['Confirmo una cita el sábado 28 de noviembre de 2026 a las 10:00 de Bogotá. Soy Ana Pérez, ana@example.com.', cantidad(0)]]
    },
    {
        id: 'cierre', titulo: 'Una cita que termina después del cierre',
        esperado: 'Rechazar las 17:45: la duración de 30 minutos excede las 18:00.',
        pasos: [['Confirmo una cita el 2 de diciembre de 2026 a las 17:45 de Bogotá. Soy Ana Pérez, ana@example.com.', cantidad(0)]]
    },
    {
        id: 'zona-horaria', titulo: 'Hora de Madrid',
        esperado: 'Consultar 16:00 de Madrid = 10:00 de Bogotá = 15:00 UTC, y responder usando la hora de Madrid.',
        pasos: [['Estoy en Madrid, España. ¿Hay cita el 2 de diciembre de 2026 a las 16:00, hora de Madrid? Solo consulta, no reserves.', cantidad(0), consultada(citaBase.fecha_hora)]]
    },
    {
        id: 'manana', titulo: 'Fecha relativa: mañana',
        esperado: 'Con el reloj fijado en el 24/11/2026, consultar el 25/11/2026 a las 10:00 de Bogotá.',
        pasos: [['¿Hay disponibilidad mañana a las 10:00 de Bogotá? Solo quiero consultar.', cantidad(0), consultada('2026-11-25T15:00:00.000Z')]]
    },
    {
        id: 'cancelar', titulo: 'Cancelación correcta', semilla: true,
        esperado: 'Cancelar la cita que coincide en fecha y correo y confirmar la cancelación.',
        pasos: [['Soy Ana Pérez, ana@example.com. Confirmo que quiero cancelar mi cita del 2 de diciembre de 2026 a las 10:00 de Bogotá.', cantidad(0)]]
    },
    {
        id: 'cancelar-correo-distinto', titulo: 'Cancelación con correo que no coincide', semilla: true,
        esperado: 'Informar que no encuentra una cita con esos datos y conservar la reserva existente.',
        pasos: [['Soy Ana Pérez, otro@example.com. Confirmo que quiero cancelar mi cita del 2 de diciembre de 2026 a las 10:00 de Bogotá.', intacta]]
    },
    {
        id: 'ambigua', titulo: 'Petición ambigua',
        esperado: 'Pedir precisión de fecha y de AM/PM, o explicar horarios; no crear una cita con datos inventados.',
        pasos: [['Quiero una cita el viernes a las 7.', cantidad(0)]]
    },
    {
        id: 'solo-consultar', titulo: 'Consulta sin autorización para reservar',
        esperado: 'Consultar disponibilidad y no reservar aunque tenga nombre y correo.',
        pasos: [['Soy Ana Pérez, ana@example.com. ¿Está libre el 2 de diciembre de 2026 a las 10:00 de Bogotá? NO reserves, solo consulta.', cantidad(0), consultada(citaBase.fecha_hora)]]
    },
    {
        id: 'fecha-imposible', titulo: 'Día inexistente',
        esperado: 'Indicar que el 31 de febrero no existe y pedir una fecha válida.',
        pasos: [['Confirmo una cita el 31 de febrero de 2027 a las 10:00 de Bogotá. Soy Ana Pérez, ana@example.com.', cantidad(0)]]
    }
];

const seleccion = process.argv.slice(2);
const carpeta = path.join(raiz, 'verificacion', 'resultados');
await fs.mkdir(carpeta, { recursive: true });
const informe = { ejecutado: new Date().toISOString(), relojControlado: ahora.toISOString(), modelo, baseURL, temperatura: 0.2, casos: [] };
const archivoInforme = path.join(carpeta, `${informe.ejecutado.replace(/[:.]/g, '-')}.json`);
for (const caso of casos.filter(c => !seleccion.length || seleccion.includes(c.id))) {
    const directorio = await fs.mkdtemp(path.join(os.tmpdir(), 'citas-real-'));
    const archivo = path.join(directorio, 'citas.json');
    const leerCitas = async () => {
        try { return JSON.parse(await fs.readFile(archivo, 'utf8')).citas; }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    const resultado = { id: caso.id, titulo: caso.titulo, esperado: caso.esperado, turnos: [], errores: [] };
    try {
        const agenda = crearAgenda({ archivo, zonaHoraria, ahora: () => ahora });
        if (caso.semilla) assert.equal((await agenda.agendar(citaBase)).ok, true);
        const iniciales = await leerCitas();
        resultado.iniciales = iniciales;
        const llamadas = [];
        const herramientas = crearHerramientas(agenda).map(h => ({ ...h, ejecutar: async args => {
            const respuesta = await h.ejecutar(args);
            llamadas.push({ nombre: h.nombre, argumentos: structuredClone(args), resultado: structuredClone(respuesta) });
            return respuesta;
        } }));
        const agente = crearAgente({ cliente, modelo, herramientas, promptSistema: crearPromptSistema({ zonaHoraria, herramientas, ahora }) });
        for (const [usuario, ...comprobaciones] of caso.pasos) {
            const inicio = performance.now();
            const indice = llamadas.length;
            const turno = { usuario };
            try { turno.respuesta = await agente.responder(usuario); }
            catch (error) { turno.error = error.message; resultado.errores.push(error.message); }
            turno.segundos = Number(((performance.now() - inicio) / 1000).toFixed(2));
            turno.herramientas = llamadas.slice(indice);
            turno.citas = await leerCitas();
            for (const comprobar of comprobaciones) {
                try { comprobar({ citas: turno.citas, iniciales, llamadas: turno.herramientas }); }
                catch (error) { resultado.errores.push(error.message); }
            }
            resultado.turnos.push(turno);
        }
        resultado.historial = agente.mensajes;
    } catch (error) { resultado.errores.push(error.message); }
    finally { await fs.rm(directorio, { recursive: true, force: true }); }
    resultado.controlesAutomaticos = resultado.errores.length ? 'FALLO' : 'OK';
    informe.casos.push(resultado);
    // La calidad del lenguaje se revisa leyendo respuestas y herramientas, no con una expresión regular.
    await fs.writeFile(archivoInforme, JSON.stringify(informe, null, 2) + '\n');
    console.log(JSON.stringify({ ...resultado, historial: undefined }, null, 2));
}
assert.ok(informe.casos.length, 'Ningún escenario coincide con la selección');
console.log(`Evidencias completas: ${archivoInforme}`);
if (informe.casos.some(c => c.errores.length)) process.exitCode = 1;

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { crearAgente, extraerJson } from '../src/agente.js';
import { crearAgenda } from '../src/citas.js';
import { crearHerramientas } from '../src/herramientas.js';
import { crearPromptSistema } from '../src/prompt.js';

const ZONA = 'America/Bogota';
const AHORA = new Date('2026-11-24T15:00:00Z');

async function preparar(t) {
    const directorio = await fs.mkdtemp(path.join(os.tmpdir(), 'agente-citas-'));
    const archivo = path.join(directorio, 'citas.json');
    const agenda = crearAgenda({ archivo, zonaHoraria: ZONA, ahora: () => AHORA });
    const herramientas = crearHerramientas(agenda);
    const promptSistema = crearPromptSistema({ zonaHoraria: ZONA, herramientas, ahora: AHORA });
    t.after(() => fs.rm(directorio, { recursive: true, force: true }));
    return { agenda, archivo, herramientas, promptSistema };
}

function crearClienteFalso(respuestas) {
    const llamadas = [];
    let indice = 0;

    return {
        llamadas,
        chat: {
            completions: {
                async create(opciones) {
                    llamadas.push({
                        ...opciones,
                        messages: opciones.messages.map((mensaje) => ({ ...mensaje }))
                    });
                    const contenido = respuestas[indice];
                    indice += 1;
                    if (contenido === undefined) {
                        throw new Error('El cliente falso se quedó sin respuestas.');
                    }
                    return { choices: [{ message: { role: 'assistant', content: contenido } }] };
                }
            }
        }
    };
}

test('extraerJson tolera bloques de código y texto alrededor', () => {
    assert.deepEqual(extraerJson('{"to":"user","message":"hola"}'), { to: 'user', message: 'hola' });
    assert.deepEqual(extraerJson('```json\n{"to":"user"}\n```'), { to: 'user' });
    assert.deepEqual(extraerJson('Claro: {"to":"system"} fin'), { to: 'system' });
    assert.throws(() => extraerJson('no es json'), /JSON válido/);
});

test('el agente ejecuta una herramienta y luego responde a la persona', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    const registros = [];
    const cliente = crearClienteFalso([
        JSON.stringify({
            to: 'system',
            function_call: {
                function: 'consultar_disponibilidad',
                arguments: { fecha_hora: '2026-11-25T15:00:00Z' }
            }
        }),
        JSON.stringify({
            to: 'user',
            message: 'Sí, hay disponibilidad el miércoles a las 10:00. ¿Quieres que la agende?'
        })
    ]);
    const agente = crearAgente({
        cliente,
        modelo: 'falso',
        herramientas,
        promptSistema,
        registrar: (mensaje) => registros.push(mensaje)
    });

    const respuesta = await agente.responder('¿Hay cita el miércoles a las 10?');

    assert.match(respuesta, /hay disponibilidad/i);
    assert.equal(cliente.llamadas.length, 2);
    assert.equal(cliente.llamadas[0].model, 'falso');
    assert.equal(cliente.llamadas[0].temperature, 0.2);
    assert.deepEqual(cliente.llamadas[0].response_format, { type: 'json_object' });

    assert.deepEqual(
        agente.mensajes.map((mensaje) => mensaje.role),
        ['system', 'user', 'assistant', 'user', 'assistant']
    );
    assert.match(agente.mensajes[3].content, /\[sistema\] Resultado de consultar_disponibilidad/);
    assert.match(agente.mensajes[3].content, /"disponible":true/);
    assert.match(registros[0], /\[herramienta\] consultar_disponibilidad/);
});

test('agenda una cita con argumentos en array, como en el tutorial original', async (t) => {
    const { herramientas, promptSistema, archivo } = await preparar(t);
    const cliente = crearClienteFalso([
        JSON.stringify({
            to: 'system',
            function_call: {
                function: 'agendar_cita',
                arguments: ['2026-11-25T15:00:00Z', 'Ana Pérez', 'ana@example.com']
            }
        }),
        JSON.stringify({ to: 'user', message: 'Listo, Ana. Tu cita quedó agendada.' })
    ]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas, promptSistema });

    const respuesta = await agente.responder('Agéndame el miércoles a las 10, soy Ana Pérez, ana@example.com');

    assert.match(respuesta, /quedó agendada/);
    const guardado = JSON.parse(await fs.readFile(archivo, 'utf8'));
    assert.equal(guardado.citas.length, 1);
    assert.equal(guardado.citas[0].nombre, 'Ana Pérez');
});

test('se recupera de una respuesta que no es JSON válido', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    const cliente = crearClienteFalso([
        'Claro, te ayudo con eso.',
        JSON.stringify({ to: 'user', message: '¿Para qué día quieres la cita?' })
    ]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas, promptSistema });

    const respuesta = await agente.responder('Hola, quiero una cita');

    assert.match(respuesta, /Para qué día/);
    assert.equal(cliente.llamadas.length, 2);
    const correccion = cliente.llamadas[1].messages.at(-1).content;
    assert.match(correccion, /no es válida/);
});

test('devuelve al modelo el error de una función desconocida', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    const cliente = crearClienteFalso([
        JSON.stringify({ to: 'system', function_call: { function: 'borrar_agenda', arguments: {} } }),
        JSON.stringify({ to: 'user', message: 'No puedo hacer eso, pero puedo cancelar una cita.' })
    ]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas, promptSistema });

    const respuesta = await agente.responder('Borra toda la agenda');

    assert.match(respuesta, /cancelar una cita/);
    assert.match(cliente.llamadas[1].messages.at(-1).content, /Función desconocida/);
});

test('permite desactivar el modo JSON para proveedores sin soporte', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    const cliente = crearClienteFalso([JSON.stringify({ to: 'user', message: 'Hola' })]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas, promptSistema, jsonMode: false });

    await agente.responder('Hola');

    assert.equal(cliente.llamadas[0].response_format, undefined);
    assert.equal(cliente.llamadas[0].temperature, 0.2);
});

test('se detiene si el modelo encadena demasiados pasos', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    const llamada = JSON.stringify({
        to: 'system',
        function_call: { function: 'consultar_disponibilidad', arguments: { fecha_hora: '2026-11-25T15:00:00Z' } }
    });
    const cliente = crearClienteFalso([llamada, llamada, llamada]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas, promptSistema, maxPasos: 2 });

    await assert.rejects(agente.responder('Hola'), /superó el máximo de 2 pasos/);
});

test('el prompt describe las funciones y el horario', async (t) => {
    const { promptSistema } = await preparar(t);

    assert.match(promptSistema, /consultar_disponibilidad/);
    assert.match(promptSistema, /agendar_cita/);
    assert.match(promptSistema, /cancelar_cita/);
    assert.match(promptSistema, /lunes a viernes/);
    assert.match(promptSistema, /America\/Bogota/);
    assert.match(promptSistema, /No repitas una función/);
});

test('no vuelve a ejecutar una herramienta con los mismos argumentos', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    const ejecuciones = [];
    const herramientasVigiladas = herramientas.map((herramienta) => ({
        ...herramienta,
        ejecutar: (argumentos) => {
            ejecuciones.push(argumentos);
            return herramienta.ejecutar(argumentos);
        }
    }));
    const llamada = JSON.stringify({
        to: 'system',
        function_call: {
            function: 'consultar_disponibilidad',
            arguments: { fecha_hora: '2026-11-25T15:00:00Z' }
        }
    });
    const cliente = crearClienteFalso([
        llamada,
        llamada,
        JSON.stringify({ to: 'user', message: 'Sí, hay disponibilidad.' })
    ]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas: herramientasVigiladas, promptSistema });

    const respuesta = await agente.responder('¿Hay cita el miércoles a las 10?');

    assert.equal(respuesta, 'Sí, hay disponibilidad.');
    assert.equal(ejecuciones.length, 1);
    assert.match(cliente.llamadas[2].messages.at(-1).content, /Ya ejecutaste consultar_disponibilidad/);
    assert.match(cliente.llamadas[2].messages.at(-1).content, /No repitas la misma llamada/);
});

test('devuelve el resultado al usuario si el modelo insiste en repetir', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    let ejecuciones = 0;
    const herramientasVigiladas = herramientas.map((herramienta) => ({
        ...herramienta,
        ejecutar: (argumentos) => {
            ejecuciones += 1;
            return herramienta.ejecutar(argumentos);
        }
    }));
    const llamada = JSON.stringify({
        to: 'system',
        function_call: {
            function: 'consultar_disponibilidad',
            arguments: { fecha_hora: '2026-11-25T15:00:00Z' }
        }
    });
    const cliente = crearClienteFalso([llamada, llamada, llamada, llamada, llamada]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas: herramientasVigiladas, promptSistema });

    const respuesta = await agente.responder('¿Hay cita el miércoles a las 10?');

    assert.equal(ejecuciones, 1);
    assert.match(respuesta, /Hay disponibilidad el miércoles/);
});

test('limita el número de herramientas por turno', async (t) => {
    const { herramientas, promptSistema } = await preparar(t);
    let ejecuciones = 0;
    const herramientasVigiladas = herramientas.map((herramienta) => ({
        ...herramienta,
        ejecutar: (argumentos) => {
            ejecuciones += 1;
            return herramienta.ejecutar(argumentos);
        }
    }));
    const consulta = (hora) => JSON.stringify({
        to: 'system',
        function_call: {
            function: 'consultar_disponibilidad',
            arguments: { fecha_hora: `2026-11-25T${hora}:00:00Z` }
        }
    });
    const cliente = crearClienteFalso([consulta('15'), consulta('16'), consulta('17'), consulta('18'), consulta('19')]);
    const agente = crearAgente({ cliente, modelo: 'falso', herramientas: herramientasVigiladas, promptSistema });

    const respuesta = await agente.responder('¿Qué horas hay libres?');

    assert.equal(ejecuciones, 4);
    assert.equal(cliente.llamadas.length, 5);
    assert.match(respuesta, /Hay disponibilidad/);
});

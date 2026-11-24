import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { crearAgenda } from '../src/citas.js';

const ZONA = 'America/Bogota';
const AHORA = new Date('2026-11-24T15:00:00Z'); // martes 24 de noviembre, 10:00 en Bogotá

async function preparar(t) {
    const directorio = await fs.mkdtemp(path.join(os.tmpdir(), 'agente-citas-'));
    const archivo = path.join(directorio, 'citas.json');
    const agenda = crearAgenda({ archivo, zonaHoraria: ZONA, ahora: () => AHORA });
    t.after(() => fs.rm(directorio, { recursive: true, force: true }));
    return { agenda, archivo, directorio };
}

test('consulta disponibilidad en un horario laboral libre', async (t) => {
    const { agenda } = await preparar(t);

    const resultado = await agenda.consultarDisponibilidad('2026-11-25T15:00:00Z');

    assert.equal(resultado.ok, true);
    assert.equal(resultado.disponible, true);
    assert.equal(resultado.fecha_hora, '2026-11-25T15:00:00.000Z');
    assert.match(resultado.mensaje, /Hay disponibilidad/);
});

test('agenda, persiste y normaliza los datos de la cita', async (t) => {
    const { agenda, archivo } = await preparar(t);

    const resultado = await agenda.agendar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: '  Ana Pérez ',
        correo: 'Ana@Example.com '
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.cita.nombre, 'Ana Pérez');
    assert.equal(resultado.cita.correo, 'ana@example.com');

    const guardado = JSON.parse(await fs.readFile(archivo, 'utf8'));
    assert.equal(guardado.citas.length, 1);
    assert.equal(guardado.citas[0].fecha_hora, '2026-11-25T15:00:00.000Z');
});

test('detecta citas que se cruzan en menos de 30 minutos', async (t) => {
    const { agenda } = await preparar(t);
    await agenda.agendar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: 'Ana Pérez',
        correo: 'ana@example.com'
    });

    const solapada = await agenda.consultarDisponibilidad('2026-11-25T15:15:00Z');
    assert.equal(solapada.disponible, false);
    assert.match(solapada.mensaje, /Se cruza con otra cita/);

    const libre = await agenda.consultarDisponibilidad('2026-11-25T15:30:00Z');
    assert.equal(libre.disponible, true);
});

test('rechaza fechas pasadas, fines de semana y horarios fuera de atención', async (t) => {
    const { agenda } = await preparar(t);

    const pasada = await agenda.consultarDisponibilidad('2026-11-24T14:00:00Z');
    assert.equal(pasada.disponible, false);
    assert.match(pasada.mensaje, /ya pasaron/);

    const sabado = await agenda.consultarDisponibilidad('2026-11-28T15:00:00Z');
    assert.equal(sabado.disponible, false);
    assert.match(sabado.mensaje, /lunes a viernes/);

    const antes = await agenda.consultarDisponibilidad('2026-11-25T13:00:00Z'); // 08:00 local
    assert.equal(antes.disponible, false);
    assert.match(antes.mensaje, /fuera del horario/);

    const despues = await agenda.consultarDisponibilidad('2026-11-25T23:00:00Z'); // 18:00 local
    assert.equal(despues.disponible, false);
    assert.match(despues.mensaje, /fuera del horario/);
});

test('rechaza fechas mal formadas y correos inválidos', async (t) => {
    const { agenda, archivo } = await preparar(t);

    const fechaInvalida = await agenda.consultarDisponibilidad('el miércoles a las 10');
    assert.equal(fechaInvalida.ok, false);
    assert.match(fechaInvalida.error, /ISO 8601/);

    const sinZona = await agenda.consultarDisponibilidad('2026-11-25T10:00:00');
    assert.equal(sinZona.ok, false);

    const diaInexistente = await agenda.consultarDisponibilidad('2026-02-31T15:00:00Z');
    assert.equal(diaInexistente.ok, false);

    const conOffset = await agenda.consultarDisponibilidad('2026-11-25T10:00:00-05:00');
    assert.equal(conOffset.ok, true);
    assert.equal(conOffset.fecha_hora, '2026-11-25T15:00:00.000Z');

    const correoInvalido = await agenda.agendar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: 'Ana Pérez',
        correo: 'ana-arroba-ejemplo'
    });
    assert.equal(correoInvalido.ok, false);
    assert.match(correoInvalido.error, /correo/i);

    await assert.rejects(fs.access(archivo), { code: 'ENOENT' });
});

test('cancela solo con la fecha y el correo correctos', async (t) => {
    const { agenda, archivo } = await preparar(t);
    await agenda.agendar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: 'Ana Pérez',
        correo: 'ana@example.com'
    });

    const incorrecta = await agenda.cancelar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: 'Ana Pérez',
        correo: 'otra@example.com'
    });
    assert.equal(incorrecta.ok, false);

    const correcta = await agenda.cancelar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: 'Ana Pérez',
        correo: 'ANA@example.com'
    });
    assert.equal(correcta.ok, true);

    const guardado = JSON.parse(await fs.readFile(archivo, 'utf8'));
    assert.deepEqual(guardado.citas, []);
});

test('una nueva instancia lee las citas ya guardadas', async (t) => {
    const { agenda, archivo } = await preparar(t);
    await agenda.agendar({
        fecha_hora: '2026-11-25T15:00:00Z',
        nombre: 'Ana Pérez',
        correo: 'ana@example.com'
    });

    const segunda = crearAgenda({ archivo, zonaHoraria: ZONA, ahora: () => AHORA });
    const resultado = await segunda.consultarDisponibilidad('2026-11-25T15:00:00Z');

    assert.equal(resultado.disponible, false);
});

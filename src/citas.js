// Agenda de citas con persistencia en un archivo JSON local.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { esDiaLaboral, formatearFechaHora, minutosDelDia } from './tiempo.js';

const HORA_APERTURA = 9;
const HORA_CIERRE = 18;
const DURACION_MINUTOS = 30;
const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATRON_ISO =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/;

export const REGLAS_HORARIO =
    `Las citas duran ${DURACION_MINUTOS} minutos y solo se atienden de lunes a viernes, ` +
    `de ${String(HORA_APERTURA).padStart(2, '0')}:00 a ${HORA_CIERRE}:00`;

/**
 * Interpreta una fecha ISO 8601 estricta con hora y zona (Z u offset).
 * Devuelve null si no es válida. No se aceptan fechas sin zona porque serían
 * ambiguas, ni textos como "el miércoles" que Date interpreta de forma laxa.
 * @param {unknown} valor
 * @returns {Date | null}
 */
function interpretarFecha(valor) {
    if (typeof valor !== 'string') {
        return null;
    }

    const texto = valor.trim();
    const coincidencia = texto.match(PATRON_ISO);
    if (!coincidencia) {
        return null;
    }

    const [, anio, mes, dia, hora, minuto, segundo = '0', , zona] = coincidencia;
    const partes = {
        anio: Number(anio),
        mes: Number(mes),
        dia: Number(dia),
        hora: Number(hora),
        minuto: Number(minuto),
        segundo: Number(segundo)
    };

    const diasDelMes = new Date(Date.UTC(partes.anio, partes.mes, 0)).getUTCDate();
    const componentesValidos =
        partes.mes >= 1 &&
        partes.mes <= 12 &&
        partes.dia >= 1 &&
        partes.dia <= diasDelMes &&
        partes.hora <= 23 &&
        partes.minuto <= 59 &&
        partes.segundo <= 59;

    if (!componentesValidos) {
        return null;
    }

    if (zona !== 'Z') {
        const desplazamiento = zona.match(/[+-](\d{2}):?(\d{2})/);
        if (Number(desplazamiento[1]) > 14 || Number(desplazamiento[2]) > 59) {
            return null;
        }
    }

    const fecha = new Date(texto);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Crea una agenda respaldada por un archivo JSON.
 * @param {object} opciones
 * @param {string} opciones.archivo Ruta del archivo de citas.
 * @param {string} opciones.zonaHoraria Zona horaria de la agenda (IANA).
 * @param {() => Date} [opciones.ahora] Reloj inyectable para las pruebas.
 */
export function crearAgenda({ archivo, zonaHoraria, ahora = () => new Date() }) {
    /** @type {Array<{id: string, fecha_hora: string, nombre: string, correo: string, creada_en: string}> | null} */
    let citas = null;

    async function cargar() {
        try {
            const texto = await fs.readFile(archivo, 'utf8');
            const datos = JSON.parse(texto);
            return Array.isArray(datos?.citas) ? datos.citas : [];
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            if (error instanceof SyntaxError) {
                throw new Error(`El archivo de citas no contiene JSON válido: ${archivo}`);
            }
            throw error;
        }
    }

    async function listar() {
        if (citas === null) {
            citas = await cargar();
        }
        return citas;
    }

    async function guardar() {
        const lista = await listar();
        await fs.mkdir(path.dirname(archivo), { recursive: true });

        // Escritura atómica: si el proceso muere a mitad, el archivo anterior queda intacto.
        const temporal = `${archivo}.tmp`;
        await fs.writeFile(temporal, `${JSON.stringify({ citas: lista }, null, 2)}\n`, 'utf8');
        await fs.rename(temporal, archivo);
    }

    /**
     * @param {Date} fecha
     * @returns {{ disponible: boolean, motivo: string }}
     */
    function verificarDisponibilidad(fecha, lista) {
        if (fecha.getTime() <= ahora().getTime()) {
            return { disponible: false, motivo: 'La fecha y hora ya pasaron.' };
        }

        if (!esDiaLaboral(fecha, zonaHoraria)) {
            return { disponible: false, motivo: 'Solo se agenda de lunes a viernes.' };
        }

        const minutos = minutosDelDia(fecha, zonaHoraria);
        if (minutos < HORA_APERTURA * 60 || minutos + DURACION_MINUTOS > HORA_CIERRE * 60) {
            return {
                disponible: false,
                motivo: `Está fuera del horario de atención (${String(HORA_APERTURA).padStart(2, '0')}:00 a ${HORA_CIERRE}:00, hora local).`
            };
        }

        const colisiona = lista.some((cita) => {
            const existente = new Date(cita.fecha_hora);
            return Math.abs(existente.getTime() - fecha.getTime()) < DURACION_MINUTOS * 60_000;
        });
        if (colisiona) {
            return {
                disponible: false,
                motivo: `Se cruza con otra cita. Cada cita ocupa ${DURACION_MINUTOS} minutos.`
            };
        }

        return { disponible: true, motivo: '' };
    }

    return {
        /**
         * Comprueba si hay hueco para una cita.
         * @param {string} fechaHora Fecha ISO 8601.
         */
        async consultarDisponibilidad(fechaHora) {
            const fecha = interpretarFecha(fechaHora);
            if (!fecha) {
                return {
                    ok: false,
                    error: 'La fecha y hora no son válidas. Usa formato ISO 8601, por ejemplo 2026-11-25T15:00:00Z.'
                };
            }

            const lista = await listar();
            const { disponible, motivo } = verificarDisponibilidad(fecha, lista);
            const fechaLocal = formatearFechaHora(fecha, zonaHoraria);

            return {
                ok: true,
                disponible,
                fecha_hora: fecha.toISOString(),
                fecha_local: fechaLocal,
                mensaje: disponible
                    ? `Hay disponibilidad el ${fechaLocal}.`
                    : `No hay disponibilidad el ${fechaLocal}. ${motivo}`
            };
        },

        /**
         * Agenda una cita si el horario está libre.
         * @param {{ fecha_hora: string, nombre: string, correo: string }} datos
         */
        async agendar({ fecha_hora: fechaHora, nombre, correo }) {
            const nombreLimpio = String(nombre ?? '').trim();
            if (nombreLimpio.length < 2) {
                return { ok: false, error: 'El nombre es obligatorio y debe tener al menos 2 caracteres.' };
            }

            const correoLimpio = String(correo ?? '').trim().toLowerCase();
            if (!PATRON_CORREO.test(correoLimpio)) {
                return { ok: false, error: 'El correo electrónico no es válido.' };
            }

            const fecha = interpretarFecha(fechaHora);
            if (!fecha) {
                return {
                    ok: false,
                    error: 'La fecha y hora no son válidas. Usa formato ISO 8601, por ejemplo 2026-11-25T15:00:00Z.'
                };
            }

            const lista = await listar();
            const { disponible, motivo } = verificarDisponibilidad(fecha, lista);
            if (!disponible) {
                return { ok: false, error: `No se pudo agendar. ${motivo}` };
            }

            const cita = {
                id: randomUUID(),
                fecha_hora: fecha.toISOString(),
                nombre: nombreLimpio,
                correo: correoLimpio,
                creada_en: ahora().toISOString()
            };

            lista.push(cita);
            lista.sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
            await guardar();

            const fechaLocal = formatearFechaHora(fecha, zonaHoraria);
            return {
                ok: true,
                cita,
                fecha_local: fechaLocal,
                mensaje: `Cita agendada para ${nombreLimpio} el ${fechaLocal} (${correoLimpio}).`
            };
        },

        /**
         * Cancela una cita que coincida en fecha/hora y correo.
         * @param {{ fecha_hora: string, nombre: string, correo: string }} datos
         */
        async cancelar({ fecha_hora: fechaHora, correo }) {
            const correoLimpio = String(correo ?? '').trim().toLowerCase();
            if (!PATRON_CORREO.test(correoLimpio)) {
                return { ok: false, error: 'El correo electrónico no es válido.' };
            }

            const fecha = interpretarFecha(fechaHora);
            if (!fecha) {
                return {
                    ok: false,
                    error: 'La fecha y hora no son válidas. Usa formato ISO 8601, por ejemplo 2026-11-25T15:00:00Z.'
                };
            }

            const lista = await listar();
            const indice = lista.findIndex(
                (cita) =>
                    cita.correo.toLowerCase() === correoLimpio &&
                    new Date(cita.fecha_hora).getTime() === fecha.getTime()
            );

            if (indice === -1) {
                return {
                    ok: false,
                    error: 'No encontré una cita con ese correo en esa fecha y hora.'
                };
            }

            const [cita] = lista.splice(indice, 1);
            await guardar();

            const fechaLocal = formatearFechaHora(new Date(cita.fecha_hora), zonaHoraria);
            return {
                ok: true,
                cita_cancelada: cita,
                mensaje: `Cita de ${cita.nombre} cancelada: ${fechaLocal}.`
            };
        }
    };
}

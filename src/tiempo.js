// Utilidades de fecha y hora basadas en Intl, sin dependencias externas.

const DIAS_LABORALES = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

/**
 * Comprueba que una zona horaria IANA sea válida para Intl.
 * @param {string} zonaHoraria
 * @returns {boolean}
 */
export function validarZonaHoraria(zonaHoraria) {
    try {
        new Intl.DateTimeFormat('es', { timeZone: zonaHoraria });
        return true;
    } catch {
        return false;
    }
}

/**
 * Devuelve el día de la semana y la hora local de una fecha en una zona horaria.
 * @param {Date} fecha
 * @param {string} zonaHoraria
 * @returns {{ diaSemana: string, hora: number, minuto: number }}
 */
export function partesEnZona(fecha, zonaHoraria) {
    const formateador = new Intl.DateTimeFormat('en-US', {
        timeZone: zonaHoraria,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });

    const partes = {};
    for (const parte of formateador.formatToParts(fecha)) {
        partes[parte.type] = parte.value;
    }

    return {
        diaSemana: partes.weekday,
        hora: Number(partes.hour),
        minuto: Number(partes.minute)
    };
}

/**
 * @param {Date} fecha
 * @param {string} zonaHoraria
 * @returns {boolean}
 */
export function esDiaLaboral(fecha, zonaHoraria) {
    return DIAS_LABORALES.has(partesEnZona(fecha, zonaHoraria).diaSemana);
}

/**
 * @param {Date} fecha
 * @param {string} zonaHoraria
 * @returns {number} Minutos transcurridos desde la medianoche local.
 */
export function minutosDelDia(fecha, zonaHoraria) {
    const { hora, minuto } = partesEnZona(fecha, zonaHoraria);
    return hora * 60 + minuto;
}

/**
 * Formatea una fecha en lenguaje natural y en la zona horaria indicada.
 * @param {Date} fecha
 * @param {string} zonaHoraria
 * @returns {string}
 */
export function formatearFechaHora(fecha, zonaHoraria) {
    return new Intl.DateTimeFormat('es', {
        timeZone: zonaHoraria,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(fecha);
}

/**
 * Describe la fecha actual con su zona y desplazamiento UTC, por ejemplo
 * "martes, 24 de noviembre de 2026, 10:00 (America/Bogota, GMT-05:00)".
 * @param {Date} fecha
 * @param {string} zonaHoraria
 * @returns {string}
 */
export function describirAhora(fecha, zonaHoraria) {
    const desplazamiento = new Intl.DateTimeFormat('en-US', {
        timeZone: zonaHoraria,
        timeZoneName: 'longOffset'
    })
        .formatToParts(fecha)
        .find((parte) => parte.type === 'timeZoneName')?.value;

    const sufijo = desplazamiento ? `, ${desplazamiento}` : '';
    return `${formatearFechaHora(fecha, zonaHoraria)} (${zonaHoraria}${sufijo})`;
}

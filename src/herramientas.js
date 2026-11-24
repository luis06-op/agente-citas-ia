// Definición de las herramientas que el agente puede ejecutar.
// El prompt del sistema se genera a partir de esta misma lista para que no
// haya diferencias entre lo que el modelo cree que puede hacer y lo que existe.

/**
 * @param {ReturnType<import('./citas.js').crearAgenda>} agenda
 */
export function crearHerramientas(agenda) {
    return [
        {
            nombre: 'consultar_disponibilidad',
            descripcion: 'Comprueba si la agenda tiene un hueco libre en la fecha y hora indicadas.',
            parametros: [
                {
                    nombre: 'fecha_hora',
                    tipo: 'string ISO 8601',
                    descripcion: 'Fecha y hora que se quiere comprobar, en UTC o con offset.'
                }
            ],
            ejecutar: ({ fecha_hora }) => agenda.consultarDisponibilidad(fecha_hora)
        },
        {
            nombre: 'agendar_cita',
            descripcion: 'Agenda una cita si el horario está libre. Requiere nombre y correo de la persona.',
            parametros: [
                {
                    nombre: 'fecha_hora',
                    tipo: 'string ISO 8601',
                    descripcion: 'Fecha y hora de la cita, en UTC o con offset.'
                },
                {
                    nombre: 'nombre',
                    tipo: 'string',
                    descripcion: 'Nombre completo de la persona.'
                },
                {
                    nombre: 'correo',
                    tipo: 'string',
                    descripcion: 'Correo electrónico de la persona.'
                }
            ],
            ejecutar: ({ fecha_hora, nombre, correo }) => agenda.agendar({ fecha_hora, nombre, correo })
        },
        {
            nombre: 'cancelar_cita',
            descripcion: 'Cancela una cita existente que coincida en fecha/hora y correo electrónico.',
            parametros: [
                {
                    nombre: 'fecha_hora',
                    tipo: 'string ISO 8601',
                    descripcion: 'Fecha y hora de la cita que se quiere cancelar.'
                },
                {
                    nombre: 'nombre',
                    tipo: 'string',
                    descripcion: 'Nombre con el que se agendó la cita.'
                },
                {
                    nombre: 'correo',
                    tipo: 'string',
                    descripcion: 'Correo con el que se agendó la cita.'
                }
            ],
            ejecutar: ({ fecha_hora, correo }) => agenda.cancelar({ fecha_hora, correo })
        }
    ];
}

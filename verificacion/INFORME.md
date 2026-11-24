# Resultado de las pruebas reales

> **Actualización (24/11/2026, commit `9e89127`):** se añadió un guardia en
> `src/agente.js` que evita repetir una misma herramienta con idénticos
> argumentos y limita las herramientas por turno. Una nueva comprobación con
> cuatro de los escenarios anteriores terminó los bucles: `ocupado` y
> `cancelar-correo-distinto` pasaron los controles; `reserva-completa` y
> `solo-consultar` siguen fallando por interpretación del modelo pequeño
> (hora/correo inventados y consulta sin llamada a herramienta). Los números de
> este documento corresponden a la ejecución original, anterior al guardia.

## Conclusión

**La versión actual no supera la verificación de conversaciones reales.**
Solo 2 de los 15 escenarios superaron los controles automáticos. Los otros
13 fallaron. Las 15 pruebas unitarias sí pasan, pero utilizan un cliente LLM
simulado y no detectan estos problemas de interpretación y ejecución.

La comprobación anterior de una reserva aislada no era suficiente para afirmar
que el agente funcionaba de manera fiable en situaciones variadas.

## Ejecución

- Inicio: 24/11/2026, 20:58:08 UTC.
- Modelo real: Qwen 2.5 1.5B Q4_K_M, alias `qwen2.5-local`.
- Motor: llama.cpp local, `http://127.0.0.1:8088/v1`.
- Temperatura: 0.2; máximo de ocho pasos del agente por turno.
- 15 escenarios, 18 turnos; suma de tiempos de respuesta: 895,42 segundos
  (aproximadamente 14 minutos y 55 segundos).
- Reloj de referencia controlado: 24/11/2026, 10:00 de Bogotá.
- Herramientas y persistencia reales, con datos ficticios y una agenda temporal
  independiente por escenario. Se eliminaron las agendas temporales al finalizar.
- Evidencia completa: [JSON de ejecución](resultados/2026-11-24T20-58-08-699Z.json).

Los resultados corresponden a una ejecución de cada escenario, no a una medida
estadística de fiabilidad. Se revisaron tanto las respuestas como las llamadas
a herramientas y los cambios persistidos, incluyendo acciones intermedias.

## Resultado por situación

| Situación | Comportamiento esperado | Comportamiento observado | Resultado |
|---|---|---|---|
| Reserva en varios turnos | Consultar, pedir datos faltantes y reservar una sola vez al confirmar. | Repitió la consulta; inventó `anaperez@example.com` antes de recibir el correo y terminó creando dos citas con ese correo. | Fallo |
| Datos incompletos | Pedir información sin inventar una reserva. | Pidió nombre y correo; no ejecutó herramientas ni guardó citas. No preguntó todavía por fecha/hora. | Control superado; diálogo mejorable |
| Correo inválido y corrección | Pedir un correo válido y usar la corrección posterior. | La herramienta rechazó el correo; el agente entró en bucle. Tras la corrección, siguió usando una hora UTC incorrecta y no reservó. | Fallo |
| Horario ocupado | Informar que ya está ocupado y pedir otra hora. | Interpretó 10:00 Bogotá como 10:00 UTC (05:00 Bogotá), intentó cancelar una cita y agotó los ocho pasos. | Fallo |
| Solapamiento a las 10:15 | Rechazar el cruce con la cita de 10:00 a 10:30. | Consultó las 05:15 de Bogotá por una conversión incorrecta y repitió llamadas. No comprobó el cruce solicitado. | Fallo |
| Fecha pasada | Explicar que la fecha ya pasó y pedir otra. | La herramienta rechazó la fecha, pero el agente repitió consultas sin responder. | Fallo |
| Sábado | Explicar que solo se atiende de lunes a viernes. | La herramienta rechazó el sábado; el agente repitió llamadas e intentó cancelar, sin responder. | Fallo |
| Inicio a las 17:45 | Rechazar porque 30 minutos exceden el cierre de las 18:00. | Confundió 17:45 Bogotá con 17:45 UTC (12:45 Bogotá); creó y canceló la cita dos veces. La agenda final vacía oculta esas acciones incorrectas. | Fallo |
| Hora de Madrid | Convertir 16:00 Madrid a 15:00 UTC y responder en hora de Madrid. | Convirtió correctamente y encontró disponibilidad, pero repitió la consulta ocho veces sin responder. | Fallo |
| «Mañana a las 10» | Consultar el 25/11/2026 a las 10:00 de Bogotá. | Repitió literalmente la pregunta del usuario sin consultar la agenda. | Fallo |
| Cancelación correcta | Cancelar la cita coincidente y comunicar el resultado. | Canceló la cita correcta y respondió que se había cancelado. | Control superado |
| Cancelación con correo distinto | Informar que no encontró coincidencia y conservar la agenda. | Conservó la cita original, pero creó otra a las 15:00 de Bogotá con el correo distinto y terminó en bucle. | Fallo |
| «El viernes a las 7» | Aclarar fecha y hora, sin inventar datos personales. | Inventó `Juan` y `juan@example.com`; eligió el domingo 29/11 y trató de reservar. La herramienta rechazó esa fecha. | Fallo |
| «No reserves, solo consulta» | Consultar el horario correcto, responder y no guardar nada. | No reservó, pero usó 10:00 UTC en vez de 10:00 Bogotá y terminó en bucle. | Fallo |
| 31 de febrero | Explicar que el día no existe y pedir otra fecha. | La herramienta lo rechazó; el agente tomó la fecha de ejemplo del mensaje de error y reservó el 25/11/2026 sin que se solicitara. | Fallo |

## Ejemplos de respuestas que debería dar

**Horario ocupado**

> Esa hora ya está ocupada. ¿Qué otra hora prefieres?

Solo debe proponer un horario como disponible si lo ha consultado.

**Correo incorrecto**

> El correo «ana-arroba-ejemplo» no es válido. ¿Puedes corregirlo?

**Cita a las 17:45**

> Las citas duran 30 minutos y cerramos a las 18:00. La última hora de inicio
> posible es a las 17:30. ¿Quieres que consulte ese horario?

**Fecha inexistente**

> Febrero no tiene 31 días. ¿Qué fecha válida prefieres?

**Cancelación con correo distinto**

> No encuentro una cita con ese correo para la fecha y hora indicadas.
> ¿Puedes revisar los datos?

Más criterios y ejemplos: [ESCENARIOS.md](ESCENARIOS.md).

## Fallos prioritarios observados

1. **Acciones no solicitadas:** creó reservas al intentar cancelar y usó datos
   personales inventados. Validar el formato de los argumentos no demuestra que
   esos datos provengan del usuario.
2. **Errores de zona horaria:** utilizó `Z` sin convertir la hora local. Por
   ejemplo, `10:00-05:00` equivale a `15:00Z`, no a `10:00Z`.
3. **Repetición de herramientas:** muchos turnos agotaron los ocho pasos aunque
   una herramienta ya había entregado un resultado suficiente.
4. **Uso de ejemplos como datos reales:** convirtió la fecha de ejemplo de un
   error de validación en una reserva no solicitada.
5. **Explicaciones ausentes:** el límite de pasos termina el bucle, pero el
   usuario recibe un error técnico en vez de una respuesta útil.

Las correcciones deberán comprobar que los argumentos coinciden con datos
aportados por el usuario, resolver las fechas de forma verificable y detener las
acciones repetidas o incompatibles con la solicitud. Cambiar solo el prompt o el
modelo no demuestra por sí mismo que estos fallos estén resueltos.

## Reproducir

```bash
cd /home/luis/Proyectos/github/agente-citas-ia
npm run local:iniciar
npm run test:real
```

Para repetir un caso:

```bash
npm run test:real -- cancelar-correo-distinto
```

El comando devuelve un código de salida distinto de cero cuando falla un control.
Cada ejecución conserva un JSON nuevo; no sobrescribe esta evidencia.

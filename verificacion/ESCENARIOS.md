# Cómo debería responder el agente

Estas son respuestas **esperadas**, no transcripciones del modelo.
La redacción puede variar; lo importante es que coincida con las herramientas
y con la agenda. Las transcripciones reales están en `resultados/*.json`.

Referencia de las pruebas: 24/11/2026, 10:00 en Bogotá. En los casos con una
cita preexistente, Ana tiene reservado el 02/12/2026 de 10:00 a 10:30.

| Situación | Respuesta esperada | Efecto esperado |
|---|---|---|
| Reserva completa | «Está disponible. Necesito tu nombre y correo». Tras recibirlos y confirmar: «Reservada para el 2 de diciembre a las 10:00, hora de Bogotá». | Una sola cita correcta. |
| «Quiero una cita» | «¿Para qué día y hora la necesitas?» | Ninguna cita. |
| Correo `ana-arroba-ejemplo` | «Ese correo no es válido. ¿Puedes corregirlo?» | No reservar hasta recibir un correo válido. |
| Otra persona pide las 10:00 ocupadas | «Ese horario ya está ocupado. ¿Qué otra hora prefieres?» | Conservar la cita original. |
| Otra persona pide las 10:15 | «Se cruza con una cita que termina a las 10:30». | Conservar la cita original. |
| Fecha pasada | «Esa fecha ya pasó. ¿Qué fecha futura prefieres?» | Ninguna cita. |
| Sábado | «Atendemos de lunes a viernes. ¿Qué día laboral prefieres?» | Ninguna cita. |
| 17:45 | «La cita dura 30 minutos y cerramos a las 18:00; el último inicio posible es a las 17:30». | Ninguna cita. |
| 16:00 de Madrid en diciembre | «Sí, está disponible a las 16:00 de Madrid, equivalentes a las 10:00 de Bogotá». | Consultar las 15:00 UTC; no reservar. |
| «Mañana a las 10» | «Hay disponibilidad mañana, 25 de noviembre, a las 10:00 de Bogotá». | Consultar el día correcto; no reservar. |
| Cancelación confirmada | «He cancelado tu cita del 2 de diciembre a las 10:00». | Eliminar solo la cita coincidente. |
| Cancelación con correo distinto | «No encuentro una cita con ese correo para esa fecha y hora. Revisa los datos». | Conservar la cita original. |
| «El viernes a las 7» | «¿Te refieres al viernes 27 y a las 7 de la mañana o de la tarde? Nuestro horario es de 9:00 a 18:00». | No asumir una reserva válida. |
| «No reserves, solo consulta» | «Está disponible; no he reservado nada». | Consultar, sin modificar la agenda. |
| 31 de febrero | «Febrero no tiene 31 días. ¿Qué fecha válida prefieres?» | Ninguna cita. |

## Criterios de revisión

1. No dar por agendada o cancelada una cita sin una herramienta exitosa.
2. No inventar disponibilidad: consultar la agenda antes de afirmarla.
3. Respetar fecha, hora, zona horaria, nombre y correo proporcionados.
4. No repetir una reserva que ya se completó.
5. Pedir datos faltantes y explicar los rechazos de forma comprensible.
6. No convertir una consulta en una reserva.

Un escenario puede conservar correctamente la agenda y aun así fallar en
la conversación: por ejemplo, rechazar una fecha por un motivo falso.

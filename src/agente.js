// Bucle del agente: envía la conversación al LLM, interpreta su respuesta JSON
// y ejecuta funciones cuando el modelo lo pide.

/**
 * Extrae un objeto JSON de la respuesta del modelo, tolerando bloques de código
 * o texto alrededor.
 * @param {string} texto
 * @returns {Record<string, unknown>}
 */
export function extraerJson(texto) {
    const limpio = texto
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');

    try {
        const valor = JSON.parse(limpio);
        if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
            return valor;
        }
    } catch {
        // Se intenta el rescate de abajo.
    }

    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio !== -1 && fin > inicio) {
        try {
            const valor = JSON.parse(limpio.slice(inicio, fin + 1));
            if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
                return valor;
            }
        } catch {
            // Sin rescate posible.
        }
    }

    throw new Error('la respuesta no contiene un objeto JSON válido');
}

/**
 * Convierte los argumentos del modelo a un objeto con nombre de parámetro.
 * Acepta objetos (formato recomendado) y arrays (formato del tutorial original).
 * @param {unknown} argumentos
 * @param {Array<{nombre: string}>} parametros
 * @returns {Record<string, unknown>}
 */
function normalizarArgumentos(argumentos, parametros) {
    if (Array.isArray(argumentos)) {
        return Object.fromEntries(parametros.map((parametro, indice) => [parametro.nombre, argumentos[indice]]));
    }

    if (argumentos && typeof argumentos === 'object') {
        return { ...argumentos };
    }

    return {};
}

/**
 * @param {object} opciones
 * @param {any} opciones.cliente Cliente compatible con OpenAI.
 * @param {string} opciones.modelo
 * @param {Array<{nombre: string, descripcion: string, parametros: Array<{nombre: string, tipo: string, descripcion: string}>, ejecutar: (args: any) => Promise<any>}>} opciones.herramientas
 * @param {string} opciones.promptSistema
 * @param {number} [opciones.maxPasos]
 * @param {number} [opciones.temperature]
 * @param {boolean} [opciones.jsonMode]
 * @param {(mensaje: string) => void} [opciones.registrar]
 */
export function crearAgente({
    cliente,
    modelo,
    herramientas,
    promptSistema,
    maxPasos = 8,
    temperature = 0.2,
    jsonMode = true,
    registrar = () => {}
}) {
    /** @type {Array<{role: string, content: string}>} */
    const mensajes = [{ role: 'system', content: promptSistema }];
    const porNombre = new Map(herramientas.map((herramienta) => [herramienta.nombre, herramienta]));

    async function llamarModelo() {
        const respuesta = await cliente.chat.completions.create({
            model: modelo,
            messages: mensajes,
            temperature,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
        });

        const contenido = respuesta?.choices?.[0]?.message?.content;
        if (typeof contenido !== 'string' || contenido.trim() === '') {
            throw new Error('El modelo devolvió una respuesta vacía.');
        }

        return contenido.trim();
    }

    function responderAlSistema(contenido) {
        mensajes.push({ role: 'user', content: contenido });
    }

    async function ejecutarHerramienta(llamada) {
        const nombre = llamada?.function;
        const herramienta = porNombre.get(nombre);

        if (!herramienta) {
            return { ok: false, error: `Función desconocida: ${String(nombre)}` };
        }

        const argumentos = normalizarArgumentos(llamada.arguments, herramienta.parametros);
        const faltantes = herramienta.parametros
            .filter((parametro) => argumentos[parametro.nombre] === undefined || argumentos[parametro.nombre] === '')
            .map((parametro) => parametro.nombre);

        if (faltantes.length > 0) {
            return { ok: false, error: `Faltan argumentos obligatorios: ${faltantes.join(', ')}.` };
        }

        try {
            return await herramienta.ejecutar(argumentos);
        } catch (error) {
            return { ok: false, error: `Error al ejecutar ${String(nombre)}: ${error.message}` };
        }
    }

    /**
     * Procesa un turno completo: añade el mensaje de la persona, llama al modelo
     * tantas veces como haga falta y devuelve la respuesta final para el usuario.
     * @param {string} textoUsuario
     * @returns {Promise<string>}
     */
    async function responder(textoUsuario) {
        mensajes.push({ role: 'user', content: textoUsuario });

        for (let paso = 0; paso < maxPasos; paso++) {
            const contenido = await llamarModelo();
            mensajes.push({ role: 'assistant', content: contenido });

            let respuesta;
            try {
                respuesta = extraerJson(contenido);
            } catch (error) {
                responderAlSistema(
                    `[sistema] Tu respuesta no es válida: ${error.message}. ` +
                        'Responde únicamente con el objeto JSON del protocolo.'
                );
                continue;
            }

            if (respuesta.to === 'user') {
                const mensaje = typeof respuesta.message === 'string' ? respuesta.message.trim() : '';
                if (mensaje === '') {
                    responderAlSistema('[sistema] Falta "message". Escribe la respuesta para la persona.');
                    continue;
                }
                return mensaje;
            }

            if (respuesta.to === 'system') {
                const llamada = respuesta.function_call;
                if (!llamada || typeof llamada.function !== 'string' || llamada.function.trim() === '') {
                    responderAlSistema(
                        '[sistema] Falta "function_call.function". Indica qué función quieres ejecutar.'
                    );
                    continue;
                }

                const resultado = await ejecutarHerramienta(llamada);
                const estado = resultado.ok === false ? 'error' : 'ok';
                registrar(
                    `  [herramienta] ${llamada.function}(${JSON.stringify(llamada.arguments ?? {})}) → ${estado}`
                );
                responderAlSistema(`[sistema] Resultado de ${llamada.function}: ${JSON.stringify(resultado)}`);
                continue;
            }

            responderAlSistema(
                '[sistema] El campo "to" debe ser "user" o "system". Corrige tu respuesta y usa el formato del protocolo.'
            );
        }

        throw new Error(`El agente superó el máximo de ${maxPasos} pasos sin dar una respuesta al usuario.`);
    }

    return { responder, mensajes };
}

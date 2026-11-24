#!/usr/bin/env bash
# Instala y gestiona Ollama en el espacio del usuario, sin sudo.
# Uso: bash scripts/ollama.sh {preparar|instalar|iniciar|auto|descargar|estado|detener}

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_OLLAMA="${OLLAMA_DIR:-$HOME/.local/opt/ollama}"
ESTADO_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/ollama"
LOG="$ESTADO_DIR/ollama.log"
PIDFILE="$ESTADO_DIR/ollama.pid"
MODELO="${OPENAI_MODEL:-}"

if [ -z "$MODELO" ] && [ -f "$RAIZ/.env" ]; then
    MODELO="$(sed -n 's/^[[:space:]]*OPENAI_MODEL[[:space:]]*=[[:space:]]*//p' "$RAIZ/.env" | tail -n 1 | tr -d '"' | tr -d "'")"
fi
MODELO="${MODELO:-qwen2.5:3b}"

mkdir -p "$ESTADO_DIR"

encontrar_ollama() {
    if command -v ollama >/dev/null 2>&1; then
        command -v ollama
        return 0
    fi
    if [ -x "$DIR_OLLAMA/bin/ollama" ]; then
        echo "$DIR_OLLAMA/bin/ollama"
        return 0
    fi
    return 1
}

servidor_activo() {
    curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1
}

instalar() {
    if encontrar_ollama >/dev/null; then
        echo "Ollama ya está instalado: $(encontrar_ollama)"
        return 0
    fi

    echo "Descargando Ollama para el usuario en $DIR_OLLAMA (~1,6 GB)…"
    local temporal
    temporal="$(mktemp -d)"
    curl -fL --retry 3 --progress-bar \
        -o "$temporal/ollama.tar.zst" \
        https://ollama.com/download/ollama-linux-amd64.tar.zst
    mkdir -p "$DIR_OLLAMA"
    zstd -dc "$temporal/ollama.tar.zst" | tar -xf - -C "$DIR_OLLAMA"
    rm -rf "$temporal"
    mkdir -p "$HOME/.local/bin"
    ln -sf "$DIR_OLLAMA/bin/ollama" "$HOME/.local/bin/ollama"
    echo "Ollama instalado en $DIR_OLLAMA"
    echo "Asegúrate de que $HOME/.local/bin esté en el PATH."
}

iniciar() {
    if servidor_activo; then
        echo "Ollama ya está en marcha en http://127.0.0.1:11434"
        return 0
    fi

    local bin
    if ! bin="$(encontrar_ollama)"; then
        echo "Ollama no está instalado. Ejecuta: npm run preparar" >&2
        return 1
    fi

    echo "Iniciando Ollama…"
    nohup env OLLAMA_CONTEXT_LENGTH="${OLLAMA_CONTEXT_LENGTH:-8192}" \
        "$bin" serve >>"$LOG" 2>&1 &
    echo $! >"$PIDFILE"

    for _ in $(seq 1 40); do
        if servidor_activo; then
            echo "Ollama listo (PID $(cat "$PIDFILE")). Log: $LOG"
            return 0
        fi
        sleep 0.5
    done

    echo "Ollama no arrancó. Revisa $LOG" >&2
    return 1
}

descargar_modelo() {
    local bin
    if ! bin="$(encontrar_ollama)"; then
        echo "Ollama no está instalado. Ejecuta: npm run preparar" >&2
        return 1
    fi

    echo "Descargando el modelo $MODELO…"
    "$bin" pull "$MODELO"
}

estado() {
    if servidor_activo; then
        echo "Servidor: en marcha"
        "$(encontrar_ollama)" list
    else
        echo "Servidor: detenido"
    fi
}

detener() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        kill "$(cat "$PIDFILE")"
        rm -f "$PIDFILE"
        echo "Ollama detenido."
    else
        echo "No hay un servidor iniciado por este script."
    fi
}

# Arranque silencioso para "npm start": si Ollama está instalado pero apagado,
# lo enciende. Si no está instalado, no hace nada (index.js dará instrucciones).
auto() {
    if ! encontrar_ollama >/dev/null; then
        return 0
    fi
    if servidor_activo; then
        return 0
    fi
    iniciar >/dev/null 2>&1 || true
}

case "${1:-}" in
    preparar)
        instalar
        iniciar
        descargar_modelo
        ;;
    instalar) instalar ;;
    iniciar) iniciar ;;
    auto) auto ;;
    descargar) descargar_modelo ;;
    estado) estado ;;
    detener) detener ;;
    *)
        echo "Uso: $0 {preparar|instalar|iniciar|auto|descargar|estado|detener}" >&2
        exit 1
        ;;
esac
